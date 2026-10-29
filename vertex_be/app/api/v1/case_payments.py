"""A case's milestone payments, written by FastAPI since payments step 7.3
(docs/architecture/payments-handover.md): the website's
/api/cases/[id]/payments/... routes pass each write on, rule for rule.

Finance (Director and Admin keep the override, FINANCE_ROLES) records a
payment, sends a Stripe Payment Link or an invoice, reconciles a link with
Stripe, marks a pending payment paid and swaps its receipt. Removing a
payment record is Finance's own correction, so it's the finance role only.
Every write needs access to the case, and every client-supplied id (stage,
document) is checked against the case before it's used.

Recording, linking and invoicing are gated by the effective FeePolicy (the
candidate's country's, else the global one).

The invoice email carries the uploaded file and must be sent before the
payment is recorded, so a failed send never leaves an "invoiced" payment
behind. The website checks first (/invoice/check, which writes nothing),
reads and scans the file, sends it, then records (/invoice, which checks
again). The link email is listed in `notify` as usual.

Every write is on the audit trail (CasePayment is in AUDITED_MODELS).
"""

from __future__ import annotations

import logging
import re
from datetime import UTC, datetime
from typing import Annotated, Any, Literal

import stripe
from fastapi import APIRouter, Depends, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select

from app.api.notices import MilestonePaymentLinkEmail, MilestonePlanStage, Notifying
from app.core.api import ApiError, Data, UtcDateTime
from app.core.audit import AuditedDb
from app.core.auth import AuthUser
from app.core.logging import log_event
from app.core.rbac import FINANCE_ROLES, require_role
from app.core.scope import CandidateRef, can_access_case
from app.models.candidate import Candidate, Document
from app.models.cases import Case, CasePayment, FeePolicy
from app.models.enums import CandidateSource, CasePaymentStatus, Role
from app.models.jobs import JobPaymentStage
from app.services.stripe_links import PaymentLinkClient, payment_link_client
from app.services.stripe_pricing import payment_stage_amounts

router = APIRouter()

CUID = r"^c[^\s-]{8,}$"  # zod's .cuid()

Finance = Annotated[AuthUser, Depends(require_role(*FINANCE_ROLES))]
# Undoing a payment record is Finance's own correction: no override.
REMOVERS = (Role.finance,)
Remover = Annotated[AuthUser, Depends(require_role(*REMOVERS))]


def stripe_client() -> PaymentLinkClient | None:
    return payment_link_client()


Stripe = Annotated[PaymentLinkClient | None, Depends(stripe_client)]


def _now() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


# --- input and output --------------------------------------------------------


class RecordIn(BaseModel):
    job_payment_stage_id: str = Field(pattern=CUID)
    amount: float = Field(gt=0)
    currency: str = Field("USD", min_length=3, max_length=3)
    receipt_reference: str | None = Field(None, max_length=200)
    receipt_document_id: str | None = Field(None, pattern=CUID)


class LinkIn(BaseModel):
    job_payment_stage_id: str = Field(pattern=CUID)
    recipient: Literal["candidate", "partner"]


class InvoiceIn(BaseModel):
    job_payment_stage_id: str = Field(pattern=CUID)
    amount: float = Field(gt=0)
    recipient: Literal["candidate", "partner"]
    invoice_document_id: str = Field(pattern=CUID)
    invoice_reference: str | None = Field(None, max_length=200)


class ReceiptIn(BaseModel):
    # Checked by hand, so a bad value answers with the website's own message.
    receipt_document_id: Any = None


