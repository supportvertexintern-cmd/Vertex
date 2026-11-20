"""Management's view of the partners (Phase 6, upstream staging): one
partner's commission statement, and the performance of every partner and
every team member. The partner managers' (in-house supervisor, director,
admin): commission money isn't a VA's to see.

Both are worked out on each read from the ledgers. Only what's earned so
far counts towards totals and rankings (upstream's QA-41 and QA-46): the
six monthly rows a deployment schedules sit in the ledger from day one,
but a month counts once it has arrived, and a rejected row never does.
The statement shows the months still ahead separately, as scheduled.

"Registered" is the candidates a partner actually brought in (bridged),
the same figure as the partner page and the tracking panel (DEF-005); the
flags are partner_flags over flag_inputs, exactly as the VA dashboard's
(DEF-006).

Opening a statement is recorded (statement_viewed): who looked at which
partner's money.
"""

from __future__ import annotations

from collections import defaultdict
from decimal import Decimal
from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel, ConfigDict
from sqlalchemy import distinct, func, select

from app.api.deps import DbSession
from app.api.v1.partner_tracking import Manager, Person
from app.api.v1.va import flag_inputs
from app.core.api import ApiError, Data, UtcDateTime
from app.core.audit import append_event
from app.core.clock import utc_now_ms
from app.models.candidate import Candidate
from app.models.enums import CommissionStatus, MouStatus, PartnerCommissionRuleType, PartnerStatus, SlaStatus
from app.models.identity import User
from app.models.partner_tracking import AdminFee, PartnerCommission
from app.models.partners import Partner
from app.services.partner_flags import admin_fee_due, current_period, earned_commission_clause, partner_flags

router = APIRouter()

HISTORY_SIZE = 50
ZERO = Decimal(0)


def _money(value: Decimal | None) -> float:
    return float(value or ZERO)


# --- one partner's commission statement --------------------------------------------


class StatementPartner(BaseModel):
    id: str
    name: str
    status: PartnerStatus
    mou_status: MouStatus
    sla_status: SlaStatus
    contact_email: str
    assigned_team_member_id: str | None
    assigned_team_member: Person | None


class StatementSummary(BaseModel):
    registered_candidates: int
    registration_commissions: float
    deployed_candidates: int
    monthly_deployment_commissions: float
    scheduled_commissions: float  # months still ahead: not earned yet
    months_earned: int
    months_scheduled: int
    total_earned: float
    outstanding: float  # pending and approved
    pending: float
    approved: float
    paid: float


