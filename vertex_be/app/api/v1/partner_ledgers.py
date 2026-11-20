"""The partner commission and admin-fee ledgers (Phase 6, upstream staging):
what the engine (app/services/partner_commissions.py) records, listed,
approved and paid, and the rules grid it reads.

- The lists are the partner managers' (in-house supervisor, director,
  admin). They show what's due: one-off rows, and the months that have
  arrived. The months still ahead are in the partner's statement, as
  scheduled.
- Approving and paying a commission, and editing the rules, move money:
  directors and admins (REFERRAL_AGENT_MANAGER_ROLES, as upstream).
- A month that hasn't started can't be approved or paid (upstream's
  SEC-BIZ-013), and of simultaneous requests only the first finds the row
  in the status it needs (SEC-BIZ-004): the row is read under a lock, so it
  changes, is audited and emailed once.
"""

from __future__ import annotations

from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, ConfigDict, Field, StringConstraints
from sqlalchemy import or_, select
from sqlalchemy.orm import Session, selectinload

from app.api.deps import DbSession
from app.api.notices import Notifying, PartnerCommissionApprovedEmail, PartnerCommissionPaidEmail
from app.api.v1.partner_tracking import MANAGERS
from app.core.api import ApiError, Data, UtcDateTime
from app.core.audit import AuditedDb
from app.core.auth import AuthUser
from app.core.clock import utc_now_ms
from app.core.rbac import REFERRAL_AGENT_MANAGER_ROLES, require_role
from app.models.enums import AdminFeeType, CommissionStatus, PartnerCommissionRuleType, Role
from app.models.partner_tracking import AdminFee, PartnerCommission, PartnerCommissionRule
from app.services.emails import deliver
from app.services.partner_flags import commission_due, current_period

router = APIRouter()

PAYERS: tuple[Role, ...] = tuple(sorted(REFERRAL_AGENT_MANAGER_ROLES, key=lambda r: r.value))
Lister = Annotated[AuthUser, Depends(require_role(*MANAGERS))]
Payer = Annotated[AuthUser, Depends(require_role(*PAYERS))]
LIST_SIZE = 200


def _enum_filter(raw: str | None, enum):
    """A comma-separated filter of an enum's values; unknown values are ignored."""
    if not raw:
        return None
    values = [enum(v) for v in (x.strip() for x in raw.split(",")) if v in enum._value2member_map_]
    return values or None


