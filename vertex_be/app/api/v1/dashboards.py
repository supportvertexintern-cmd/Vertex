"""Recruitment-operations dashboards and report reads (reads handover R3).
They answer as the website's routes read them through Prisma, which now
ask here instead: /api/kpi, /api/recruiter-targets/progress,
/api/admin/referral-agents/[id]/targets (GET), /api/supervisor/*,
/api/inhouse/*, /api/management/report-metrics, /api/reports (GET),
/api/reports/[id] (GET), /api/reports/consolidation-preview and
/api/staff-kpi-targets (GET). The same roles, scopes, defaults, messages
and JSON keys; the KPIs are app/services/kpi.py.

Differences, all deliberate: a date that doesn't parse, or an unknown
cadence or cycle, is a 422 instead of the 500 it caused; "today" and
"this month" are UTC days and months, as the website's server computed
them; rows the website listed in no particular order are listed oldest
first.
"""

from __future__ import annotations

import math
from datetime import UTC, datetime, timedelta
from typing import Annotated, Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict
from sqlalchemy import exists, func, or_, select

from app.api.deps import DbSession
from app.api.v1.targets import can_manage
from app.core.api import ApiError, Data, Page, UtcDateTime, js_date
from app.core.auth import AuthUser
from app.core.clock import utc_now_ms
from app.core.rbac import REFERRAL_AGENT_MANAGER_ROLES, STAFF_ROLES, require_role
from app.core.scope import inhouse_country_ids
from app.models.campaign import Campaign, CampaignTarget, RecruiterTarget
from app.models.candidate import Candidate
from app.models.enums import CampaignStatus, CandidateLifecycleStatus, ReportCycle, ReportStatus, Role, ScopeLevel
from app.models.identity import Country, InhouseCountryAssignment, User
from app.models.reporting import Report
from app.services import kpi
from app.services.report_reads import country_preview, inhouse_preview, report_scope

router = APIRouter()

EPOCH = datetime(1970, 1, 1)


def _roles(*roles: Role) -> Any:
    return Annotated[AuthUser, Depends(require_role(*roles))]


KpiViewer = _roles(Role.inhouse_supervisor, Role.director, Role.admin)
Recruiter = _roles(Role.regional_recruiter)
CountrySupervisor = _roles(Role.country_supervisor, Role.admin)
InhouseSupervisor = _roles(Role.inhouse_supervisor, Role.admin)
Management = _roles(Role.director, Role.admin)
ReferralManager = _roles(*REFERRAL_AGENT_MANAGER_ROLES)
Staff = _roles(*STAFF_ROLES)
ReportReader = _roles(Role.regional_recruiter, Role.country_supervisor, Role.inhouse_supervisor, Role.director, Role.admin)
Consolidator = _roles(Role.country_supervisor, Role.inhouse_supervisor, Role.admin)


# --- helpers -------------------------------------------------------------------


def iso(value: datetime | None) -> str | None:
    """A date as Prisma's JSON has it ("…T00:00:00.000Z"): the pages read
    it with new Date(), which would take one without the Z as local time."""
    return None if value is None else value.isoformat(timespec="milliseconds") + "Z"


def _invalid(message: str) -> ApiError:
    return ApiError(422, "validation_error", message)


def _date(value: str | None, default: datetime | None = None) -> datetime | None:
    if not value:
        return default
    try:
        return js_date(value)
    except ValueError:
        raise _invalid("Invalid date.") from None


def _required_period(start: str | None, end: str | None) -> tuple[datetime, datetime]:
    if not start or not end:
        raise _invalid("period_start and period_end are required.")
    return _date(start), _date(end)  # type: ignore[return-value]


def _int(value: str | None, default: int) -> int:
    try:
        return int(value) if value else default
    except ValueError:
        return default


def _ref(row: Any) -> dict[str, str] | None:
    return {"id": row.id, "name": row.name} if row is not None else None


def _assigned_country(db: DbSession, user_id: str) -> str | None:
    return db.scalar(select(User.assigned_country_id).where(User.id == user_id))


def _last_report_at(db: DbSession, user_id: str) -> str | None:
    return iso(db.scalar(select(func.max(Report.period_end)).where(Report.submitted_by == user_id)))


