"""Who sees which reports, and what a consolidated report would contain
(reads handover R3): the website's server/services/reportWorkflow.ts
(getReportScopeFilter) and reportConsolidation.ts, moved here. The
writes are in app/api/v1/reports.py.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import ColumnElement, and_, false, or_, select, true
from sqlalchemy.orm import Session

from app.core.auth import AuthUser
from app.core.scope import inhouse_country_ids
from app.models.enums import ReportCycle, ReportStatus, Role, ScopeLevel
from app.models.identity import Country, User
from app.models.reporting import Report


def report_scope(db: Session, user: AuthUser) -> ColumnElement[bool]:
    """getReportScopeFilter, for the list and the detail alike: a recruiter
    sees their own; a country supervisor their own and their country's
    recruiter reports; an in-house supervisor their countries' reports and
    their own portfolio reports; a director only in-house reports (the
    content below that tier is in-house's, 2026-07-25); an admin all."""
    match user.role:
        case Role.regional_recruiter:
            return Report.submitted_by == user.user_id
        case Role.country_supervisor:
            country = db.scalar(select(User.assigned_country_id).where(User.id == user.user_id))
            if not country:
                return false()
            return or_(Report.submitted_by == user.user_id, and_(Report.scope_level == ScopeLevel.recruiter, Report.country_id == country))
        case Role.inhouse_supervisor:
            countries = inhouse_country_ids(db, user.user_id)
            if not countries:
                return Report.submitted_by == user.user_id
            return or_(Report.country_id.in_(countries), Report.submitted_by == user.user_id)
        case Role.director:
            return Report.scope_level == ScopeLevel.inhouse
        case _:
            return true()


# --- consolidation previews ------------------------------------------------------


def _merge_kpis(reports: list[Report]) -> list[dict[str, Any]]:
    """Sums target and actual per KPI label, in first-seen order."""
    by_label: dict[str, dict[str, Any]] = {}
    for r in reports:
        for kpi in (r.content or {}).get("kpis") or []:
            row = by_label.setdefault(kpi["label"], {"label": kpi["label"], "target": 0, "actual": 0})
            row["target"] += kpi.get("target") or 0
            row["actual"] += kpi.get("actual") or 0
    return list(by_label.values())


def _tagged(reports: list[Report], key: str) -> list[dict[str, Any]]:
    """A section's rows across reports, each detail prefixed with whose
    report it came from."""
    out = []
    for r in reports:
        name = r.submitter.full_name
        for row in (r.content or {}).get(key) or []:
            detail = row.get("detail")
            out.append({**row, "detail": f"[{name}] {detail}" if detail else f"[{name}]"})
    return out


def _content(verified: list[Report]) -> dict[str, Any]:
    return {
        "executive_summary": " ".join(s for r in verified if (s := (r.content or {}).get("executive_summary"))),
        "kpis": _merge_kpis(verified),
        "issues": _tagged(verified, "issues"),
        "achievements": _tagged(verified, "achievements"),
        "priorities": _tagged(verified, "priorities"),
    }


def _period(cycle: ReportCycle, start: datetime, end: datetime) -> list[ColumnElement[bool]]:
    return [Report.type == cycle, Report.period_start == start, Report.period_end == end]


def country_preview(db: Session, country_id: str, cycle: ReportCycle, start: datetime, end: datetime) -> dict[str, Any]:
    """A country supervisor's report for the period, from the verified
    recruiter reports in their country, without writing anything: every
    recruiter in the country with their report's status, which reports
    would be consolidated, and whether a country report already exists."""
    siblings = list(db.scalars(
        select(Report).where(Report.scope_level == ScopeLevel.recruiter, Report.country_id == country_id, *_period(cycle, start, end)).order_by(Report.created_at)
    ))
    roster = db.scalars(select(User).where(User.role == Role.regional_recruiter, User.assigned_country_id == country_id).order_by(User.full_name))
    verified = [r for r in siblings if r.status is ReportStatus.verified]
    existing = db.scalars(select(Report.id).where(Report.scope_level == ScopeLevel.country, Report.country_id == country_id, *_period(cycle, start, end))).first()
    by_submitter = {r.submitted_by: r for r in siblings}
    return {
        "roster": [
            {"id": u.id, "full_name": u.full_name, "reportId": by_submitter[u.id].id if u.id in by_submitter else None,
             "status": by_submitter[u.id].status.value if u.id in by_submitter else None}
            for u in roster
        ],
        "verifiedReportIds": [r.id for r in verified],
        "alreadyConsolidated": existing is not None,
        "content": _content(verified),
    }


def inhouse_preview(db: Session, supervisor_id: str, country_ids: list[str], cycle: ReportCycle, start: datetime, end: datetime) -> dict[str, Any]:
    """An in-house supervisor's portfolio report for the period: one roster
    row per assigned country (its supervisor and their report's status),
    from the verified country reports. "Already consolidated" means this
    supervisor already has one: a portfolio report has no country."""
    country_reports = list(db.scalars(
        select(Report).where(Report.scope_level == ScopeLevel.country, Report.country_id.in_(country_ids), *_period(cycle, start, end)).order_by(Report.created_at)
    ))
    countries = db.scalars(select(Country).where(Country.id.in_(country_ids)).order_by(Country.name))
    supervisors = {u.assigned_country_id: u for u in db.scalars(select(User).where(User.role == Role.country_supervisor, User.assigned_country_id.in_(country_ids)))}
    existing = db.scalars(select(Report.id).where(Report.scope_level == ScopeLevel.inhouse, Report.submitted_by == supervisor_id, *_period(cycle, start, end))).first()
    verified = [r for r in country_reports if r.status is ReportStatus.verified]
    by_country = {r.country_id: r for r in country_reports}
    roster = []
    for c in countries:
        report, supervisor = by_country.get(c.id), supervisors.get(c.id)
        roster.append({
            "countryId": c.id, "countryName": c.name,
            "supervisor": {"id": supervisor.id, "full_name": supervisor.full_name} if supervisor else None,
            "reportId": report.id if report else None, "status": report.status.value if report else None,
        })
    return {"roster": roster, "verifiedReportIds": [r.id for r in verified], "alreadyConsolidated": existing is not None, "content": _content(verified)}
