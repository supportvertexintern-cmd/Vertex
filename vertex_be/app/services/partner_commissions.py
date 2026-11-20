"""The partner commission and admin-fee engine (Phase 6, upstream staging's
partnerCommissions.ts; requirements doc §3 and §6).

A partner earns, for each candidate it brought in:
  - a registration commission when HR approves the submission and opens the
    case (USD 10 by default);
  - a monthly deployment commission for each of the six calendar months from
    the month the candidate deploys, the case reaching Departure & Arrival
    Support (USD 40 by default).
The amounts are PartnerCommissionRule's (the rules grid), the doc's
defaults when a rule is missing.

Vertex records its own administrative fees in a separate ledger, at the same
two events: an application fee (USD 10, none on a fully financed programme)
and six monthly deployment fees (USD 40). They're Vertex's receivable, not
a payout, so no email goes with them.

A deployment earns its six months once: a case that leaves the last stage
and reaches it again later schedules nothing new (shifting the months would
make a seventh row, which the database refuses).

Every row is recorded once: the ledgers' unique keys (partner, candidate,
type, period; for fees, candidate, type, period) make a repeat or a
simultaneous request a no-op, here as a savepoint that's rolled back. The
one-off rows use the period "registration" and "application"; the monthly
ones "YYYY-MM". A zero amount is settled as paid when it's earned, so the
event still shows on the dashboards. Runs in the caller's transaction and
session, so its audit actor.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal
from typing import Literal

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.clock import utc_now_ms
from app.models.candidate import Application, Candidate
from app.models.enums import AdminFeeType, CommissionStatus, PartnerCommissionRuleType
from app.models.jobs import Job
from app.models.partner_tracking import AdminFee, PartnerCommission, PartnerCommissionRule

log = logging.getLogger(__name__)

PARTNER_REGISTRATION_COMMISSION_DEFAULT = Decimal("10")
PARTNER_MONTHLY_DEPLOYMENT_COMMISSION_DEFAULT = Decimal("40")
ADMIN_APPLICATION_FEE = Decimal("10")
ADMIN_MONTHLY_DEPLOYMENT_FEE = Decimal("40")
# The six months a deployment earns; the database refuses a seventh (0025).
DEPLOYMENT_COMMISSION_MONTHS = 6
REGISTRATION_PERIOD = "registration"
APPLICATION_PERIOD = "application"
UNIQUE_VIOLATION = "23505"
# The tolerance a plan's percents get when they're added up (fees.py's).
FULL_PLAN_TOLERANCE = 0.02


@dataclass(frozen=True)
class PartnerCommissionEarned:
    """What the partner's "commission earned" email needs."""

    email: str
    partner_name: str
    candidate_name: str
    commission_type: Literal["registration", "deployment"]
    amount: Decimal
    currency: str


def month_key(d: datetime) -> str:
    return f"{d.year}-{d.month:02d}"


def monthly_periods(deployed_at: datetime, months: int = DEPLOYMENT_COMMISSION_MONTHS) -> list[str]:
    """The calendar months from the deployment month on, as "YYYY-MM"."""
    start = deployed_at.year * 12 + deployed_at.month - 1
    return [f"{(start + i) // 12}-{(start + i) % 12 + 1:02d}" for i in range(months)]


def is_fully_financed(job: Job) -> bool:
    """A credit-service programme whose plan is the whole fee (Georgia's
    0/0/100, say). A partly financed one still has the application fee."""
    if not job.is_credit_service:
        return False
    return abs(100 - sum(s.percent for s in job.payment_stages)) < FULL_PLAN_TOLERANCE


def _rule(db: Session, rule_type: PartnerCommissionRuleType, default: Decimal) -> tuple[Decimal, str]:
    rule = db.scalar(select(PartnerCommissionRule).where(PartnerCommissionRule.rule_type == rule_type))
    return (rule.amount, rule.currency) if rule is not None else (default, "USD")


def _record(db: Session, row: PartnerCommission | AdminFee) -> bool:
    """Adds the row unless its key is taken; True if it was recorded."""
    savepoint = db.begin_nested()
    db.add(row)
    try:
        savepoint.commit()
    except IntegrityError as err:
        savepoint.rollback()
        if getattr(err.orig, "pgcode", None) == UNIQUE_VIOLATION:
            return False  # recorded already, perhaps by a simultaneous request
        raise
    return True


