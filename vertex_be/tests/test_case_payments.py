"""A case's milestone payments (payments step 7.3) answer as the website's
/api/cases/[id]/payments/... routes did, rule for rule, with Stripe faked
and every write audited."""

import secrets

import pytest
import stripe
from sqlalchemy import select, text

from app.api.v1 import case_payments as module
from app.core.config import BASE_DIR
from app.db.session import get_db
from app.main import app
from app.models.audit import AuditLog
from app.models.candidate import Application, Candidate, Document
from app.models.cases import Case, CasePayment, FeePolicy
from app.models.enums import CandidateSource, CasePaymentStatus, CaseStage, PartnerType, Role
from app.models.identity import Country, Region, User
from app.models.jobs import Job, JobPaymentStage
from app.models.partners import Partner
from app.models.reference import DocumentRequirementType
from tests.test_auth import add_session, bearer, session_token
from tests.test_db_roles import roles_provisioned  # noqa: F401  (vertex_api must exist)

WEB = BASE_DIR.parent / "vertex" / "src" / "app" / "api" / "cases" / "[id]" / "payments"
URL = "/api/v1/cases"


class FakeLinks:
    def __init__(self) -> None:
        self.fail = False
        self.paid: str | None = None
        self.created: list[dict] = []

    def create_link(self, *, price, metadata):
        if self.fail:
            raise stripe.APIConnectionError("Stripe is down")
        self.created.append({"price": price, "metadata": metadata})
        return f"plink_{len(self.created)}", f"https://buy.stripe.test/{len(self.created)}"

    def paid_session(self, payment_link):
        if self.fail:
            raise stripe.APIConnectionError("Stripe is down")
        return self.paid


@pytest.fixture
def links() -> FakeLinks:
    return FakeLinks()


@pytest.fixture
def api(db, client, links):
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[module.stripe_client] = lambda: links
    yield client
    app.dependency_overrides.pop(get_db, None)
    app.dependency_overrides.pop(module.stripe_client, None)


def person(db, role: Role) -> tuple[User, dict[str, str]]:
    u = User(full_name=f"{role.value} {secrets.token_hex(2)}", email=f"cp-{secrets.token_hex(4)}@test.invalid", role=role)
    db.add(u)
    db.flush()
    db.refresh(u)
    s = add_session(db, u.id)
    return u, bearer(session_token(u.id, s.family_id, u.token_version))


@pytest.fixture
def world(db):
    region = Region(name=f"Pay region {secrets.token_hex(3)}")
    db.add(region)
    db.flush()
    home = Country(name=f"Pay home {secrets.token_hex(3)}", region_id=region.id)
    db.add(home)
    db.flush()
    account, _ = person(db, Role.candidate)
    finance_user, finance = person(db, Role.finance)
    _, director = person(db, Role.director)
    _, ops = person(db, Role.operations_team)
    partner = Partner(
        name="Bridge Agency", partner_type=PartnerType.other, country_of_operation="Kenya", contact_name="Pat",
        contact_email=f"p-{secrets.token_hex(3)}@test.invalid", contact_phone="1",
    )
    job = Job(title="Care worker", country="Germany", city="Berlin", job_description="d", requirements="r", category="Healthcare", service_fee_gbp=1000)
    db.add_all([partner, job])
    db.flush()
    deposit = JobPaymentStage(job_id=job.id, order=1, label="Deposit", percent=40, trigger_stage=CaseStage.registration_document_submission, stripe_price_id="price_1", synced_amount_gbp=400)
    upfront = JobPaymentStage(job_id=job.id, order=2, label="Nothing yet", percent=0, trigger_stage=CaseStage.registration_document_submission)
    balance = JobPaymentStage(job_id=job.id, order=3, label="Balance", percent=60, trigger_stage=CaseStage.visa_interview_decision)
    candidate = Candidate(full_name="Abebe Kebede", user_id=account.id, country_id=home.id, partner_id=partner.id, passport_number="EP123", source=CandidateSource.self_registered)
    db.add_all([deposit, upfront, balance, candidate])
    db.flush()
    application = Application(candidate_id=candidate.id, job_id=job.id)
    db.add(application)
    db.flush()
    case = Case(application_id=application.id)
    kind = DocumentRequirementType(key=f"receipt_{secrets.token_hex(3)}", label="Receipt")
    db.add_all([case, kind, FeePolicy(country_id=home.id, enabled=True, updated_by=finance_user.id)])
    db.flush()
    invoice = Document(candidate_id=candidate.id, type=kind.key, storage_path="cases/invoice.pdf")
    db.add(invoice)
    db.flush()
    return {
        "account": account, "finance": finance, "director": director, "ops": ops, "partner": partner, "job": job, "candidate": candidate,
        "case": case, "deposit": deposit, "balance": balance, "kind": kind, "invoice": invoice, "home": home,
    }