def _campaign_brief(t: CampaignTarget) -> dict[str, Any]:
    c = t.campaign
    return {"id": t.id, "metric": t.metric.value, "target_value": t.target_value,
            "campaign": {"id": c.id, "name": c.name, "start_date": iso(c.start_date), "end_date": iso(c.end_date)}}


def _allocation(rt: RecruiterTarget) -> dict[str, Any]:
    return {"id": rt.id, "campaign_target_id": rt.campaign_target_id, "recruiter_id": rt.recruiter_id, "target_value": rt.target_value}


def _active_targets(country_ids: list[str]) -> Any:
    return (
        select(CampaignTarget).join(Campaign, Campaign.id == CampaignTarget.campaign_id)
        .where(CampaignTarget.country_id.in_(country_ids), Campaign.status == CampaignStatus.active)
        .order_by(CampaignTarget.created_at.desc())
    )


def _performance(db: DbSession, f: kpi.KpiFilters) -> tuple[int, float]:
    return kpi.agent_signups(db, f), kpi.conversion_rates(db, f)["overall"]


# --- management KPIs ---------------------------------------------------------------


@router.get("/kpi")
def kpi_dashboard(
    db: DbSession, user: KpiViewer,
    period_start: str | None = None, period_end: str | None = None, country_id: str | None = None,
    region_id: str | None = None, recruiter_id: str | None = None, campaign_id: str | None = None,
) -> Data[dict[str, Any]]:
    """The management dashboard: the KPI summary, a campaign's targets
    against actuals (if one is asked for), partner performance and cases by
    stage, over the period (the last 90 days by default). An in-house
    supervisor is held to their own countries whatever the query says."""
    end = _date(period_end, utc_now_ms())
    start = _date(period_start, end - timedelta(days=90))
    countries: tuple[str, ...] | None = (country_id,) if country_id else None
    if user.role is Role.inhouse_supervisor:
        countries, region_id = tuple(inhouse_country_ids(db, user.user_id)), None
    f = kpi.KpiFilters(period_start=start, period_end=end, country_ids=countries, region_id=region_id, recruiter_id=recruiter_id)
    return Data(data={
        "summary": kpi.kpi_summary(db, f),
        "targetsVsActuals": kpi.targets_vs_actuals(db, campaign_id, f) if campaign_id else None,
        "partnerPerformance": kpi.partner_performance(db, f),
        "caseStageBreakdown": kpi.case_stage_breakdown(db, countries, region_id),
    })


@router.get("/management/report-metrics")
def report_metrics(
    db: DbSession, _user: Management,
    cadence: ReportCycle = ReportCycle.weekly, country_id: str | None = None, q: str | None = None,
    page: str | None = None, pageSize: str | None = None,  # noqa: N803
) -> Page[dict[str, Any]]:
    """Recruiters' and country supervisors' reporting as counts only (never
    the content, which stays in-house's): submitted, verified, returned,
    and the latest period, for one cadence."""
    page_n = max(1, _int(page, 1))
    size = min(100, max(1, _int(pageSize, 15)))
    where = [User.role.in_([Role.regional_recruiter, Role.country_supervisor])]
    if country_id:
        where.append(User.assigned_country_id == country_id)
    if q:
        where.append(User.full_name.icontains(q, autoescape=True))
    total = db.scalar(select(func.count()).select_from(User).where(*where)) or 0
    staff = db.scalars(select(User).where(*where).order_by(User.full_name, User.id).offset((page_n - 1) * size).limit(size))
    rows = []
    for s in staff:
        reports = list(db.execute(select(Report.status, Report.period_end).where(Report.submitted_by == s.id, Report.type == cadence)))
        rows.append({
            "id": s.id, "full_name": s.full_name, "role": s.role.value, "country": _ref(s.assigned_country),
            "submittedCount": len(reports),
            "verifiedCount": sum(1 for st, _ in reports if st in (ReportStatus.verified, ReportStatus.approved, ReportStatus.consolidated)),
            "returnedCount": sum(1 for st, _ in reports if st is ReportStatus.returned),
            "lastReportAt": iso(max((e for _, e in reports), default=None)),
        })
    return Page(data=rows, total=total, page=page_n, pageSize=size)


# --- a recruiter's own, a referral agent's -------------------------------------------