def _settled(amount: Decimal) -> dict:
    return {"status": CommissionStatus.pending, "paid_at": None} if amount > 0 else {"status": CommissionStatus.paid, "paid_at": utc_now_ms()}


def _deployed_already(db: Session, model: type[PartnerCommission] | type[AdminFee], *where) -> bool:
    """A deployment's monthly rows are on the ledger already."""
    return db.scalar(select(model.id).where(*where).limit(1)) is not None


def _partner_candidate(db: Session, candidate_id: str) -> Candidate | None:
    candidate = db.get(Candidate, candidate_id)
    return candidate if candidate is not None and candidate.partner_id and candidate.partner is not None else None


def partner_commissions_if_due(
    db: Session, candidate_id: str, event: Literal["registered", "deployed"], *, case_id: str | None = None, deployed_at: datetime | None = None,
) -> PartnerCommissionEarned | None:
    """The partner's commission rows for the event; the email's values when
    something payable was recorded. Nothing for a candidate no partner
    brought in."""
    candidate = _partner_candidate(db, candidate_id)
    if candidate is None:
        return None
    if event == "registered":
        amount, currency = _rule(db, PartnerCommissionRuleType.registration, PARTNER_REGISTRATION_COMMISSION_DEFAULT)
        recorded = _record(db, PartnerCommission(
            partner_id=candidate.partner_id, candidate_id=candidate_id, case_id=None, rule_type=PartnerCommissionRuleType.registration,
            period=REGISTRATION_PERIOD, amount=amount, currency=currency, **_settled(amount),
        ))
        commission_type: Literal["registration", "deployment"] = "registration"
    else:
        if _deployed_already(db, PartnerCommission, PartnerCommission.candidate_id == candidate_id, PartnerCommission.partner_id == candidate.partner_id,
                             PartnerCommission.rule_type == PartnerCommissionRuleType.monthly_deployment):
            return None
        amount, currency = _rule(db, PartnerCommissionRuleType.monthly_deployment, PARTNER_MONTHLY_DEPLOYMENT_COMMISSION_DEFAULT)
        recorded = False
        for period in monthly_periods(deployed_at or utc_now_ms()):
            recorded |= _record(db, PartnerCommission(
                partner_id=candidate.partner_id, candidate_id=candidate_id, case_id=case_id, rule_type=PartnerCommissionRuleType.monthly_deployment,
                period=period, amount=amount, currency=currency, **_settled(amount),
            ))
        commission_type = "deployment"
    if not recorded or amount <= 0:
        return None
    return PartnerCommissionEarned(candidate.partner.contact_email, candidate.partner.name, candidate.full_name or "the candidate", commission_type, amount, currency)


def admin_fees_if_due(
    db: Session, candidate_id: str, event: Literal["application", "deployed"], *, job_id: str | None = None,
    case_id: str | None = None, deployed_at: datetime | None = None,
) -> int:
    """Vertex's own fee rows for the event; how many were recorded."""
    candidate = _partner_candidate(db, candidate_id)
    if candidate is None:
        return 0
    if event == "application":
        if job_id is None:
            job_id = db.scalar(select(Application.job_id).where(Application.candidate_id == candidate_id).order_by(Application.submitted_at.desc()).limit(1))
        job = db.get(Job, job_id) if job_id else None
        if job is not None and is_fully_financed(job):
            return 0  # §6: no application fee on a fully financed programme
        rows = [(AdminFeeType.application, APPLICATION_PERIOD, None, ADMIN_APPLICATION_FEE)]
    else:
        if _deployed_already(db, AdminFee, AdminFee.candidate_id == candidate_id, AdminFee.fee_type == AdminFeeType.deployment_monthly):
            return 0
        rows = [(AdminFeeType.deployment_monthly, period, case_id, ADMIN_MONTHLY_DEPLOYMENT_FEE) for period in monthly_periods(deployed_at or utc_now_ms())]
    return sum(
        _record(db, AdminFee(partner_id=candidate.partner_id, candidate_id=candidate_id, case_id=for_case, fee_type=fee_type,
                             period=period, amount=amount, currency="USD", **_settled(amount)))
        for fee_type, period, for_case, amount in rows
    )
