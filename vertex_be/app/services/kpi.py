"""The recruitment KPIs, moved from the website's server/services/kpi.ts in
reads handover R3, formula for formula (SRS FR-3.2 and the 2026-07-13
redefinitions noted below). Read-only.

A candidate's lifecycle stages are strictly sequential, so "reached this
stage or later" is an index comparison over the current-stage counts, not
a historical query. Percentages are rounded to one decimal, half up, as
JavaScript's Math.round did.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field, replace
from datetime import datetime
from typing import Any

from sqlalchemy import ColumnElement, func, select
from sqlalchemy.orm import Session

from app.models.campaign import Campaign, CampaignTarget, RecruiterTarget
from app.models.candidate import Application, Candidate
from app.models.cases import Case
from app.models.enums import CampaignMetric, CampaignStatus, CandidateLifecycleStatus, ReportCycle, ReportStatus, Role, ScopeLevel
from app.models.identity import Country, User
from app.models.partners import Partner
from app.models.referral import ReferralAgentTarget
from app.models.reporting import Report, StaffKpiTarget

LIFECYCLE_ORDER: list[CandidateLifecycleStatus] = [
    CandidateLifecycleStatus.identified,
    CandidateLifecycleStatus.screened,
    CandidateLifecycleStatus.guided_to_apply,
    CandidateLifecycleStatus.submitted,
    CandidateLifecycleStatus.reported,
    CandidateLifecycleStatus.verified,
    CandidateLifecycleStatus.approved,
]


@dataclass(frozen=True)
class KpiFilters:
    """The scope of a KPI: the period, and optionally countries (several
    for an in-house supervisor), a region and a recruiter."""

    period_start: datetime
    period_end: datetime
    country_ids: tuple[str, ...] | None = None
    region_id: str | None = None
    recruiter_id: str | None = None


def percent(part: int, whole: int) -> float:
    """Math.round(part / whole * 1000) / 10; 0 when there is no whole."""
    return 0 if whole == 0 else math.floor(part / whole * 1000 + 0.5) / 10


def _candidate_where(f: KpiFilters) -> list[ColumnElement[bool]]:
    where = [Candidate.created_at >= f.period_start, Candidate.created_at <= f.period_end]
    if f.recruiter_id:
        where.append(Candidate.recruiter_id == f.recruiter_id)
    if f.country_ids is not None:
        where.append(Candidate.country_id.in_(f.country_ids))
    if f.region_id:
        where.append(Candidate.country_id.in_(select(Country.id).where(Country.region_id == f.region_id)))
    return where


def agent_signups(db: Session, f: KpiFilters) -> int:
    """New candidates in the period, at the filters' scope."""
    return db.scalar(select(func.count()).select_from(Candidate).where(*_candidate_where(f))) or 0


def recruiter_response_rate(db: Session, f: KpiFilters) -> float:
    """The share of the period's candidates who got past "identified"."""
    where = _candidate_where(f)
    total = agent_signups(db, f)
    responded = db.scalar(
        select(func.count()).select_from(Candidate).where(*where, Candidate.lifecycle_status != CandidateLifecycleStatus.identified)
    ) or 0
    return percent(responded, total)


def applicant_flow(db: Session, f: KpiFilters) -> dict[str, int]:
    """Candidates by current lifecycle stage, every stage listed."""
    flow = {s.value: 0 for s in LIFECYCLE_ORDER}
    rows = db.execute(select(Candidate.lifecycle_status, func.count()).where(*_candidate_where(f)).group_by(Candidate.lifecycle_status))
    for status, n in rows:
        flow[status.value] = n
    return flow


def _reached_or_later(flow: dict[str, int], idx: int) -> int:
    return sum(flow[s.value] for s in LIFECYCLE_ORDER[idx:])


def verified_from_flow(flow: dict[str, int]) -> int:
    """"Verified candidates" (redefined 2026-07-13): verified or later."""
    return _reached_or_later(flow, LIFECYCLE_ORDER.index(CandidateLifecycleStatus.verified))


