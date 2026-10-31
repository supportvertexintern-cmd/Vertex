"""Card and PayPal payments, owned by FastAPI since payments step 7.2
(docs/architecture/payments-handover.md): the Stripe webhook, and PayPal
orders for application fees.

The webhook (owner's decision D1). Stripe keeps calling the website's
/api/webhooks/stripe, which passes the body and the Stripe-Signature
header on unchanged; this checks Stripe's signature itself, so it never
takes the website's word for an event. A completed Checkout Session is:
  - a consultation booking (metadata type "consultation"),
  - a paid case payment link (metadata case_id: its pending CasePayment is
    collected; CasePayment's other writers move in step 7.3), or
  - an application fee by card (metadata userId and jobId).
Stripe delivers an event at least once, so each write is idempotent.

PayPal (D2): creating the order, and capturing it once FastAPI has checked
with PayPal that it's this user's order for this job's fee.

The website builds the receipts and sends the emails (D3), listed in
`notify`. Every write is on the audit trail (Payment, ConsultationBooking
and CasePayment are in AUDITED_MODELS), which fixes gap G22: the website
wrote these without it.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime
from typing import Any

import httpx
import stripe
from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.api.deps import DbSession
from app.api.notices import ConsultationBookedEmail, Notice, Notifying, PaymentReceiptEmail
from app.core.api import ApiError, Data, UtcDateTime
from app.core.audit import AuditedDb, set_audit_actor
from app.core.auth import CurrentUser, calling_service
from app.core.clock import utc_now_ms
from app.core.config import settings
from app.core.logging import log_event
from app.models.cases import CasePayment
from app.models.enums import CasePaymentStatus, PaymentStatus
from app.models.identity import User
from app.models.jobs import Job
from app.models.payments import ConsultationBooking, Payment
from app.services import paypal

router = APIRouter()

SIGNATURE_HEADER = "Stripe-Signature"


def _now() -> datetime:
    return utc_now_ms()


def _iso(value: datetime) -> str:
    return value.isoformat(timespec="milliseconds") + "Z"


class Received(BaseModel):
    received: bool = True


class PaymentRow(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    user_id: str
    job_id: str
    amount: float
    currency: str
    payment_method: str
    payment_status: PaymentStatus
    transaction_id: str | None
    created_at: UtcDateTime


def _receipt(db, payment: Payment, job_title: str) -> list[Notice]:
    user = db.get(User, payment.user_id)
    if user is None:
        return []
    return [
        PaymentReceiptEmail(
            payment_id=payment.id,
            full_name=user.full_name,
            email=user.email,
            job_title=job_title,
            amount=payment.amount,
            transaction_id=payment.transaction_id or "",
            date=_iso(payment.created_at),
        )
    ]


def _saved(db) -> bool:
    """Commits; False if a duplicate delivery got there first."""
    try:
        db.commit()
        return True
    except IntegrityError:
        db.rollback()
        return False


# --- the Stripe webhook --------------------------------------------------------


def _id(value: Any) -> str | None:
    """A Stripe reference, given as an id or an expanded object."""
    if value is None or isinstance(value, str):
        return value
    return value.get("id")


def _consultation(db, session: dict[str, Any]) -> list[Notice]:
    if db.scalar(select(ConsultationBooking.id).where(ConsultationBooking.stripe_checkout_session_id == session["id"])):
        return []
    details = session.get("customer_details") or {}
    booking = ConsultationBooking(
        full_name=details.get("name"),
        email=details.get("email") or "",
        phone=details.get("phone"),
        amount=(session.get("amount_total") or 0) / 100,
        currency=(session.get("currency") or "usd").upper(),
        stripe_checkout_session_id=session["id"],
        stripe_payment_intent_id=_id(session.get("payment_intent")),
    )
    db.add(booking)
    if not _saved(db):
        return []
    return [ConsultationBookedEmail(full_name=booking.full_name, email=booking.email, phone=booking.phone, amount=booking.amount, currency=booking.currency)]


def _case_payment(db, session: dict[str, Any], case_id: str) -> None:
    """The pending payment for exactly this link, collected."""
    link_id = _id(session.get("payment_link"))
    if not link_id:
        return
    pending = db.scalar(
        select(CasePayment).where(
            CasePayment.case_id == case_id, CasePayment.stripe_payment_link_id == link_id, CasePayment.status == CasePaymentStatus.pending
        )
    )
    if pending is not None:
        pending.status = CasePaymentStatus.collected
        pending.stripe_checkout_session_id = session["id"]
        pending.recorded_at = _now()
        _saved(db)


def _application_fee(db, session: dict[str, Any], metadata: dict[str, Any]) -> list[Notice]:
    user_id, job_id = metadata.get("userId"), metadata.get("jobId")
    transaction_id = _id(session.get("payment_intent"))
    if not user_id or not job_id or not transaction_id:
        return []
    if db.scalar(select(Payment.id).where(Payment.transaction_id == transaction_id)):
        return []
    payment = Payment(
        user_id=user_id,
        job_id=job_id,
        amount=(session.get("amount_total") or 0) / 100,
        currency="USD",
        payment_method="stripe",
        payment_status=PaymentStatus.completed,
        transaction_id=transaction_id,
    )
    db.add(payment)
    if not _saved(db):
        return []
    db.refresh(payment)
    return _receipt(db, payment, metadata.get("jobTitle") or "Job")


@router.post("/payments/stripe/webhook", response_model=Notifying[Received], dependencies=[Depends(calling_service)])
async def stripe_webhook(request: Request, db: DbSession):
    """Stripe's event, passed on by the website as it came."""
    secret = settings.STRIPE_WEBHOOK_SECRET
    if not secret:
        # Stripe retries for days: nothing is lost while this is set up.
        raise ApiError(503, "webhook_not_configured", "The Stripe webhook isn't configured.")
    payload = await request.body()
    try:
        stripe.Webhook.construct_event(payload, request.headers.get(SIGNATURE_HEADER, ""), secret)
        # Verified: read it as plain JSON, independent of the SDK's objects.
        event = json.loads(payload)
    except (ValueError, stripe.SignatureVerificationError) as err:
        log_event(logging.WARNING, "payments.webhook_rejected", reason=type(err).__name__)
        raise ApiError(400, "invalid_signature", "Webhook signature verification failed.") from None

    set_audit_actor(db, None)  # Stripe, not a signed-in user
    notify: list[Notice] = []
    if event["type"] == "checkout.session.completed":
        session = event["data"]["object"]
        metadata = session.get("metadata") or {}
        if metadata.get("type") == "consultation":
            notify = _consultation(db, session)
        elif metadata.get("case_id"):
            _case_payment(db, session, metadata["case_id"])
        else:
            notify = _application_fee(db, session, metadata)
    return {"data": {"received": True}, "notify": notify}