def error(res) -> dict:
    return res.json()["error"]


def pending(db, world, **fields) -> CasePayment:
    finance_user = db.scalar(select(User).where(User.role == Role.finance).order_by(User.created_at.desc()).limit(1))
    payment = CasePayment(
        case_id=world["case"].id, job_payment_stage_id=world["deposit"].id, amount=400, currency="GBP", recorded_by=finance_user.id,
        status=CasePaymentStatus.pending, **fields,
    )
    db.add(payment)
    db.flush()
    return payment


def actions(db, entity_id: str) -> list[str]:
    return db.scalars(select(AuditLog.action).where(AuditLog.entity_id == entity_id).order_by(AuditLog.created_at)).all()


# --- drift -------------------------------------------------------------------


def test_the_roles_match_next_js():
    from app.core.rbac import FINANCE_ROLES

    for path in ("route.ts", "link/route.ts", "invoice/route.ts", "[paymentId]/check-status/route.ts", "[paymentId]/mark-paid/route.ts", "[paymentId]/receipt/route.ts"):
        assert "requireRole(user, FINANCE_ROLES)" in (WEB / path).read_text(encoding="utf-8"), path
    assert 'requireRole(user, ["finance"])' in (WEB / "[paymentId]" / "route.ts").read_text(encoding="utf-8")
    assert set(FINANCE_ROLES) == {Role.finance, Role.director, Role.admin}
    assert module.REMOVERS == (Role.finance,)


# --- recording -----------------------------------------------------------------


def test_finance_records_a_collected_payment(api, db, world):
    body = {"job_payment_stage_id": world["deposit"].id, "amount": 400, "receipt_reference": "BANK-1", "receipt_document_id": world["invoice"].id}
    res = api.post(f"{URL}/{world['case'].id}/payments", headers=world["finance"], json=body)
    assert res.status_code == 201
    data = res.json()["data"]
    assert (data["status"], data["amount"], data["currency"], data["receipt_reference"], data["receipt_document_id"]) == (
        "collected", 400, "USD", "BANK-1", world["invoice"].id,
    )
    assert actions(db, data["id"]) == ["create"]


def test_recording_is_refused_when_it_should_be(api, db, world):
    case = world["case"].id
    other_job = Job(title="Other", country="X", city="Y", job_description="d", requirements="r")
    db.add(other_job)
    db.flush()
    foreign = JobPaymentStage(job_id=other_job.id, order=1, label="Elsewhere", percent=10, trigger_stage=CaseStage.registration_document_submission)
    db.add(foreign)
    db.flush()
    res = api.post(f"{URL}/{case}/payments", headers=world["finance"], json={"job_payment_stage_id": foreign.id, "amount": 10})
    assert (res.status_code, error(res)["message"]) == (404, "Payment stage not found for this case's opportunity.")
    assert api.post(f"{URL}/{case}/payments", headers=world["ops"], json={"job_payment_stage_id": world["deposit"].id, "amount": 10}).status_code == 403
    assert api.post(f"{URL}/{case}/payments", headers=world["finance"], json={"job_payment_stage_id": world["deposit"].id, "amount": 0}).status_code == 422
    assert api.post(f"{URL}/c{secrets.token_hex(12)}/payments", headers=world["finance"], json={"job_payment_stage_id": world["deposit"].id, "amount": 1}).status_code == 404

    db.scalar(select(FeePolicy).where(FeePolicy.country_id == world["home"].id)).enabled = False
    db.flush()
    res = api.post(f"{URL}/{case}/payments", headers=world["finance"], json={"job_payment_stage_id": world["deposit"].id, "amount": 10})
    assert (res.status_code, error(res)["code"]) == (403, "fee_policy_disabled")
    assert db.scalars(select(CasePayment).where(CasePayment.case_id == case)).all() == []


# --- payment links -------------------------------------------------------------