def conversion_from_flow(flow: dict[str, int]) -> float:
    """"Conversion rate" (redefined 2026-07-13): of those verified, the share approved."""
    return percent(flow[CandidateLifecycleStatus.approved.value], verified_from_flow(flow))


def conversion_rates(db: Session, f: KpiFilters) -> dict[str, Any]:
    """The overall rate, and stage by stage for the funnel."""
    flow = applicant_flow(db, f)
    by_stage = [
        {"from": LIFECYCLE_ORDER[i].value, "to": LIFECYCLE_ORDER[i + 1].value,
         "rate": percent(_reached_or_later(flow, i + 1), _reached_or_later(flow, i))}
        for i in range(len(LIFECYCLE_ORDER) - 1)
    ]
    return {"overall": conversion_from_flow(flow), "byStage": by_stage}


def kpi_summary(db: Session, f: KpiFilters) -> dict[str, Any]:
    return {
        "agentSignups": agent_signups(db, f),
        "recruiterResponseRate": recruiter_response_rate(db, f),
        "applicantFlow": applicant_flow(db, f),
        "conversion": conversion_rates(db, f),
    }


@dataclass
class FlowCache:
    """One applicant-flow query per scope within a call: several targets
    often share one."""

    db: Session
    flows: dict[KpiFilters, dict[str, int]] = field(default_factory=dict)

    def __call__(self, f: KpiFilters) -> dict[str, int]:
        if f not in self.flows:
            self.flows[f] = applicant_flow(self.db, f)
        return self.flows[f]


def _actual(metric: CampaignMetric, flow: dict[str, int]) -> float:
    return conversion_from_flow(flow) if metric is CampaignMetric.conversion_rate else verified_from_flow(flow)


def partner_performance(db: Session, f: KpiFilters) -> list[dict[str, Any]]:
    """Per partner with candidates in the period: how many it sourced, and
    how many reached "approved"."""
    in_period = (Candidate.created_at >= f.period_start, Candidate.created_at <= f.period_end)
    rows = db.execute(
        select(Partner.id, Partner.name, Candidate.lifecycle_status)
        .join(Candidate, Candidate.partner_id == Partner.id)
        .where(*in_period)
        .order_by(Partner.name, Partner.id)
    )
    out: dict[str, dict[str, Any]] = {}
    for pid, name, status in rows:
        p = out.setdefault(pid, {"partnerId": pid, "partnerName": name, "candidatesSourced": 0, "approved": 0})
        p["candidatesSourced"] += 1
        p["approved"] += status is CandidateLifecycleStatus.approved
    return list(out.values())


def referral_agent_targets_vs_actuals(db: Session, agent_id: str) -> list[dict[str, Any]]:
    """Each of an agent's targets, newest period first, against the
    candidates they referred within it."""
    targets = db.scalars(
        select(ReferralAgentTarget).where(ReferralAgentTarget.referral_agent_id == agent_id).order_by(ReferralAgentTarget.period_start.desc())
    )
    return [
        {
            "targetId": t.id,
            "periodStart": t.period_start,
            "periodEnd": t.period_end,
            "targetReferrals": t.target_referrals,
            "actualReferrals": db.scalar(
                select(func.count()).select_from(Candidate).where(
                    Candidate.referral_agent_id == agent_id, Candidate.created_at >= t.period_start, Candidate.created_at <= t.period_end
                )
            ) or 0,
        }
        for t in targets
    ]


def targets_vs_actuals(db: Session, campaign_id: str, f: KpiFilters) -> list[dict[str, Any]]:
    """Every target on a campaign against its metric at the target's own
    country or region, over the period."""
    flows = FlowCache(db)
    out = []
    for t in db.scalars(select(CampaignTarget).where(CampaignTarget.campaign_id == campaign_id).order_by(CampaignTarget.created_at)):
        scoped = replace(f, country_ids=(t.country_id,) if t.country_id else None, region_id=t.region_id)
        out.append({
            "campaignTargetId": t.id, "metric": t.metric.value, "countryId": t.country_id, "regionId": t.region_id,
            "targetValue": t.target_value, "actualValue": _actual(t.metric, flows(scoped)),
        })
    return out


