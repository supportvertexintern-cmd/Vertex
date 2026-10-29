"""Card and PayPal payments (payments step 7.2) answer as the website's
Stripe webhook and PayPal order routes did, with every write audited (G22)
and two checks they lacked: FastAPI verifies Stripe's signature itself, and
a PayPal order is captured only if it's this user's order for this job's
fee."""

import hashlib
import hmac
import json
import secrets
import time

import pytest
from sqlalchemy import select, text

from app.api.v1 import payments as module
from app.core.config import settings
from app.db.session import get_db
from app.main import app
from app.models.audit import AuditLog
from app.models.candidate import Application, Candidate
from app.models.cases import Case, CasePayment
from app.models.enums import CasePaymentStatus, CaseStage, PaymentStatus, Role
from app.models.identity import User
from app.models.jobs import Job, JobPaymentStage
from app.models.payments import ConsultationBooking, Payment
from app.services import paypal
from tests.test_auth import add_session, bearer, session_token
from tests.test_db_roles import roles_provisioned  # noqa: F401  (vertex_api must exist)
from tests.test_service_auth import SERVICE_SECRET, service_token

WEBHOOK_SECRET = "whsec_test_only_" + "x" * 24  # gitleaks:allow
WEBHOOK = "/api/v1/payments/stripe/webhook"


@pytest.fixture
def api(db, client, monkeypatch):
    monkeypatch.setattr(settings, "SERVICE_AUTH_SECRET", SERVICE_SECRET)
    monkeypatch.setattr(settings, "SERVICE_AUTH_SECRET_PREVIOUS", None)
    monkeypatch.setattr(settings, "STRIPE_WEBHOOK_SECRET", WEBHOOK_SECRET)
    app.dependency_overrides[get_db] = lambda: db
    yield client
    app.dependency_overrides.pop(get_db, None)


def person(db, role: Role) -> tuple[User, dict[str, str]]:
    u = User(full_name=f"{role.value} {secrets.token_hex(2)}", email=f"pay-{secrets.token_hex(4)}@test.invalid", role=role)
    db.add(u)
    db.flush()
    db.refresh(u)
    s = add_session(db, u.id)
    return u, bearer(session_token(u.id, s.family_id, u.token_version))


@pytest.fixture
def job(db):
    j = Job(title="Care worker", country="Germany", city="Berlin", job_description="d", requirements="r", application_fee=49.5)
    db.add(j)
    db.flush()
    return j


def signed(event: dict, secret: str = WEBHOOK_SECRET) -> tuple[bytes, dict[str, str]]:
    """The body and headers the website passes on: Stripe's own scheme."""
    payload = json.dumps(event).encode()
    stamp = int(time.time())
    signature = hmac.new(secret.encode(), f"{stamp}.".encode() + payload, hashlib.sha256).hexdigest()
    return payload, {"Stripe-Signature": f"t={stamp},v1={signature}", "X-Vertex-Service": service_token(), "Content-Type": "application/json"}


def completed(session: dict) -> dict:
    return {"id": f"evt_{secrets.token_hex(4)}", "object": "event", "type": "checkout.session.completed", "data": {"object": {"object": "checkout.session"} | session}}


def deliver(api, event: dict, **kwargs):
    payload, headers = signed(event, **kwargs)
    return api.post(WEBHOOK, content=payload, headers=headers)


# --- the webhook ---------------------------------------------------------------


def test_a_forged_or_unsigned_event_is_refused(api):
    event = completed({"id": "cs_forged", "metadata": {"type": "consultation"}})
    forged = deliver(api, event, secret="whsec_someone_else_" + "y" * 20)
    assert (forged.status_code, forged.json()["error"]["code"]) == (400, "invalid_signature")
    assert api.post(WEBHOOK, content=b"{}", headers={"X-Vertex-Service": service_token()}).status_code == 400
    assert api.post(WEBHOOK, content=signed(event)[0]).status_code == 401  # only the website passes it on


def test_without_a_secret_stripe_is_asked_to_retry(api, monkeypatch):
    monkeypatch.setattr(settings, "STRIPE_WEBHOOK_SECRET", None)
    assert deliver(api, completed({"id": "cs_x", "metadata": {}})).status_code == 503