@router.get("/recruiter-targets/progress")
def recruiter_progress(db: DbSession, user: Recruiter, period_start: str | None = None, period_end: str | None = None) -> Data[list[dict[str, Any]]]:
    """The calling recruiter's allocations against their candidates in the
    given window (a report's period)."""
    start, end = _required_period(period_start, period_end)
    return Data(data=kpi.recruiter_targets_vs_actuals(db, user.user_id, kpi.KpiFilters(start, end)))


@router.get("/referral-agents/{agent_id}/targets")
def referral_agent_targets(agent_id: str, db: DbSession, _user: ReferralManager) -> Data[list[dict[str, Any]]]:
    rows = kpi.referral_agent_targets_vs_actuals(db, agent_id)
    return Data(data=[r | {"periodStart": iso(r["periodStart"]), "periodEnd": iso(r["periodEnd"])} for r in rows])


# --- a country supervisor's ------------------------------------------------------------


@router.get("/supervisor/overview")
def supervisor_overview(db: DbSession, user: CountrySupervisor, period_start: str | None = None, period_end: str | None = None) -> Data[dict[str, Any]]:
    """The supervisor's country: their recruiters, its candidates, those
    awaiting verification, recruiter reports awaiting review, and its
    targets against actuals over the period."""
    start, end = _required_period(period_start, period_end)
    country_id = _assigned_country(db, user.user_id)
    if not country_id:
        return Data(data={"countryName": None, "recruiterCount": 0, "candidateCount": 0, "pendingVerificationCount": 0,
                          "reportsAwaitingReviewCount": 0, "targetProgress": []})
    count = lambda model, *where: db.scalar(select(func.count()).select_from(model).where(*where)) or 0  # noqa: E731
    country = db.get(Country, country_id)
    return Data(data={
        "countryName": country.name if country else None,
        "recruiterCount": count(User, User.role == Role.regional_recruiter, User.supervisor_id == user.user_id),
        "candidateCount": count(Candidate, Candidate.country_id == country_id),
        "pendingVerificationCount": count(Candidate, Candidate.country_id == country_id, Candidate.lifecycle_status == CandidateLifecycleStatus.reported),
        "reportsAwaitingReviewCount": count(Report, Report.scope_level == ScopeLevel.recruiter, Report.country_id == country_id, Report.status == ReportStatus.submitted),
        "targetProgress": kpi.country_targets_vs_actuals(db, country_id, kpi.KpiFilters(start, end)),
    })


@router.get("/supervisor/recruiters")
def supervisor_recruiters(db: DbSession, user: CountrySupervisor, period_start: str | None = None, period_end: str | None = None) -> Data[list[dict[str, Any]]]:
    """The caller's recruiters, by name, with candidates and conversion
    over the period (all time by default) and their latest report period."""
    f = kpi.KpiFilters(_date(period_start, EPOCH), _date(period_end, utc_now_ms()))  # type: ignore[arg-type]
    out = []
    for r in db.scalars(select(User).where(User.role == Role.regional_recruiter, User.supervisor_id == user.user_id).order_by(User.full_name)):
        total, rate = _performance(db, kpi.KpiFilters(f.period_start, f.period_end, recruiter_id=r.id))
        out.append({"id": r.id, "full_name": r.full_name, "email": r.email, "candidatesTotal": total, "conversionRate": rate,
                    "lastReportAt": _last_report_at(db, r.id)})
    return Data(data=out)


@router.get("/supervisor/recruiters/{recruiter_id}")
def supervisor_recruiter(
    recruiter_id: str, db: DbSession, user: CountrySupervisor, period_start: str | None = None, period_end: str | None = None
) -> Data[dict[str, Any]]:
    """One of the caller's recruiters: performance over the period (this
    month by default), targets against actuals, their country's active
    campaign targets and their own allocations."""
    recruiter = db.get(User, recruiter_id)
    if recruiter is None or recruiter.role is not Role.regional_recruiter:
        raise ApiError(404, "not_found", "Recruiter not found.")
    if user.role is not Role.admin and recruiter.supervisor_id != user.user_id:
        raise ApiError(403, "forbidden", "This recruiter is not under your supervision.")
    now = utc_now_ms()
    f = kpi.KpiFilters(_date(period_start, now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)), _date(period_end, now), recruiter_id=recruiter_id)  # type: ignore[arg-type]
    total, rate = _performance(db, f)
    country = recruiter.assigned_country_id
    return Data(data={
        "recruiter": {"id": recruiter.id, "full_name": recruiter.full_name, "email": recruiter.email},
        "candidatesTotal": total,
        "conversionRate": rate,
        "targetProgress": kpi.recruiter_targets_vs_actuals(db, recruiter_id, f),
        "campaignTargets": [_campaign_brief(t) for t in db.scalars(_active_targets([country]))] if country else [],
        "allocations": [_allocation(rt) for rt in db.scalars(select(RecruiterTarget).where(RecruiterTarget.recruiter_id == recruiter_id).order_by(RecruiterTarget.created_at))],
    })