def test_a_payment_link_is_created_on_the_stage_price_and_emailed(api, db, world, links):
    res = api.post(f"{URL}/{world['case'].id}/payments/link", headers=world["director"], json={"job_payment_stage_id": world["deposit"].id, "recipient": "candidate"})
    assert res.status_code == 201
    body = res.json()
    payment = body["data"]["payment"]
    assert body["data"]["url"] == "https://buy.stripe.test/1"
    assert (payment["status"], payment["amount"], payment["currency"], payment["stripe_payment_link_id"], payment["sent_to_email"]) == (
        "pending", 400, "GBP", "plink_1", world["account"].email,
    )
    assert links.created == [{"price": "price_1", "metadata": {"case_id": world["case"].id, "job_payment_stage_id": world["deposit"].id}}]
    assert body["notify"] == [{
        "kind": "milestone_payment_link", "email": world["account"].email, "recipient_name": world["account"].full_name,
        "candidate_name": world["account"].full_name, "programme_title": "Care worker", "payment_url": "https://buy.stripe.test/1",
        "current_stage_id": world["deposit"].id,
        "stages": [
            {"id": world["deposit"].id, "label": "Deposit", "percent": 40, "amount": 400, "trigger_stage": "registration_document_submission"},
            {"id": world["balance"].id, "label": "Balance", "percent": 60, "amount": 600, "trigger_stage": "visa_interview_decision"},
        ],
    }]
    assert actions(db, payment["id"]) == ["create"]

    to_partner = api.post(f"{URL}/{world['case'].id}/payments/link", headers=world["finance"], json={"job_payment_stage_id": world["deposit"].id, "recipient": "partner"}).json()
    assert (to_partner["data"]["payment"]["sent_to_email"], to_partner["notify"][0]["recipient_name"]) == (world["partner"].contact_email, "Pat")


def test_payment_links_are_refused_when_they_should_be(api, db, world, links):
    case = world["case"].id
    link = lambda stage: api.post(f"{URL}/{case}/payments/link", headers=world["finance"], json={"job_payment_stage_id": stage.id, "recipient": "candidate"})  # noqa: E731

    res = link(world["balance"])
    assert (res.status_code, error(res)["code"]) == (422, "pricing_not_provisioned")
    links.fail = True
    res = link(world["deposit"])
    assert (res.status_code, error(res)["code"]) == (502, "stripe_link_failed")
    app.dependency_overrides[module.stripe_client] = lambda: None
    assert link(world["deposit"]).status_code == 503
    world["candidate"].source = CandidateSource.partner_sourced
    db.flush()
    res = link(world["deposit"])
    assert (res.status_code, error(res)["code"]) == (403, "not_self_applicant")
    assert db.scalars(select(CasePayment).where(CasePayment.case_id == case)).all() == []


# --- invoices ------------------------------------------------------------------


def invoice_body(world, **fields) -> dict:
    return {"job_payment_stage_id": world["deposit"].id, "amount": 400, "recipient": "partner", "invoice_document_id": world["invoice"].id, "invoice_reference": "INV-7"} | fields


def test_an_invoice_is_checked_then_recorded_once_sent(api, db, world):
    case = world["case"].id
    check = api.post(f"{URL}/{case}/payments/invoice/check", headers=world["finance"], json=invoice_body(world))
    assert check.status_code == 200
    assert check.json()["data"] == {
        "recipient_email": world["partner"].contact_email, "recipient_name": "Bridge Agency", "candidate_name": world["account"].full_name,
        "passport_number": "EP123", "programme_title": "Care worker", "sector_name": "Healthcare", "stage_label": "Deposit",
        "storage_path": "cases/invoice.pdf",
    }
    assert db.scalars(select(CasePayment).where(CasePayment.case_id == case)).all() == []

    res = api.post(f"{URL}/{case}/payments/invoice", headers=world["finance"], json=invoice_body(world))
    assert res.status_code == 201
    data = res.json()["data"]
    assert (data["status"], data["currency"], data["receipt_reference"], data["receipt_document_id"], data["sent_to_email"]) == (
        "pending", "GBP", "INV-7", world["invoice"].id, world["partner"].contact_email,
    )
    assert actions(db, data["id"]) == ["create"]


def test_an_invoice_file_must_be_this_candidates(api, db, world):
    other = Candidate(full_name="Someone Else")
    db.add(other)
    db.flush()
    elsewhere = Document(candidate_id=other.id, type=world["kind"].key, storage_path="x/other.pdf")
    db.add(elsewhere)
    db.flush()
    res = api.post(f"{URL}/{world['case'].id}/payments/invoice/check", headers=world["finance"], json=invoice_body(world, invoice_document_id=elsewhere.id))
    assert (res.status_code, error(res)["message"]) == (404, "Invoice file not found for this candidate.")
    world["candidate"].partner_id = None
    db.flush()
    db.expire_all()
    res = api.post(f"{URL}/{world['case'].id}/payments/invoice", headers=world["finance"], json=invoice_body(world))
    assert (res.status_code, error(res)["message"]) == (422, "This candidate has no associated partner to invoice.")