# --- PayPal (application fees) -----------------------------------------------


class OrderIn(BaseModel):
    jobId: str = Field(min_length=1)  # noqa: N815  (the website's field name)


class CaptureIn(OrderIn):
    pass


class Order(BaseModel):
    id: str


def _fee_job(db, job_id: str) -> Job:
    job = db.get(Job, job_id)
    if job is None:
        raise ApiError(404, "not_found", "Job not found.")
    if not job.application_fee or job.application_fee <= 0:
        raise ApiError(400, "no_fee", "This job does not require an application fee.")
    return job


@router.post("/payments/paypal/orders", response_model=Data[Order])
def create_paypal_order(body: OrderIn, user: CurrentUser, db: DbSession):
    """A PayPal order for the signed-in user's application fee."""
    job = _fee_job(db, body.jobId)
    try:
        order_id = paypal.create_order(job.id, user.user_id, job.title, job.application_fee)
    except paypal.PayPalNotConfigured:
        raise ApiError(503, "paypal_unavailable", "PayPal isn't available right now.") from None
    except (paypal.PayPalError, httpx.HTTPError) as err:
        log_event(logging.ERROR, "payments.paypal_create_failed", error=str(err))
        raise ApiError(502, "paypal_error", "Failed to initialize PayPal order.") from None
    return {"data": {"id": order_id}}


@router.post("/payments/paypal/orders/{order_id}/capture", response_model=Notifying[PaymentRow])
def capture_paypal_order(order_id: str, body: CaptureIn, user: CurrentUser, db: AuditedDb):
    """Captures the user's approved order, once PayPal confirms it's theirs
    for this job's fee, and records the payment."""
    job = _fee_job(db, body.jobId)
    try:
        capture = paypal.capture_order(order_id, job.id, user.user_id, job.application_fee)
    except paypal.PayPalNotConfigured:
        raise ApiError(503, "paypal_unavailable", "PayPal isn't available right now.") from None
    except (paypal.PayPalError, httpx.HTTPError) as err:
        log_event(logging.WARNING, "payments.paypal_capture_failed", error=str(err))
        raise ApiError(400, "capture_failed", "Payment could not be captured.") from None

    payment = db.scalar(select(Payment).where(Payment.transaction_id == capture.capture_id))
    if payment is None:
        payment = Payment(
            user_id=user.user_id,
            job_id=job.id,
            amount=job.application_fee,
            currency="USD",
            payment_method="paypal",
            payment_status=PaymentStatus.completed,
            transaction_id=capture.capture_id,
        )
        db.add(payment)
        db.commit()
        db.refresh(payment)
    return {"data": payment, "notify": _receipt(db, payment, job.title)}