class CandidateName(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    full_name: str | None


class LedgerRow(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    candidate_id: str
    candidate: CandidateName | None
    rule_type: PartnerCommissionRuleType
    period: str
    amount: float
    currency: str
    status: CommissionStatus
    approved_at: UtcDateTime | None
    paid_at: UtcDateTime | None
    payment_reference: str | None
    created_at: UtcDateTime


class Statement(BaseModel):
    partner: StatementPartner
    summary: StatementSummary
    history: list[LedgerRow]


@router.get("/partners/{partner_id}/commission-statement")
def commission_statement(partner_id: str, user: Manager, db: DbSession) -> Data[Statement]:
    """GET /api/management/partners/[id]/commission-statement: registered
    and deployed candidates, registration and monthly earnings, outstanding,
    pending and paid balances, the months still ahead, and the recent
    ledger. Summed in the database (upstream's PERF-003: a large partner has
    tens of thousands of rows)."""
    partner = db.get(Partner, partner_id)
    if partner is None:
        raise ApiError(404, "not_found", "Partner not found.")
    now = utc_now_ms()
    mine = PartnerCommission.partner_id == partner_id
    monthly = PartnerCommission.rule_type == PartnerCommissionRuleType.monthly_deployment

    by_status: dict[CommissionStatus, Decimal] = defaultdict(lambda: ZERO)
    registration = monthly_total = ZERO
    months_earned = 0
    for status, rule_type, amount, count in db.execute(
        select(PartnerCommission.status, PartnerCommission.rule_type, func.sum(PartnerCommission.amount), func.count())
        .where(mine, earned_commission_clause(now))
        .group_by(PartnerCommission.status, PartnerCommission.rule_type)
    ):
        by_status[status] += amount or ZERO
        if rule_type is PartnerCommissionRuleType.registration:
            registration += amount or ZERO
        else:
            monthly_total += amount or ZERO
            months_earned += count
    scheduled_sum, scheduled_count = db.execute(
        select(func.sum(PartnerCommission.amount), func.count())
        .where(mine, monthly, PartnerCommission.status != CommissionStatus.rejected, PartnerCommission.period > current_period(now))
    ).one()
    history = list(db.scalars(select(PartnerCommission).where(mine).order_by(PartnerCommission.created_at.desc()).limit(HISTORY_SIZE)))
    member = db.get(User, partner.assigned_team_member_id) if partner.assigned_team_member_id else None

    append_event("statement_viewed", actor_id=user.user_id, entity_type="Partner", entity_id=partner_id, detail={})
    return Data(
        data=Statement(
            partner=StatementPartner(
                id=partner.id, name=partner.name, status=partner.status, mou_status=partner.mou_status, sla_status=partner.sla_status,
                contact_email=partner.contact_email, assigned_team_member_id=partner.assigned_team_member_id,
                assigned_team_member=Person(id=member.id, full_name=member.full_name) if member else None,
            ),
            summary=StatementSummary(
                registered_candidates=db.scalar(select(func.count()).select_from(Candidate).where(Candidate.partner_id == partner_id)) or 0,
                registration_commissions=_money(registration),
                deployed_candidates=db.scalar(select(func.count(distinct(PartnerCommission.candidate_id))).where(mine, monthly)) or 0,
                monthly_deployment_commissions=_money(monthly_total),
                scheduled_commissions=_money(scheduled_sum),
                months_earned=months_earned,
                months_scheduled=scheduled_count or 0,
                total_earned=_money(registration + monthly_total),
                outstanding=_money(by_status[CommissionStatus.pending] + by_status[CommissionStatus.approved]),
                pending=_money(by_status[CommissionStatus.pending]),
                approved=_money(by_status[CommissionStatus.approved]),
                paid=_money(by_status[CommissionStatus.paid]),
            ),
            history=[LedgerRow.model_validate(r) for r in history],
        )
    )


# --- every partner's performance --------------------------------------------------------


class Onboarding(BaseModel):
    documents_submitted: bool
    mou_signed: bool
    sla_signed: bool


class PerformanceRow(BaseModel):
    partner_id: str
    partner_name: str
    status: PartnerStatus
    assigned_to: str | None
    onboarding: Onboarding
    registered: int  # bridged candidates (DEF-005)
    initiated: int  # every submission, drafts included
    deployed_candidates: int
    reports: int
    follow_ups_open: int
    flags: list[str]
    commissions_earned: float
    commissions_paid: float
    commissions_outstanding: float


class TeamRow(BaseModel):
    team_member: str
    partners_assigned: int
    flagged: int
    outstanding: float


class Compliance(BaseModel):
    onboarding_complete: int
    agreements_signed: int
    reports_received: int
    applications_started: int


class Totals(BaseModel):
    total_partners: int
    commissions_payable: float  # pending
    commissions_approved: float
    commissions_paid: float
    commissions_outstanding: float
    admin_fee_revenue: float
    admin_fee_collected: float
    open_follow_ups: int  # partners with one


class Performance(BaseModel):
    compliance: Compliance
    ranked: list[PerformanceRow]
    teamPerformance: list[TeamRow]  # noqa: N815  (the website's key)
    totals: Totals


Owed = Literal["pending", "approved", "paid"]


@router.get("/partner-performance")
def partner_performance(_manager: Manager, db: DbSession) -> Data[Performance]:
    """GET /api/management/partner-performance: onboarding, agreements,
    reporting and application progress, partners ranked by what they've
    earned, each team member's partners, flags and outstanding balance, and
    the commission and admin-fee totals. Earned periods only."""
    partners = list(db.scalars(select(Partner).order_by(Partner.name, Partner.id)))
    ids = [p.id for p in partners]
    now = utc_now_ms()
    inputs = flag_inputs(db, partners)

    def grouped(query) -> dict[str, int]:
        return dict(db.execute(query).all()) if ids else {}

    registered = grouped(select(Candidate.partner_id, func.count()).where(Candidate.partner_id.in_(ids)).group_by(Candidate.partner_id))
    deployed = grouped(
        select(PartnerCommission.partner_id, func.count(distinct(PartnerCommission.candidate_id)))
        .where(PartnerCommission.partner_id.in_(ids), PartnerCommission.rule_type == PartnerCommissionRuleType.monthly_deployment)
        .group_by(PartnerCommission.partner_id)
    )
    earned: dict[str, dict[CommissionStatus, Decimal]] = defaultdict(lambda: defaultdict(lambda: ZERO))
    if ids:
        for partner_id, status, amount in db.execute(
            select(PartnerCommission.partner_id, PartnerCommission.status, func.sum(PartnerCommission.amount))
            .where(PartnerCommission.partner_id.in_(ids), earned_commission_clause(now))
            .group_by(PartnerCommission.partner_id, PartnerCommission.status)
        ):
            earned[partner_id][status] += amount or ZERO
    fee_revenue = fee_collected = ZERO
    if ids:
        for fee_type, period, status, amount in db.execute(
            select(AdminFee.fee_type, AdminFee.period, AdminFee.status, AdminFee.amount).where(AdminFee.partner_id.in_(ids))
        ):
            if admin_fee_due(fee_type, period, now):
                fee_revenue += amount
                if status is CommissionStatus.paid:
                    fee_collected += amount
    names = dict(db.execute(select(User.id, User.full_name).where(User.id.in_({p.assigned_team_member_id for p in partners if p.assigned_team_member_id}))).all())

    rows: list[PerformanceRow] = []
    for p in partners:
        money = earned[p.id]
        flags = partner_flags(inputs[p.id], now).flags
        rows.append(PerformanceRow(
            partner_id=p.id, partner_name=p.name, status=p.status, assigned_to=names.get(p.assigned_team_member_id or ""),
            onboarding=Onboarding(documents_submitted=p.documents_submitted_at is not None, mou_signed=p.mou_status is MouStatus.signed,
                                  sla_signed=p.sla_status is SlaStatus.signed),
            registered=registered.get(p.id, 0), initiated=inputs[p.id].submissions, deployed_candidates=deployed.get(p.id, 0),
            reports=len(inputs[p.id].report_statuses), follow_ups_open=inputs[p.id].open_follow_ups, flags=flags,
            commissions_earned=_money(sum(money.values(), ZERO)), commissions_paid=_money(money[CommissionStatus.paid]),
            commissions_outstanding=_money(money[CommissionStatus.pending] + money[CommissionStatus.approved]),
        ))
    ranked = sorted(rows, key=lambda r: (-r.commissions_earned, -r.registered, r.partner_name))

    team: dict[str, TeamRow] = {}
    for r in rows:
        key = r.assigned_to or "Unassigned"
        entry = team.setdefault(key, TeamRow(team_member=key, partners_assigned=0, flagged=0, outstanding=0))
        entry.partners_assigned += 1
        entry.flagged += bool(r.flags)
        entry.outstanding += r.commissions_outstanding

    def total(*statuses: CommissionStatus) -> float:
        return _money(sum((earned[pid][s] for pid in ids for s in statuses), ZERO))

    return Data(data=Performance(
        compliance=Compliance(
            onboarding_complete=sum(1 for r in rows if r.onboarding.documents_submitted and r.onboarding.mou_signed and r.onboarding.sla_signed),
            agreements_signed=sum(1 for r in rows if r.onboarding.mou_signed),
            reports_received=sum(1 for r in rows if r.reports),
            applications_started=sum(1 for r in rows if r.initiated),
        ),
        ranked=ranked,
        teamPerformance=sorted(team.values(), key=lambda t: (-t.outstanding, t.team_member)),
        totals=Totals(
            total_partners=len(partners),
            commissions_payable=total(CommissionStatus.pending),
            commissions_approved=total(CommissionStatus.approved),
            commissions_paid=total(CommissionStatus.paid),
            commissions_outstanding=total(CommissionStatus.pending, CommissionStatus.approved),
            admin_fee_revenue=_money(fee_revenue),
            admin_fee_collected=_money(fee_collected),
            open_follow_ups=sum(1 for r in rows if r.follow_ups_open),
        ),
    ))