# --- one payment ---------------------------------------------------------------


def test_check_status_collects_a_link_stripe_saw_paid(api, db, world, links):
    payment = pending(db, world, stripe_payment_link_id="plink_9")
    path = f"{URL}/{world['case'].id}/payments/{payment.id}/check-status"
    unpaid = api.post(path, headers=world["finance"]).json()
    assert (unpaid["data"]["status"], unpaid["message"]) == ("pending", "No completed payment found on Stripe yet.")
    links.paid = "cs_paid"
    paid = api.post(path, headers=world["finance"]).json()
    assert (paid["data"]["status"], paid["data"]["stripe_checkout_session_id"], paid["message"]) == (
        "collected", "cs_paid", "Payment confirmed on Stripe — marked as collected.",
    )
    assert api.post(path, headers=world["finance"]).json()["message"] == "Already collected — nothing to check."
    assert actions(db, payment.id) == ["create", "update"]  # the test made it

    no_link = pending(db, world)
    res = api.post(f"{URL}/{world['case'].id}/payments/{no_link.id}/check-status", headers=world["finance"])
    assert (res.status_code, error(res)["code"]) == (422, "no_payment_link")


def test_marking_paid_needs_a_receipt_and_a_pending_payment(api, db, world):
    payment = pending(db, world)
    path = f"{URL}/{world['case'].id}/payments/{payment.id}/mark-paid"
    res = api.post(path, headers=world["finance"], json={})
    assert (res.status_code, error(res)["message"]) == (422, "A receipt file is required to mark this payment as paid.")
    res = api.post(path, headers=world["finance"], json={"receipt_document_id": f"c{secrets.token_hex(12)}"})
    assert (res.status_code, error(res)["message"]) == (404, "Receipt document not found.")
    res = api.post(path, headers=world["finance"], json={"receipt_document_id": world["invoice"].id})
    assert (res.json()["data"]["status"], res.json()["data"]["receipt_document_id"], res.json()["message"]) == ("collected", world["invoice"].id, "Marked as paid.")
    res = api.post(path, headers=world["finance"], json={"receipt_document_id": world["invoice"].id})
    assert (res.status_code, error(res)["message"]) == (422, "Already collected — nothing to mark.")


def test_a_receipt_is_swapped_or_removed(api, db, world):
    payment = pending(db, world, receipt_document_id=world["invoice"].id)
    path = f"{URL}/{world['case'].id}/payments/{payment.id}/receipt"
    assert api.patch(path, headers=world["finance"], json={"receipt_document_id": None}).json()["data"]["receipt_document_id"] is None
    assert api.patch(path, headers=world["finance"], json={"receipt_document_id": world["invoice"].id}).json()["data"]["receipt_document_id"] == world["invoice"].id
    res = api.patch(path, headers=world["finance"], json={})
    assert (res.status_code, error(res)["message"]) == (422, "Invalid document id.")
    res = api.patch(path, headers=world["finance"], json={"receipt_document_id": f"c{secrets.token_hex(12)}"})
    assert (res.status_code, error(res)["message"]) == (404, "Replacement file not found.")


def test_only_finance_removes_a_payment_record(api, db, world):
    payment = pending(db, world)
    path = f"{URL}/{world['case'].id}/payments/{payment.id}"
    assert api.delete(path, headers=world["director"]).status_code == 403
    assert api.delete(f"{URL}/c{secrets.token_hex(12)}/payments/{payment.id}", headers=world["finance"]).status_code == 404
    res = api.delete(path, headers=world["finance"])
    assert (res.status_code, res.json()) == (200, {"data": None, "message": "Payment record removed."})
    assert db.get(CasePayment, payment.id) is None
    assert actions(db, payment.id) == ["create", "delete"]  # the test made it


# --- as the API's database role ---------------------------------------------


def test_the_api_database_role_can_write_them(api, db, world):
    db.execute(text("SET LOCAL ROLE vertex_api"))
    try:
        recorded = api.post(f"{URL}/{world['case'].id}/payments", headers=world["finance"], json={"job_payment_stage_id": world["deposit"].id, "amount": 5})
        receipt = api.patch(f"{URL}/{world['case'].id}/payments/{recorded.json()['data']['id']}/receipt", headers=world["finance"], json={"receipt_document_id": None})
        removed = api.delete(f"{URL}/{world['case'].id}/payments/{recorded.json()['data']['id']}", headers=world["finance"])
    finally:
        db.execute(text("RESET ROLE"))
    assert (recorded.status_code, receipt.status_code, removed.status_code) == (201, 200, 200)