def _active_targets_in(country_ids: list[str]) -> Any:
    return (
        select(CampaignTarget)
        .join(Campaign, Campaign.id == CampaignTarget.campaign_id)
        .where(CampaignTarget.country_id.in_(country_ids), Campaign.status == CampaignStatus.active)
    )


def country_targets_vs_actuals(db: Session, country_id: str, f: KpiFilters) -> list[dict[str, Any]]:
    """A country's targets on its active campaigns, against the country."""
    flows = FlowCache(db)
    scoped = replace(f, country_ids=(country_id,))
    return [
        {"campaignTargetId": t.id, "metric": t.metric.value, "campaignName": t.campaign.name,
         "targetValue": t.target_value, "actualValue": _actual(t.metric, flows(scoped))}
        for t in db.scalars(_active_targets_in([country_id]).order_by(CampaignTarget.created_at))
    ]


def recruiter_targets_vs_actuals(db: Session, recruiter_id: str, f: KpiFilters) -> list[dict[str, Any]]:
    """A recruiter's allocations against their own candidates in the
    period (a report's window, not the campaign's)."""
    flows = FlowCache(db)
    scoped = replace(f, recruiter_id=recruiter_id)
    out = []
    for rt in db.scalars(select(RecruiterTarget).where(RecruiterTarget.recruiter_id == recruiter_id).order_by(RecruiterTarget.created_at)):
        metric = rt.campaign_target.metric
        out.append({
            "recruiterTargetId": rt.id, "metric": metric.value, "campaignName": rt.campaign_target.campaign.name,
            "targetValue": rt.target_value, "actualValue": _actual(metric, flows(scoped)),
        })
    return out


REPORT_SCOPE_BY_ROLE = {Role.regional_recruiter: ScopeLevel.recruiter, Role.country_supervisor: ScopeLevel.country, Role.inhouse_supervisor: ScopeLevel.inhouse}


def staff_kpi_targets_vs_actuals(db: Session, staff_id: str, cycle: ReportCycle) -> list[dict[str, Any]]:
    """A staff member's KPI targets for a cycle, against the actual they
    put for the same label in their latest non-draft report of that cycle
    (null until there is one)."""
    role = db.scalar(select(User.role).where(User.id == staff_id))
    scope = REPORT_SCOPE_BY_ROLE.get(role) if role else None
    latest = None
    if scope:
        latest = db.scalars(
            select(Report.content)
            .where(Report.submitted_by == staff_id, Report.type == cycle, Report.scope_level == scope, Report.status != ReportStatus.draft)
            .order_by(Report.period_end.desc(), Report.created_at.desc())
            .limit(1)
        ).first()
    actuals: dict[str, float] = {}
    for row in (latest or {}).get("kpis") or []:
        actual = row.get("actual") if isinstance(row, dict) else None
        if isinstance(row, dict) and row.get("label") and isinstance(actual, int | float) and not isinstance(actual, bool):
            actuals[row["label"]] = actual
    targets = db.scalars(select(StaffKpiTarget).where(StaffKpiTarget.staff_id == staff_id, StaffKpiTarget.cycle == cycle).order_by(StaffKpiTarget.kpi_label))
    return [{"id": t.id, "kpiLabel": t.kpi_label, "targetValue": t.target_value, "actualValue": actuals.get(t.kpi_label)} for t in targets]


def case_stage_breakdown(db: Session, country_ids: tuple[str, ...] | None, region_id: str | None) -> list[dict[str, Any]]:
    """Cases by current stage at a country or region scope (no period: a
    stage is a standing state)."""
    query = (
        select(Case.current_stage, func.count())
        .join(Application, Application.id == Case.application_id)
        .join(Candidate, Candidate.id == Application.candidate_id)
        .group_by(Case.current_stage)
    )
    if country_ids is not None:
        query = query.where(Candidate.country_id.in_(country_ids))
    if region_id:
        query = query.where(Candidate.country_id.in_(select(Country.id).where(Country.region_id == region_id)))
    return [{"stage": stage.value, "count": n} for stage, n in db.execute(query)]
