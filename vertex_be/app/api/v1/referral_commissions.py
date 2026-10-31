"""Referral commission payouts, owned by FastAPI since the pipeline switch
(docs/architecture/pipeline-handover.md, step 6.7): a director or admin
approves a pending commission, then marks it paid. Commissions are earned
in the pipeline itself (app/services/referrals.py). The commission rules
(an amount per country and milestone) since payments step 7.1
(docs/architecture/payments-handover.md), replacing POST
/api/admin/referral-commission-rules.

They answer as Next.js's POST /api/admin/referral-commissions/[id]/approve
and /mark-paid did, which now pass requests on: the same roles, states,
messages and status codes. The agent's email goes back in `notify` (D1).
Every change is on the audit trail (ReferralCommission is in
AUDITED_MODELS).
"""

from __future__ import annotations

from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.api.notices import CommissionApprovedEmail, CommissionPaidEmail, Notifying
from app.core.api import ApiError, Data, UtcDateTime
from app.core.audit import AuditedDb
from app.core.auth import AuthUser
from app.core.clock import utc_now_ms
from app.core.pipeline import PipelineWrites
from app.core.rbac import REFERRAL_AGENT_MANAGER_ROLES, require_role
from app.models.enums import ReferralCommissionStatus, ReferralMilestone
from app.models.referral import ReferralCommission, ReferralCommissionRule

router = APIRouter()

Manager = Annotated[AuthUser, Depends(require_role(*REFERRAL_AGENT_MANAGER_ROLES))]


def _now() -> datetime:
    return utc_now_ms()


class PaidIn(BaseModel):
    payment_reference: str | None = Field(None, max_length=200)
    payment_method: str | None = Field(None, max_length=100)


class CommissionRow(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    referral_agent_id: str
    candidate_id: str
    case_id: str | None
    milestone: ReferralMilestone
    commission_rule_id: str | None
    amount: float
    currency: str
    status: ReferralCommissionStatus
    approved_by_id: str | None
    approved_at: UtcDateTime | None
    paid_by_id: str | None
    paid_at: UtcDateTime | None
    payment_reference: str | None
    payment_method: str | None
    created_at: UtcDateTime
    updated_at: UtcDateTime


def _load(db, commission_id: str) -> ReferralCommission:
    commission = db.get(ReferralCommission, commission_id)
    if commission is None:
        raise ApiError(404, "not_found", "Commission not found.")
    return commission


def _for_agent(commission: ReferralCommission) -> dict:
    return {
        "email": commission.referral_agent.email,
        "agent_name": commission.referral_agent.full_name,
        "candidate_name": commission.candidate.full_name or "your referral",
        "amount": float(commission.amount),
        "currency": commission.currency,
    }


@router.post("/referral-commissions/{commission_id}/approve", response_model=Notifying[CommissionRow])
def approve(commission_id: str, user: Manager, db: AuditedDb, _on: PipelineWrites):
    """pending -> approved. A zero commission is settled as paid when it's
    earned, so only a payable amount gets here."""
    commission = _load(db, commission_id)
    if commission.status is not ReferralCommissionStatus.pending:
        raise ApiError(422, "not_pending", f"Already {commission.status.value} — nothing to approve.")
    commission.status = ReferralCommissionStatus.approved
    commission.approved_by_id = user.user_id
    commission.approved_at = _now()
    db.commit()
    db.refresh(commission)
    return {"data": commission, "notify": [CommissionApprovedEmail(**_for_agent(commission))]}


@router.post("/referral-commissions/{commission_id}/mark-paid", response_model=Notifying[CommissionRow])
def mark_paid(commission_id: str, body: PaidIn, user: Manager, db: AuditedDb, _on: PipelineWrites):
    """approved -> paid; the reference and method are optional."""
    commission = _load(db, commission_id)
    if commission.status is not ReferralCommissionStatus.approved:
        raise ApiError(422, "not_approved", f"Must be approved before it can be marked paid (currently {commission.status.value}).")
    commission.status = ReferralCommissionStatus.paid
    commission.paid_by_id = user.user_id
    commission.paid_at = _now()
    commission.payment_reference = body.payment_reference
    commission.payment_method = body.payment_method
    db.commit()
    db.refresh(commission)
    return {"data": commission, "notify": [CommissionPaidEmail(**_for_agent(commission))]}


# --- commission rules (payments step 7.1) -------------------------------------

CUID = r"^c[^\s-]{8,}$"
UNIQUE_VIOLATION = "23505"
FOREIGN_KEY_VIOLATION = "23503"


class RuleIn(BaseModel):
    """upsertReferralCommissionRuleSchema. Zero is a real amount: some
    milestones pay nothing."""

    country_id: str = Field(pattern=CUID)
    milestone: ReferralMilestone
    amount: float = Field(ge=0)
    currency: str = Field("USD", min_length=1, max_length=10)


class RuleRow(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    country_id: str
    milestone: ReferralMilestone
    amount: float
    currency: str
    updated_by: str
    created_at: UtcDateTime
    updated_at: UtcDateTime


@router.post("/referral-commission-rules", response_model=Data[RuleRow])
def upsert_rule(body: RuleIn, user: Manager, db: AuditedDb):
    """One rule per (country, milestone): the existing one is updated. A
    rule saved by a concurrent request is updated on a second try."""

    def save() -> ReferralCommissionRule:
        rule = db.scalar(
            select(ReferralCommissionRule).where(ReferralCommissionRule.country_id == body.country_id, ReferralCommissionRule.milestone == body.milestone)
        )
        if rule is None:
            rule = ReferralCommissionRule(country_id=body.country_id, milestone=body.milestone)
            db.add(rule)
        rule.amount = body.amount
        rule.currency = body.currency
        rule.updated_by = user.user_id
        db.commit()
        return rule

    try:
        rule = save()
    except IntegrityError as err:
        db.rollback()
        code = getattr(err.orig, "pgcode", None)
        if code == FOREIGN_KEY_VIOLATION:
            raise ApiError(422, "validation_error", "Country not found.") from None
        if code != UNIQUE_VIOLATION:
            raise
        rule = save()
    db.refresh(rule)
    return {"data": rule}
