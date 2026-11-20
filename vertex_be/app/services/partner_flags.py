"""What makes a partner "need attention" (Phase 6): one rule set behind the
VA dashboard and Management's team roll-up, so the two never disagree
(DEF-006, 2026-11-10). A change to what counts as a flag belongs here.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta

from sqlalchemy import ColumnElement, or_

from app.models.enums import AdminFeeType, CommissionStatus, MouStatus, PartnerCommissionRuleType, PartnerStatus, SlaStatus
from app.models.partner_tracking import PartnerCommission

RECENT_ACTIVITY_DAYS = 14


@dataclass(frozen=True)
class FlagInput:
    status: PartnerStatus
    mou_status: MouStatus
    sla_status: SlaStatus
    documents_submitted_at: datetime | None
    # A new partner has no candidates yet but isn't "inactive" (DEF-015):
    # its activity starts when it was added.
    created_at: datetime
    # Every submission, drafts included: the "initiated" figure.
    submissions: int
    # When each submission was last touched.
    activity: list[datetime] = field(default_factory=list)
    report_statuses: list[str] = field(default_factory=list)
    open_follow_ups: int = 0


@dataclass(frozen=True)
class Flags:
    flags: list[str]
    no_recent_activity: bool


def partner_flags(p: FlagInput, now: datetime) -> Flags:
    flags: list[str] = []
    # A suspended partner isn't trading on purpose: its agreements aren't a to-do.
    trading = p.status is not PartnerStatus.suspended
    if trading and p.mou_status is not MouStatus.signed:
        flags.append("MOU not signed")
    if trading and p.sla_status is not SlaStatus.signed:
        flags.append("SLA not signed")
    if p.documents_submitted_at is None:
        flags.append("Onboarding documents pending")
    if not p.report_statuses:
        flags.append("No report recorded")
    elif any(s in ("pending", "returned") for s in p.report_statuses):
        flags.append("Report outstanding")
    # One situation, one alert (QA FUNC-US26): never both wordings.
    if p.submissions == 0:
        flags.append("Signed but no applications yet" if p.mou_status is MouStatus.signed else "No candidates submitted")
    if p.open_follow_ups > 0:
        flags.append("Open follow-up")
    last = max(p.activity, default=p.created_at)
    quiet = last < now - timedelta(days=RECENT_ACTIVITY_DAYS)
    if quiet:
        flags.append(f"No activity in {RECENT_ACTIVITY_DAYS} days")
    return Flags(flags, quiet)


def current_period(now: datetime) -> str:
    return f"{now.year}-{now.month:02d}"


def commission_due(rule_type: PartnerCommissionRuleType, period: str, now: datetime) -> bool:
    """Only months that have arrived are payable (QA-41): a new deployment
    schedules six monthly rows, and the five future ones aren't due yet."""
    return rule_type is not PartnerCommissionRuleType.monthly_deployment or period <= current_period(now)


def admin_fee_due(fee_type: AdminFeeType, period: str, now: datetime) -> bool:
    """Vertex's own fees follow the schedule they accompany: the application
    fee once, each monthly deployment fee when its month arrives."""
    return fee_type is not AdminFeeType.deployment_monthly or period <= current_period(now)


def earned_commission_clause(now: datetime) -> ColumnElement[bool]:
    """commission_due in SQL, for sums the database does: earned so far is
    not rejected (QA-46) and not a month still ahead (QA-41)."""
    return (PartnerCommission.status != CommissionStatus.rejected) & or_(
        PartnerCommission.rule_type != PartnerCommissionRuleType.monthly_deployment,
        PartnerCommission.period <= current_period(now),
    )