@router.get("/supervisor/team-targets")
def supervisor_team_targets(db: DbSession, user: CountrySupervisor) -> Data[dict[str, Any]]:
    """The caller's country's active campaign targets, their recruiters and
    the allocations already set."""
    country = _assigned_country(db, user.user_id)
    if not country:
        return Data(data={"campaignTargets": [], "recruiters": [], "allocations": []})
    recruiters = db.scalars(select(User).where(User.role == Role.regional_recruiter, User.supervisor_id == user.user_id).order_by(User.full_name))
    allocations = db.scalars(
        select(RecruiterTarget).join(User, User.id == RecruiterTarget.recruiter_id).where(User.supervisor_id == user.user_id).order_by(RecruiterTarget.created_at)
    )
    return Data(data={
        "campaignTargets": [_campaign_brief(t) for t in db.scalars(_active_targets([country]))],
        "recruiters": [{"id": r.id, "full_name": r.full_name} for r in recruiters],
        "allocations": [_allocation(rt) for rt in allocations],
    })


# --- an in-house supervisor's ---------------------------------------------------------


@router.get("/inhouse/overview")
def inhouse_overview(db: DbSession, user: InhouseSupervisor) -> Data[dict[str, Any]]:
    """The in-house supervisor's countries: recruiters and who has a daily
    report covering today (UTC), the all-time candidate funnel, country
    reports awaiting review, each active target against its own country,
    and the country supervisors."""
    country_ids = inhouse_country_ids(db, user.user_id)
    if not country_ids:
        raise ApiError(422, "no_country", "You are not yet assigned a country.")
    now = utc_now_ms()
    all_time = kpi.KpiFilters(EPOCH, now, country_ids=tuple(country_ids))
    recruiters = list(db.scalars(select(User).where(User.role == Role.regional_recruiter, User.assigned_country_id.in_(country_ids)).order_by(User.full_name)))
    day_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    reported_today = set(db.scalars(select(Report.submitted_by).where(
        Report.type == ReportCycle.daily, Report.scope_level == ScopeLevel.recruiter, Report.country_id.in_(country_ids),
        Report.period_end >= day_start, Report.period_end <= day_start + timedelta(days=1) - timedelta(milliseconds=1),
    )))
    targets = []
    for t in db.scalars(_active_targets(country_ids)):
        scoped = kpi.KpiFilters(EPOCH, now, country_ids=(t.country_id,) if t.country_id else None)
        flow = kpi.applicant_flow(db, scoped)
        actual = kpi.conversion_from_flow(flow) if t.metric.value == "conversion_rate" else kpi.verified_from_flow(flow)
        targets.append({"id": t.id, "metric": t.metric.value, "targetValue": t.target_value, "actualValue": actual,
                        "campaignName": t.campaign.name, "country": _ref(t.country)})
    supervisors = db.scalars(select(User).where(User.role == Role.country_supervisor, User.assigned_country_id.in_(country_ids)).order_by(User.full_name))
    return Data(data={
        "countries": [_ref(c) for c in db.scalars(select(Country).where(Country.id.in_(country_ids)).order_by(Country.name))],
        "recruiterCount": len(recruiters),
        "dailyCompliance": {
            "submitted": sum(1 for r in recruiters if r.id in reported_today),
            "total": len(recruiters),
            "recruiters": [{"id": r.id, "full_name": r.full_name, "submittedToday": r.id in reported_today} for r in recruiters],
        },
        "candidateFunnel": kpi.applicant_flow(db, all_time),
        "pendingCountryReports": db.scalar(select(func.count()).select_from(Report).where(
            Report.scope_level == ScopeLevel.country, Report.country_id.in_(country_ids), Report.status == ReportStatus.submitted)) or 0,
        "campaignTargets": targets,
        "countrySupervisors": [{"id": s.id, "full_name": s.full_name, "assigned_country": _ref(s.assigned_country)} for s in supervisors],
    })