class CasePaymentRow(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    case_id: str
    job_payment_stage_id: str
    type: str | None
    amount: float
    currency: str
    receipt_reference: str | None
    receipt_document_id: str | None
    recorded_by: str
    recorded_at: UtcDateTime
    status: CasePaymentStatus
    stripe_payment_link_id: str | None
    stripe_payment_link_url: str | None
    stripe_checkout_session_id: str | None
    sent_to_email: str | None


class LinkOut(BaseModel):
    payment: CasePaymentRow
    url: str


class InvoicePlan(BaseModel):
    """What the website needs to send the invoice email."""

    recipient_email: str
    recipient_name: str
    candidate_name: str
    passport_number: str | None
    programme_title: str
    sector_name: str | None
    stage_label: str
    storage_path: str


class PaymentAnswer(BaseModel):
    data: CasePaymentRow
    message: str


class Removed(BaseModel):
    data: None = None  # the envelope the website reads; nothing is left to show
    message: str


# --- helpers -------------------------------------------------------------------


def _case(db, case_id: str, user: AuthUser) -> Case:
    case = db.get(Case, case_id)
    if case is None:
        raise ApiError(404, "not_found", "Case not found.")
    if not can_access_case(db, user, CandidateRef.of(case.application.candidate)):
        raise ApiError(403, "forbidden", "Forbidden.")
    return case


def _payment(db, case_id: str, payment_id: str, user: AuthUser) -> CasePayment:
    payment = db.get(CasePayment, payment_id)
    if payment is None or payment.case_id != case_id:
        raise ApiError(404, "not_found", "Payment not found.")
    if not can_access_case(db, user, CandidateRef.of(payment.case.application.candidate)):
        raise ApiError(403, "forbidden", "Forbidden.")
    return payment


def _require_fee_policy(db, candidate: Candidate) -> None:
    """The candidate's country's policy, else the global one, must be on."""
    policy = None
    if candidate.country_id:
        policy = db.scalars(select(FeePolicy).where(FeePolicy.country_id == candidate.country_id).limit(1)).first()
    if policy is None:
        policy = db.scalars(select(FeePolicy).where(FeePolicy.country_id.is_(None)).limit(1)).first()
    if policy is None or not policy.enabled:
        raise ApiError(
            403, "fee_policy_disabled", "Milestone payments are not enabled for this destination. In-House must enable the fee policy first."
        )


def _stage(db, case: Case, stage_id: str) -> JobPaymentStage:
    """The stage, only if it belongs to this case's own job."""
    job_id = case.application.job_id
    stage = db.get(JobPaymentStage, stage_id) if job_id else None
    if stage is None or stage.job_id != job_id:
        raise ApiError(404, "not_found", "Payment stage not found for this case's opportunity.")
    return stage


def _candidate_name(candidate: Candidate, fallback: str) -> str:
    return (candidate.user.full_name if candidate.user else candidate.full_name) or fallback


def _candidate_email(candidate: Candidate) -> str | None:
    return candidate.user.email if candidate.user else candidate.email


def _stripe_message(err: Exception, fallback: str) -> str:
    return getattr(err, "user_message", None) or fallback


# --- recording -----------------------------------------------------------------


@router.post("/cases/{case_id}/payments", response_model=Data[CasePaymentRow], status_code=status.HTTP_201_CREATED)
def record_payment(case_id: str, body: RecordIn, user: Finance, db: AuditedDb):
    """POST /api/cases/[id]/payments: Finance records a collected milestone
    payment, with a receipt reference or file (SRS FR-4.5)."""
    case = _case(db, case_id, user)
    stage = _stage(db, case, body.job_payment_stage_id)
    _require_fee_policy(db, case.application.candidate)
    payment = CasePayment(
        case_id=case_id,
        job_payment_stage_id=stage.id,
        amount=body.amount,
        currency=body.currency,
        receipt_reference=body.receipt_reference,
        receipt_document_id=body.receipt_document_id,
        recorded_by=user.user_id,
    )
    db.add(payment)
    db.commit()
    db.refresh(payment)
    return {"data": payment}


@router.post("/cases/{case_id}/payments/link", response_model=Notifying[LinkOut], status_code=status.HTTP_201_CREATED)
def send_payment_link(case_id: str, body: LinkIn, user: Finance, db: AuditedDb, client: Stripe):
    """POST /api/cases/[id]/payments/link: a Stripe Payment Link for one
    stage, on the stage's provisioned Price, for a self-applicant's case.
    Pending until the webhook (or check-status) sees it paid."""
    case = _case(db, case_id, user)
    candidate = case.application.candidate
    if candidate.source != CandidateSource.self_registered:
        raise ApiError(
            403,
            "not_self_applicant",
            "Stripe payment links are only available for self-applicants. Record this payment manually with a receipt instead.",
        )
    _require_fee_policy(db, candidate)
    job = case.application.job
    if job is None:
        raise ApiError(
            422,
            "no_opportunity",
            "This case has no linked opportunity, so there's no pre-provisioned Stripe pricing to link to. Use the manual Record form instead.",
        )
    stages = sorted(job.payment_stages, key=lambda s: s.order)
    stage = next((s for s in stages if s.id == body.job_payment_stage_id), None)
    if stage is None:
        raise ApiError(404, "not_found", "Payment stage not found for this case's opportunity.")
    if not stage.stripe_price_id or stage.synced_amount_gbp is None:
        raise ApiError(
            422,
            "pricing_not_provisioned",
            "Stripe pricing hasn't been provisioned for this payment stage yet. Try 'Retry Stripe Pricing' on the opportunity's edit page first.",
        )

    if body.recipient == "partner":
        if candidate.partner is None:
            raise ApiError(422, "no_partner", "This candidate has no associated partner to send a payment link to.")
        email, name = candidate.partner.contact_email, candidate.partner.contact_name
    else:
        email, name = _candidate_email(candidate), _candidate_name(candidate, "there")
    if not email:
        raise ApiError(422, "no_email", "No email on file for the selected recipient.")

    if client is None:
        raise ApiError(503, "stripe_unavailable", "Stripe isn't configured.")
    try:
        link_id, url = client.create_link(price=stage.stripe_price_id, metadata={"case_id": case_id, "job_payment_stage_id": stage.id})
    except stripe.StripeError as err:
        log_event(logging.ERROR, "payments.stripe_link_failed", case_id=case_id, error=str(err))
        raise ApiError(502, "stripe_link_failed", _stripe_message(err, "Failed to create Stripe payment link.")) from None

    payment = CasePayment(
        case_id=case_id,
        job_payment_stage_id=stage.id,
        amount=stage.synced_amount_gbp,
        currency="GBP",
        recorded_by=user.user_id,
        status=CasePaymentStatus.pending,
        stripe_payment_link_id=link_id,
        stripe_payment_link_url=url,
        sent_to_email=email,
    )
    db.add(payment)
    db.commit()
    db.refresh(payment)

    amounts = payment_stage_amounts(job.service_fee_gbp or 0, [s.percent for s in stages])
    plan = [
        MilestonePlanStage(id=s.id, label=s.label, percent=s.percent, amount=amount, trigger_stage=s.trigger_stage)
        for s, amount in zip(stages, amounts, strict=True)
        if amount > 0
    ]
    notice = MilestonePaymentLinkEmail(
        email=email,
        recipient_name=name,
        candidate_name=_candidate_name(candidate, "the candidate"),
        programme_title=job.title,
        payment_url=url,
        current_stage_id=stage.id,
        stages=plan,
    )
    return {"data": {"payment": payment, "url": url}, "notify": [notice]}


def _invoice_plan(db, case_id: str, body: InvoiceIn, user: AuthUser) -> tuple[Case, JobPaymentStage, InvoicePlan]:
    case = _case(db, case_id, user)
    candidate = case.application.candidate
    _require_fee_policy(db, candidate)
    # Uploaded by Finance for this candidate just before; the id is the
    # client's, so it's checked.
    document = db.get(Document, body.invoice_document_id)
    if document is None or document.candidate_id != candidate.id:
        raise ApiError(404, "not_found", "Invoice file not found for this candidate.")

    candidate_name = _candidate_name(candidate, "the candidate")
    if body.recipient == "partner":
        if candidate.partner is None:
            raise ApiError(422, "no_partner", "This candidate has no associated partner to invoice.")
        # The letter's greeting is the partner company's name.
        email, name = candidate.partner.contact_email, candidate.partner.name
    else:
        email, name = _candidate_email(candidate), candidate_name
    if not email:
        raise ApiError(422, "no_email", "No email on file for the selected recipient.")

    stage = _stage(db, case, body.job_payment_stage_id)
    job = case.application.job
    plan = InvoicePlan(
        recipient_email=email,
        recipient_name=name,
        candidate_name=candidate_name,
        passport_number=candidate.passport_number,
        programme_title=job.title if job else "",
        sector_name=job.category if job else None,
        stage_label=stage.label,
        storage_path=document.storage_path,
    )
    return case, stage, plan


@router.post("/cases/{case_id}/payments/invoice/check", response_model=Data[InvoicePlan])
def check_invoice(case_id: str, body: InvoiceIn, user: Finance, db: AuditedDb):
    """The invoice's checks, writing nothing: what the website needs to send
    the email before /invoice records it."""
    return {"data": _invoice_plan(db, case_id, body, user)[2]}


@router.post("/cases/{case_id}/payments/invoice", response_model=Data[CasePaymentRow], status_code=status.HTTP_201_CREATED)
def record_invoice(case_id: str, body: InvoiceIn, user: Finance, db: AuditedDb):
    """POST /api/cases/[id]/payments/invoice, once the website has sent the
    email: a pending payment for the invoiced stage."""
    _, stage, plan = _invoice_plan(db, case_id, body, user)
    payment = CasePayment(
        case_id=case_id,
        job_payment_stage_id=stage.id,
        amount=body.amount,
        currency="GBP",
        receipt_reference=body.invoice_reference,
        receipt_document_id=body.invoice_document_id,
        recorded_by=user.user_id,
        status=CasePaymentStatus.pending,
        sent_to_email=plan.recipient_email,
    )
    db.add(payment)
    db.commit()
    db.refresh(payment)
    return {"data": payment}


# --- one payment ---------------------------------------------------------------


@router.post("/cases/{case_id}/payments/{payment_id}/check-status", response_model=PaymentAnswer)
def check_status(case_id: str, payment_id: str, user: Finance, db: AuditedDb, client: Stripe):
    """POST /api/cases/[id]/payments/[paymentId]/check-status: asks Stripe
    whether the payment's link has been paid, for when the webhook never
    came, and collects it if so."""
    payment = _payment(db, case_id, payment_id, user)
    if payment.status != CasePaymentStatus.pending:
        return {"data": payment, "message": f"Already {payment.status.value} — nothing to check."}
    if not payment.stripe_payment_link_id:
        raise ApiError(422, "no_payment_link", "This payment has no Stripe Payment Link to check against.")
    if client is None:
        raise ApiError(503, "stripe_unavailable", "Stripe isn't configured.")
    try:
        session_id = client.paid_session(payment.stripe_payment_link_id)
    except stripe.StripeError as err:
        log_event(logging.ERROR, "payments.stripe_check_failed", payment_id=payment_id, error=str(err))
        raise ApiError(502, "stripe_check_failed", _stripe_message(err, "Failed to check Stripe.")) from None
    if session_id is None:
        return {"data": payment, "message": "No completed payment found on Stripe yet."}

    payment.status = CasePaymentStatus.collected
    payment.stripe_checkout_session_id = session_id
    payment.recorded_at = _now()
    db.commit()
    db.refresh(payment)
    return {"data": payment, "message": "Payment confirmed on Stripe — marked as collected."}


def _document_id(value: Any, *, nullable: bool, message: str) -> str | None:
    if value is None and nullable:
        return None
    if not isinstance(value, str) or not re.match(CUID, value):
        raise ApiError(422, "validation_error", message)
    return value


@router.post("/cases/{case_id}/payments/{payment_id}/mark-paid", response_model=PaymentAnswer)
def mark_paid(case_id: str, payment_id: str, body: ReceiptIn, user: Finance, db: AuditedDb):
    """POST /api/cases/[id]/payments/[paymentId]/mark-paid: Finance confirms
    a pending payment arrived (a bank transfer, say), with the uploaded
    receipt as the proof, so a receipt is required."""
    document_id = _document_id(body.receipt_document_id, nullable=False, message="A receipt file is required to mark this payment as paid.")
    payment = _payment(db, case_id, payment_id, user)
    if payment.status != CasePaymentStatus.pending:
        raise ApiError(422, "not_pending", f"Already {payment.status.value} — nothing to mark.")
    if db.get(Document, document_id) is None:
        raise ApiError(404, "not_found", "Receipt document not found.")
    payment.status = CasePaymentStatus.collected
    payment.recorded_at = _now()
    payment.receipt_document_id = document_id
    db.commit()
    db.refresh(payment)
    return {"data": payment, "message": "Marked as paid."}


@router.patch("/cases/{case_id}/payments/{payment_id}/receipt", response_model=Data[CasePaymentRow])
def set_receipt(case_id: str, payment_id: str, body: ReceiptIn, user: Finance, db: AuditedDb):
    """PATCH /api/cases/[id]/payments/[paymentId]/receipt: attaches, swaps
    or (with null) removes a payment's invoice or receipt file, in either
    status."""
    if "receipt_document_id" not in body.model_fields_set:
        raise ApiError(422, "validation_error", "Invalid document id.")
    document_id = _document_id(body.receipt_document_id, nullable=True, message="Invalid document id.")
    payment = _payment(db, case_id, payment_id, user)
    if document_id and db.get(Document, document_id) is None:
        raise ApiError(404, "not_found", "Replacement file not found.")
    payment.receipt_document_id = document_id
    db.commit()
    db.refresh(payment)
    return {"data": payment}


@router.delete("/cases/{case_id}/payments/{payment_id}", response_model=Removed)
def remove_payment(case_id: str, payment_id: str, user: Remover, db: AuditedDb):
    """DELETE /api/cases/[id]/payments/[paymentId]: Finance removes a
    payment recorded in error, in either status. Nothing references a
    CasePayment; its receipt file is kept."""
    payment = _payment(db, case_id, payment_id, user)
    db.delete(payment)
    db.commit()
    return {"data": None, "message": "Payment record removed."}