def test_a_consultation_is_booked_once(api, db):
    session_id = f"cs_{secrets.token_hex(6)}"
    event = completed({
        "id": session_id, "amount_total": 7500, "currency": "eur", "payment_intent": "pi_c1",
        "customer_details": {"name": "Sara Booker", "email": "sara@test.invalid", "phone": "+251 911"},
        "metadata": {"type": "consultation"},
    })
    res = deliver(api, event)
    assert res.json() == {"data": {"received": True}, "notify": [{
        "kind": "consultation_booked", "full_name": "Sara Booker", "email": "sara@test.invalid", "phone": "+251 911", "amount": 75.0, "currency": "EUR",
    }]}
    again = deliver(api, event)  # Stripe delivers at least once
    assert again.json()["notify"] == []
    [booking] = db.scalars(select(ConsultationBooking).where(ConsultationBooking.stripe_checkout_session_id == session_id)).all()
    assert (booking.stripe_payment_intent_id, booking.amount) == ("pi_c1", 75.0)
    assert db.scalars(select(AuditLog.actor_id).where(AuditLog.entity_id == booking.id)).all() == [None]  # audited, by the system


def test_an_application_fee_by_card_is_recorded_once_with_a_receipt(api, db, job):
    user, _ = person(db, Role.candidate)
    intent = f"pi_{secrets.token_hex(6)}"
    event = completed({"id": "cs_fee", "amount_total": 4950, "payment_intent": intent, "metadata": {"userId": user.id, "jobId": job.id, "jobTitle": "Care worker"}})
    notice = deliver(api, event).json()["notify"][0]
    payment = db.scalar(select(Payment).where(Payment.transaction_id == intent))
    assert (payment.amount, payment.payment_method, payment.payment_status) == (49.5, "stripe", PaymentStatus.completed)
    assert {k: notice[k] for k in ("kind", "payment_id", "email", "job_title", "amount", "transaction_id")} == {
        "kind": "payment_receipt", "payment_id": payment.id, "email": user.email, "job_title": "Care worker", "amount": 49.5, "transaction_id": intent,
    }
    assert deliver(api, event).json()["notify"] == []
    assert len(db.scalars(select(Payment).where(Payment.transaction_id == intent)).all()) == 1


def test_a_paid_case_link_collects_its_pending_payment(api, db, job):
    candidate = Candidate(full_name="Case person")
    db.add(candidate)
    db.flush()
    application = Application(candidate_id=candidate.id, job_id=job.id)
    db.add(application)
    db.flush()
    case = Case(application_id=application.id)
    stage = JobPaymentStage(job_id=job.id, order=1, label="Stage 1", percent=100, trigger_stage=CaseStage.registration_document_submission)
    db.add_all([case, stage])
    db.flush()
    recorder, _ = person(db, Role.finance)
    pending = CasePayment(case_id=case.id, job_payment_stage_id=stage.id, amount=100, recorded_by=recorder.id, status=CasePaymentStatus.pending, stripe_payment_link_id="plink_1")
    other = CasePayment(case_id=case.id, job_payment_stage_id=stage.id, amount=100, recorded_by=recorder.id, status=CasePaymentStatus.pending, stripe_payment_link_id="plink_2")
    db.add_all([pending, other])
    db.flush()
    res = deliver(api, completed({"id": "cs_case", "payment_link": "plink_1", "metadata": {"case_id": case.id}}))
    assert res.json() == {"data": {"received": True}, "notify": []}
    db.refresh(pending)
    db.refresh(other)
    assert (pending.status, pending.stripe_checkout_session_id, other.status) == (CasePaymentStatus.collected, "cs_case", CasePaymentStatus.pending)


def test_other_events_are_acknowledged_and_ignored(api):
    res = deliver(api, {"id": "evt_other", "object": "event", "type": "invoice.paid", "data": {"object": {"object": "invoice"}}})
    assert res.json() == {"data": {"received": True}, "notify": []}


# --- PayPal ----------------------------------------------------------------------


class FakePayPal:
    """PayPal's Orders API, as far as these routes use it."""

    def __init__(self) -> None:
        self.orders: dict[str, dict] = {}
        self.captured: list[str] = []

    def __call__(self, method: str, path: str, body: dict | None = None) -> dict:
        if method == "POST" and path == "/v2/checkout/orders":
            order_id = f"ORDER{len(self.orders) + 1}"
            self.orders[order_id] = {"id": order_id, "status": "CREATED", "purchase_units": body["purchase_units"]}
            return {"id": order_id}
        order_id = path.split("/")[4]
        order = self.orders.get(order_id)
        if order is None:
            raise paypal.PayPalError("404")
        if method == "GET":
            return order
        self.captured.append(order_id)
        amount = order["purchase_units"][0]["amount"]
        return {"status": "COMPLETED", "purchase_units": [{"payments": {"captures": [{"id": f"CAP-{order_id}", "amount": amount}]}}]}