@router.get("/inhouse/campaigns")
def inhouse_campaigns(db: DbSession, user: InhouseSupervisor) -> Data[dict[str, Any]]:
    """Every campaign, newest first and in any status, with only the
    caller's countries' targets attached."""
    country_ids = inhouse_country_ids(db, user.user_id)
    if not country_ids:
        return Data(data={"countryIds": [], "countries": [], "campaigns": []})
    campaigns = []
    for c in db.scalars(select(Campaign).order_by(Campaign.created_at.desc())):
        targets = db.scalars(select(CampaignTarget).where(CampaignTarget.campaign_id == c.id, CampaignTarget.country_id.in_(country_ids)).order_by(CampaignTarget.created_at))
        campaigns.append({
            "id": c.id, "name": c.name, "status": c.status.value, "start_date": iso(c.start_date), "end_date": iso(c.end_date), "created_by": c.created_by,
            "targets": [{"id": t.id, "metric": t.metric.value, "target_value": t.target_value, "country": _ref(t.country)} for t in targets],
        })
    countries = db.scalars(select(Country).where(Country.id.in_(country_ids)).order_by(Country.name))
    return Data(data={"countryIds": country_ids, "countries": [_ref(c) for c in countries], "userId": user.user_id, "campaigns": campaigns})


@router.get("/inhouse/supervisors")
def inhouse_supervisors(db: DbSession, user: InhouseSupervisor, period_start: str | None = None, period_end: str | None = None) -> Data[list[dict[str, Any]]]:
    """The country supervisors across the caller's countries, by name, with
    their country's candidates and conversion over the period (all time by
    default) and their latest report period."""
    country_ids = inhouse_country_ids(db, user.user_id)
    if not country_ids:
        return Data(data=[])
    start, end = _date(period_start, EPOCH), _date(period_end, utc_now_ms())
    out = []
    for s in db.scalars(select(User).where(User.role == Role.country_supervisor, User.assigned_country_id.in_(country_ids)).order_by(User.full_name)):
        country = s.assigned_country
        total, rate = _performance(db, kpi.KpiFilters(start, end, country_ids=(country.id,) if country else None))  # type: ignore[arg-type]
        out.append({"id": s.id, "full_name": s.full_name, "email": s.email, "country": _ref(country), "candidatesTotal": total,
                    "conversionRate": rate, "lastReportAt": _last_report_at(db, s.id)})
    return Data(data=out)


@router.get("/inhouse/supervisors/{supervisor_id}")
def inhouse_supervisor(supervisor_id: str, db: DbSession, user: InhouseSupervisor) -> Data[dict[str, Any]]:
    """One country supervisor in the caller's countries, with their
    country's all-time candidates and conversion."""
    s = db.get(User, supervisor_id)
    if s is None or s.role is not Role.country_supervisor:
        raise ApiError(404, "not_found", "Country Supervisor not found.")
    country = s.assigned_country
    if user.role is not Role.admin and (country is None or country.id not in inhouse_country_ids(db, user.user_id)):
        raise ApiError(403, "forbidden", "Forbidden.")
    total, rate = _performance(db, kpi.KpiFilters(EPOCH, utc_now_ms(), country_ids=(country.id,) if country else None))
    return Data(data={"supervisor": {"id": s.id, "full_name": s.full_name, "email": s.email}, "country": _ref(country),
                      "candidatesTotal": total, "conversionRate": rate})


# --- reports ------------------------------------------------------------------------


