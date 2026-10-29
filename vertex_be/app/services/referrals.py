"""Referral commissions earned at pipeline milestones: a port of
generateReferralCommissionIfDue (vertex/src/lib/referralMilestones.ts) for
the pipeline handover (docs/architecture/pipeline-handover.md, step 6.1).

Only pipeline events earn a commission, so ReferralCommission moves with
the pipeline. A referred candidate earns one commission per milestone; the
amount comes from the ReferralCommissionRule for their country and that
milestone. A milestone with no rule, or a zero amount, is recorded as paid
£0, so it still counts on the agent's dashboard.

The website sends the "commission earned" email (owner's decision D1, 2026-
10-29), so a commission worth paying is returned for the caller to pass on.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.candidate import Candidate
from app.models.enums import CandidateLifecycleStatus, CaseStage, ReferralCommissionStatus, ReferralMilestone
from app.models.referral import ReferralAgent, ReferralCommission, ReferralCommissionRule

# The pre-case lifecycle transitions that are milestones: HR's first
# approval (screening passed) and second (a case is created).
LIFECYCLE_MILESTONES: dict[CandidateLifecycleStatus, ReferralMilestone] = {
    CandidateLifecycleStatus.screened: ReferralMilestone.qualified,
    CandidateLifecycleStatus.approved: ReferralMilestone.application_submitted,
}
# The case stages that are milestones (the same stage keys as the
# candidate's payment milestones).
STAGE_MILESTONES: dict[CaseStage, ReferralMilestone] = {
    CaseStage.permit_authorization_approved: ReferralMilestone.work_permit_approved,
    CaseStage.visa_interview_decision: ReferralMilestone.visa_approved,
    CaseStage.departure_arrival_support: ReferralMilestone.deployed,
}

UNIQUE_VIOLATION = "23505"


@dataclass(frozen=True)
class CommissionEarned:
    """For the website's "commission earned" email."""

    agent_email: str
    agent_name: str
    candidate_name: str
    milestone: ReferralMilestone
    amount: float
    currency: str


def commission_if_due(db: Session, candidate_id: str, milestone: ReferralMilestone, case_id: str | None = None) -> CommissionEarned | None:
    """Records the commission a referred candidate's milestone earns, once.
    Runs in the caller's transaction and session (so its audit actor);
    returns what the email needs when the amount is above zero."""
    candidate = db.get(Candidate, candidate_id)
    if candidate is None or not candidate.referral_agent_id:
        return None  # not a referred candidate
    already = select(ReferralCommission.id).where(ReferralCommission.candidate_id == candidate_id, ReferralCommission.milestone == milestone)
    if db.scalars(already).first() is not None:
        return None

    rule = None
    if candidate.country_id:
        rule = db.scalars(
            select(ReferralCommissionRule).where(ReferralCommissionRule.country_id == candidate.country_id, ReferralCommissionRule.milestone == milestone)
        ).first()
    amount = rule.amount if rule else 0
    currency = rule.currency if rule else "USD"

    commission = ReferralCommission(
        referral_agent_id=candidate.referral_agent_id,
        candidate_id=candidate_id,
        case_id=case_id,
        milestone=milestone,
        commission_rule_id=rule.id if rule else None,
        amount=amount,
        currency=currency,
        status=ReferralCommissionStatus.pending if amount > 0 else ReferralCommissionStatus.paid,
        paid_at=None if amount > 0 else datetime.now(UTC).replace(tzinfo=None),
    )
    savepoint = db.begin_nested()
    db.add(commission)
    try:
        savepoint.commit()
    except IntegrityError as err:
        savepoint.rollback()
        if getattr(err.orig, "pgcode", None) == UNIQUE_VIOLATION:
            return None  # recorded by a concurrent request
        raise

    if amount <= 0:
        return None
    agent = db.get(ReferralAgent, candidate.referral_agent_id)
    assert agent is not None
    return CommissionEarned(agent.email, agent.full_name, candidate.full_name or "your referral", milestone, amount, currency)


def flag_if_duplicate(db: Session, candidate: Candidate) -> bool:
    """checkReferralDuplicate: a referred candidate who matches another by
    email, phone or passport number is flagged for HR to look at, never
    blocked. Runs in the caller's session, uncommitted."""
    matches = [
        column == value
        for column, value in (
            (Candidate.email, candidate.email),
            (Candidate.phone, candidate.phone),
            (Candidate.passport_number, candidate.passport_number),
        )
        if value
    ]
    if not matches:
        return False
    other = db.scalar(select(Candidate.id).where(Candidate.id != candidate.id, or_(*matches)).limit(1))
    if other is None:
        return False
    candidate.referral_duplicate_flag = True
    return True