class PartnerRef(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    contact_email: str


class PartnerName(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str


class CandidateRef(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    full_name: str | None


class CommissionRow(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    partner_id: str
    candidate_id: str
    case_id: str | None
    rule_type: PartnerCommissionRuleType
    period: str
    amount: float
    currency: str
    status: CommissionStatus
    approved_by: str | None
    approved_at: UtcDateTime | None
    paid_by: str | None
    paid_at: UtcDateTime | None
    payment_reference: str | None
    payment_method: str | None
    created_at: UtcDateTime
    partner: PartnerRef
    candidate: CandidateRef


class FeeRow(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    partner_id: str
    candidate_id: str
    case_id: str | None
    fee_type: AdminFeeType
    period: str
    amount: float
    currency: str
    status: CommissionStatus
    paid_at: UtcDateTime | None
    payment_reference: str | None
    created_at: UtcDateTime
    partner: PartnerName
    candidate: CandidateRef


# --- the lists ---------------------------------------------------------------------


@router.get("/partner-commissions")
def list_commissions(
    _user: Lister,
    db: DbSession,
    partner_id: Annotated[str | None, Query(alias="partnerId")] = None,
    rule_type: Annotated[str | None, Query(alias="ruleType")] = None,
    status: str | None = None,
) -> Data[list[CommissionRow]]:
    """GET /api/admin/partner-commissions: what's due, newest first."""
    query = select(PartnerCommission).where(
        or_(PartnerCommission.rule_type != PartnerCommissionRuleType.monthly_deployment, PartnerCommission.period <= current_period(utc_now_ms()))
    )
    if partner_id:
        query = query.where(PartnerCommission.partner_id == partner_id)
    if types := _enum_filter(rule_type, PartnerCommissionRuleType):
        query = query.where(PartnerCommission.rule_type.in_(types))
    if statuses := _enum_filter(status, CommissionStatus):
        query = query.where(PartnerCommission.status.in_(statuses))
    rows = db.scalars(query.options(selectinload(PartnerCommission.partner), selectinload(PartnerCommission.candidate))
                      .order_by(PartnerCommission.created_at.desc()).limit(LIST_SIZE))
    return Data(data=[CommissionRow.model_validate(r) for r in rows])


@router.get("/admin-fees")
def list_admin_fees(
    _user: Lister,
    db: DbSession,
    partner_id: Annotated[str | None, Query(alias="partnerId")] = None,
    fee_type: Annotated[str | None, Query(alias="feeType")] = None,
    status: str | None = None,
) -> Data[list[FeeRow]]:
    """GET /api/admin/admin-fees: Vertex's own fees that are due, newest first."""
    query = select(AdminFee).where(
        or_(AdminFee.fee_type != AdminFeeType.deployment_monthly, AdminFee.period <= current_period(utc_now_ms()))
    )
    if partner_id:
        query = query.where(AdminFee.partner_id == partner_id)
    if types := _enum_filter(fee_type, AdminFeeType):
        query = query.where(AdminFee.fee_type.in_(types))
    if statuses := _enum_filter(status, CommissionStatus):
        query = query.where(AdminFee.status.in_(statuses))
    rows = db.scalars(query.options(selectinload(AdminFee.partner), selectinload(AdminFee.candidate))
                      .order_by(AdminFee.created_at.desc()).limit(LIST_SIZE))
    return Data(data=[FeeRow.model_validate(r) for r in rows])


# --- approving and paying ------------------------------------------------------------


def _for_update(db: Session, commission_id: str) -> PartnerCommission:
    commission = db.scalar(
        select(PartnerCommission).where(PartnerCommission.id == commission_id).with_for_update().execution_options(populate_existing=True)
    )
    if commission is None:
        raise ApiError(404, "not_found", "Commission not found.")
    return commission


def _due_or_refuse(commission: PartnerCommission, doing: str) -> None:
    if not commission_due(commission.rule_type, commission.period, utc_now_ms()):
        raise ApiError(422, "not_due", f"This is the {commission.period} instalment; it can be {doing} once that month starts.")


def _for_partner(commission: PartnerCommission) -> dict:
    return {
        "email": commission.partner.contact_email, "partner_name": commission.partner.name,
        "candidate_name": commission.candidate.full_name or "the candidate", "amount": float(commission.amount), "currency": commission.currency,
    }


@router.post("/partner-commissions/{commission_id}/approve", response_model=Notifying[CommissionRow])
def approve_commission(commission_id: str, user: Payer, db: AuditedDb):
    """POST /api/admin/partner-commissions/[id]/approve: pending -> approved."""
    commission = _for_update(db, commission_id)
    _due_or_refuse(commission, "approved")
    if commission.status is not CommissionStatus.pending:
        raise ApiError(422, "not_pending", f"Already {commission.status.value} — nothing to approve.")
    commission.status = CommissionStatus.approved
    commission.approved_by = user.user_id
    commission.approved_at = utc_now_ms()
    db.commit()
    db.refresh(commission)
    return {"data": commission, "notify": deliver(db, [PartnerCommissionApprovedEmail(**_for_partner(commission))])}


class PaidIn(BaseModel):
    """The receipt is optional: the row itself is the record of the event."""

    payment_reference: Annotated[str, StringConstraints(strip_whitespace=True, max_length=200)] | None = None
    payment_method: Annotated[str, StringConstraints(strip_whitespace=True, max_length=100)] | None = None


@router.post("/partner-commissions/{commission_id}/mark-paid", response_model=Notifying[CommissionRow])
def mark_commission_paid(commission_id: str, user: Payer, db: AuditedDb, body: PaidIn | None = None):
    """POST /api/admin/partner-commissions/[id]/mark-paid: approved -> paid."""
    body = body or PaidIn()
    commission = _for_update(db, commission_id)
    _due_or_refuse(commission, "paid")
    if commission.status is not CommissionStatus.approved:
        raise ApiError(422, "not_approved", f"Must be approved before it can be marked paid (currently {commission.status.value}).")
    commission.status = CommissionStatus.paid
    commission.paid_by = user.user_id
    commission.paid_at = utc_now_ms()
    commission.payment_reference = body.payment_reference
    commission.payment_method = body.payment_method
    db.commit()
    db.refresh(commission)
    return {"data": commission, "notify": deliver(db, [PartnerCommissionPaidEmail(**_for_partner(commission))])}


# --- the rules grid ---------------------------------------------------------------


class RuleRow(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    rule_type: PartnerCommissionRuleType
    amount: float
    currency: str
    updated_by: str | None
    updated_at: UtcDateTime


class RuleIn(BaseModel):
    """upsertPartnerCommissionRuleSchema: one of the two rules, set."""

    rule_type: PartnerCommissionRuleType
    amount: Decimal = Field(ge=0, max_digits=12, decimal_places=2)
    currency: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=10)] = "USD"


@router.get("/partner-commission-rules")
def list_rules(_user: Payer, db: DbSession) -> Data[list[RuleRow]]:
    """GET /api/admin/partner-commission-rules: the two global rules."""
    return Data(data=[RuleRow.model_validate(r) for r in db.scalars(select(PartnerCommissionRule).order_by(PartnerCommissionRule.rule_type))])


@router.post("/partner-commission-rules", response_model=Data[RuleRow])
def set_rule(body: RuleIn, user: Payer, db: AuditedDb):
    """POST /api/admin/partner-commission-rules: a rule set or changed. It
    applies to what's earned from now on; recorded rows keep their amount."""
    rule = db.scalar(select(PartnerCommissionRule).where(PartnerCommissionRule.rule_type == body.rule_type).with_for_update())
    if rule is None:
        rule = PartnerCommissionRule(rule_type=body.rule_type)
        db.add(rule)
    rule.amount = body.amount
    rule.currency = body.currency
    rule.updated_by = user.user_id
    db.commit()
    db.refresh(rule)
    return {"data": rule}