class _Named(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    full_name: str


class _Person(_Named):
    id: str


class _Place(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str


class _Child(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    status: ReportStatus
    submitter: _Named


class ReportRow(BaseModel):
    """The report as the website's report pages select it."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    type: ReportCycle
    scope_level: ScopeLevel
    status: ReportStatus
    period_start: UtcDateTime
    period_end: UtcDateTime
    return_reason: str | None
    content: dict[str, Any]
    submitter: _Person
    country: _Place | None
    parent_report_id: str | None
    child_reports: list[_Child]
    created_at: UtcDateTime


@router.get("/reports/consolidation-preview")
def consolidation_preview(
    db: DbSession, user: Consolidator, type: str | None = None, period_start: str | None = None, period_end: str | None = None
) -> Data[dict[str, Any]]:
    """What the caller's weekly or monthly report for the period would
    consolidate, without writing anything."""
    if type not in ("weekly", "monthly") or not period_start or not period_end:
        raise _invalid("type (weekly or monthly), period_start, and period_end are required.")
    cycle, (start, end) = ReportCycle(type), _required_period(period_start, period_end)
    no_country = ApiError(422, "no_country", "You must be assigned a country first.")
    if user.role is Role.inhouse_supervisor:
        country_ids = inhouse_country_ids(db, user.user_id)
        if not country_ids:
            raise no_country
        return Data(data=inhouse_preview(db, user.user_id, country_ids, cycle, start, end))
    country = _assigned_country(db, user.user_id)
    if not country:
        raise no_country
    return Data(data=country_preview(db, country, cycle, start, end))


@router.get("/reports", response_model=Page[ReportRow])
def list_reports(
    db: DbSession, user: ReportReader,
    country_id: str | None = None, type: ReportCycle | None = None, status: ReportStatus | None = None,
    recruiter_id: str | None = None, scope_level: ScopeLevel | None = None, q: str | None = None,
    page: str | None = None, pageSize: str | None = None,  # noqa: N803
):
    """The reports the caller may see (report_scope), newest first, by
    country (a portfolio report matches by its submitter's countries),
    cycle, status, submitter, level, and submitter or country name."""
    where = [report_scope(db, user)]
    if country_id:
        submitter_covers = exists().where(InhouseCountryAssignment.inhouse_supervisor_id == Report.submitted_by, InhouseCountryAssignment.country_id == country_id)
        where.append(or_(Report.country_id == country_id, submitter_covers))
    if type:
        where.append(Report.type == type)
    if status:
        where.append(Report.status == status)
    if recruiter_id:
        where.append(Report.submitted_by == recruiter_id)
    if scope_level:
        where.append(Report.scope_level == scope_level)
    if q:
        where.append(or_(
            Report.submitted_by.in_(select(User.id).where(User.full_name.icontains(q, autoescape=True))),
            Report.country_id.in_(select(Country.id).where(Country.name.icontains(q, autoescape=True))),
        ))
    page_n = max(1, _int(page, 1))
    size = min(200, max(1, _int(pageSize, 50)))
    total = db.scalar(select(func.count()).select_from(Report).where(*where)) or 0
    rows = db.scalars(select(Report).where(*where).order_by(Report.created_at.desc(), Report.id).offset((page_n - 1) * size).limit(size))
    return Page(data=[ReportRow.model_validate(r) for r in rows], total=total, page=page_n, pageSize=size)


@router.get("/reports/{report_id}", response_model=Data[ReportRow])
def get_report(report_id: str, db: DbSession, user: ReportReader):
    """One report, with the same scope as the list."""
    report = db.scalars(select(Report).where(Report.id == report_id, report_scope(db, user))).first()
    if report is None:
        raise ApiError(404, "not_found", "Report not found.")
    return Data(data=ReportRow.model_validate(report))


# --- staff KPI targets ------------------------------------------------------------------


@router.get("/staff-kpi-targets")
def staff_kpi_targets(db: DbSession, user: Staff, cycle: str | None = None, staff_id: str | None = None) -> Data[list[dict[str, Any]]]:
    """A staff member's KPI targets for a cycle against what they last
    reported (the caller's own by default): for themselves, or for whoever
    may set their targets (targets.py's can_manage)."""
    if not cycle:
        raise _invalid("cycle is required.")
    try:
        report_cycle = ReportCycle(cycle)
    except ValueError:
        raise _invalid("cycle must be daily, weekly or monthly.") from None
    staff = db.get(User, staff_id or user.user_id)
    if staff is None:
        raise ApiError(404, "not_found", "Staff member not found.")
    if staff.id != user.user_id and not can_manage(db, user, staff):
        raise ApiError(403, "forbidden", "Forbidden.")
    return Data(data=kpi.staff_kpi_targets_vs_actuals(db, staff.id, report_cycle))