@pytest.fixture
def fake_paypal(monkeypatch):
    fake = FakePayPal()
    monkeypatch.setattr(paypal, "_call", fake)
    monkeypatch.setattr(paypal, "_base", lambda: "https://paypal.test")
    return fake


def test_a_fee_is_ordered_captured_and_recorded(api, db, job, fake_paypal):
    user, session = person(db, Role.candidate)
    order = api.post("/api/v1/payments/paypal/orders", headers=session, json={"jobId": job.id})
    order_id = order.json()["data"]["id"]
    unit = fake_paypal.orders[order_id]["purchase_units"][0]
    assert (unit["custom_id"], unit["amount"]) == (f"{job.id}_{user.id}", {"currency_code": "USD", "value": "49.50"})

    res = api.post(f"/api/v1/payments/paypal/orders/{order_id}/capture", headers=session, json={"jobId": job.id})
    assert res.status_code == 200
    data = res.json()["data"]
    assert (data["payment_method"], data["amount"], data["transaction_id"], data["user_id"]) == ("paypal", 49.5, f"CAP-{order_id}", user.id)
    assert res.json()["notify"][0]["kind"] == "payment_receipt"
    assert db.scalars(select(AuditLog.actor_id).where(AuditLog.entity_id == data["id"])).all() == [user.id]


def test_an_order_that_isnt_this_fee_is_never_captured(api, db, job, fake_paypal):
    _, session = person(db, Role.candidate)
    # A cent, created in the browser with PayPal's own SDK.
    fake_paypal.orders["CHEAP"] = {"id": "CHEAP", "purchase_units": [{"custom_id": "x", "amount": {"currency_code": "USD", "value": "0.01"}}]}
    res = api.post("/api/v1/payments/paypal/orders/CHEAP/capture", headers=session, json={"jobId": job.id})
    assert (res.status_code, res.json()["error"]["message"]) == (400, "Payment could not be captured.")
    other, other_session = person(db, Role.candidate)
    someone_elses = api.post("/api/v1/payments/paypal/orders", headers=other_session, json={"jobId": job.id}).json()["data"]["id"]
    assert api.post(f"/api/v1/payments/paypal/orders/{someone_elses}/capture", headers=session, json={"jobId": job.id}).status_code == 400
    assert fake_paypal.captured == []
    assert db.scalars(select(Payment).where(Payment.job_id == job.id)).all() == []


def test_paypal_refuses_what_the_website_refused(api, db, job, fake_paypal, monkeypatch):
    _, session = person(db, Role.candidate)
    free = Job(title="Free", country="Germany", city="Berlin", job_description="d", requirements="r", application_fee=0)
    db.add(free)
    db.flush()
    no_fee = api.post("/api/v1/payments/paypal/orders", headers=session, json={"jobId": free.id})
    assert (no_fee.status_code, no_fee.json()["error"]["message"]) == (400, "This job does not require an application fee.")
    assert api.post("/api/v1/payments/paypal/orders", headers=session, json={"jobId": "cnosuch"}).status_code == 404
    assert api.post("/api/v1/payments/paypal/orders", json={"jobId": job.id}).status_code == 401

    def not_configured(*_args, **_kwargs):
        raise paypal.PayPalNotConfigured

    monkeypatch.setattr(paypal, "_call", not_configured)
    assert api.post("/api/v1/payments/paypal/orders", headers=session, json={"jobId": job.id}).status_code == 503


def test_the_api_database_role_writes_payments(api, db, job, fake_paypal):
    user, session = person(db, Role.candidate)
    order_id = api.post("/api/v1/payments/paypal/orders", headers=session, json={"jobId": job.id}).json()["data"]["id"]
    db.execute(text("SET LOCAL ROLE vertex_api"))
    try:
        captured = api.post(f"/api/v1/payments/paypal/orders/{order_id}/capture", headers=session, json={"jobId": job.id})
        booked = deliver(api, completed({"id": f"cs_{secrets.token_hex(4)}", "amount_total": 100, "customer_details": {"email": "a@test.invalid"}, "metadata": {"type": "consultation"}}))
    finally:
        db.execute(text("RESET ROLE"))
    assert (captured.status_code, booked.status_code) == (200, 200)
    assert module.SIGNATURE_HEADER == "Stripe-Signature"
