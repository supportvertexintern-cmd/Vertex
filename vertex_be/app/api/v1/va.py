"""The virtual assistants' portal (Phase 6, 2026-11-02): the partners a VA
looks after, and its dashboard.

A virtual assistant sees only the partners assigned to it
(Partner.assigned_team_member_id); director and admin see them all, and so
does an in-house supervisor on the working list (the partner managers). The
dashboard is worked out on every read: onboarding, reporting, applications,
the "needs attention" flags (app/services/partner_flags.py) and the
commissions due.
"""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import DbSession
from app.core.api import Data
from app.core.auth import AuthUser
from app.core.clock import utc_now_ms
from app.core.rbac import require_role
from app.models.enums import CommissionStatus, MouStatus, PartnerFollowUpStatus, Role
from app.models.identity import User
from app.models.partner_tracking import PartnerCommission, PartnerFollowUp, PartnerReport
from app.models.partners import Partner, PartnerCandidate
from app.services.partner_flags import FlagInput, commission_due, partner_flags

router = APIRouter()

# The website's routes must match (tests check it).
VA_LIST_ROLES = (Role.virtual_assistant, Role.inhouse_supervisor, Role.director, Role.admin)
VA_OVERVIEW_ROLES = (Role.virtual_assistant, Role.director, Role.admin)


def scoped(user: AuthUser):
    """The partners this user may see: a VA its own, everyone else all."""
    query = select(Partner).order_by(Partner.name, Partner.id)
    if user.role is Role.virtual_assistant:
        query = query.where(Partner.assigned_team_member_id == user.user_id)
    return query


class TeamMember(BaseModel):
    id: str
    full_name: str


class VaPartnerRow(BaseModel):
    id: str
    name: str
    status: str
    mou_status: str
    sla_status: str
    assigned_team_member: TeamMember | None
    submissions: int


def _members(db: Session, ids: set[str]) -> dict[str, TeamMember]:
    if not ids:
        return {}
    return {u.id: TeamMember(id=u.id, full_name=u.full_name) for u in db.scalars(select(User).where(User.id.in_(ids)))}


def _counts(db: Session, model, ids: list[str], *where) -> dict[str, int]:
    if not ids:
        return {}
    rows = db.execute(select(model.partner_id, func.count()).where(model.partner_id.in_(ids), *where).group_by(model.partner_id))
    return dict(rows.all())


@router.get("/va/partners", response_model=Data[list[VaPartnerRow]])
def va_partners(db: DbSession, user: Annotated[AuthUser, Depends(require_role(*VA_LIST_ROLES))]):
    """GET /api/va/partners: the working list, by name."""
    partners = db.scalars(scoped(user)).all()
    ids = [p.id for p in partners]
    submissions = _counts(db, PartnerCandidate, ids)
    members = _members(db, {p.assigned_team_member_id for p in partners if p.assigned_team_member_id})
    return {"data": [
        VaPartnerRow(
            id=p.id, name=p.name, status=p.status.value, mou_status=p.mou_status.value, sla_status=p.sla_status.value,
            assigned_team_member=members.get(p.assigned_team_member_id or ""), submissions=submissions.get(p.id, 0),
        ) for p in partners
    ]}


class OverviewSummary(BaseModel):
    total_partners: int
    agreements_signed: int
    agreements_unsigned: int
    reports_submitted: int
    reports_outstanding: int
    applications_started: int
    applications_not_started: int
    total_candidates: int
    no_recent_activity: int
    commissions_due: float
    partners_flagged: int


class FlaggedPartner(BaseModel):
    partner_id: str
    partner_name: str
    assigned_to: str | None
    flags: list[str]
    commissions_due: float


class RecentPartner(BaseModel):
    id: str
    name: str
    status: str
    assigned_to: str | None
    candidates: int


class VaOverview(BaseModel):
    summary: OverviewSummary
    flags: list[FlaggedPartner]
    recent_partners: list[RecentPartner]


@router.get("/va/overview", response_model=Data[VaOverview])
def va_overview(db: DbSession, user: Annotated[AuthUser, Depends(require_role(*VA_OVERVIEW_ROLES))]):
    """GET /api/va/overview: the dashboard, worked out on this read."""
    partners = db.scalars(scoped(user)).all()
    ids = [p.id for p in partners]
    now = utc_now_ms()
    members = _members(db, {p.assigned_team_member_id for p in partners if p.assigned_team_member_id})
    activity: dict[str, list[datetime]] = {}
    submissions: dict[str, int] = {}
    if ids:
        for partner_id, submitted_at, updated_at in db.execute(
            select(PartnerCandidate.partner_id, PartnerCandidate.submitted_at, PartnerCandidate.updated_at).where(PartnerCandidate.partner_id.in_(ids))
        ):
            submissions[partner_id] = submissions.get(partner_id, 0) + 1
            activity.setdefault(partner_id, []).append(updated_at or submitted_at)
    reports: dict[str, list[str]] = {}
    if ids:
        for partner_id, status in db.execute(select(PartnerReport.partner_id, PartnerReport.status).where(PartnerReport.partner_id.in_(ids))):
            reports.setdefault(partner_id, []).append(status.value)
    open_follow_ups = _counts(db, PartnerFollowUp, ids, PartnerFollowUp.status == PartnerFollowUpStatus.open)
    due: dict[str, Decimal] = {}
    if ids:
        for c in db.scalars(select(PartnerCommission).where(PartnerCommission.partner_id.in_(ids), PartnerCommission.status == CommissionStatus.approved)):
            if commission_due(c.rule_type, c.period, now):
                due[c.partner_id] = due.get(c.partner_id, Decimal(0)) + c.amount

    flagged: list[FlaggedPartner] = []
    quiet = 0
    for p in partners:
        result = partner_flags(FlagInput(
            status=p.status, mou_status=p.mou_status, sla_status=p.sla_status, documents_submitted_at=p.documents_submitted_at,
            created_at=p.created_at, submissions=submissions.get(p.id, 0), activity=activity.get(p.id, []),
            report_statuses=reports.get(p.id, []), open_follow_ups=open_follow_ups.get(p.id, 0),
        ), now)
        quiet += result.no_recent_activity
        if result.flags:
            member = members.get(p.assigned_team_member_id or "")
            flagged.append(FlaggedPartner(
                partner_id=p.id, partner_name=p.name, assigned_to=member.full_name if member else None, flags=result.flags,
                commissions_due=float(due.get(p.id, Decimal(0))),
            ))
    signed = sum(p.mou_status is MouStatus.signed for p in partners)
    with_reports = sum(1 for p in partners if reports.get(p.id))
    started = sum(1 for p in partners if submissions.get(p.id))
    total = len(partners)
    return {"data": VaOverview(
        summary=OverviewSummary(
            total_partners=total, agreements_signed=signed, agreements_unsigned=total - signed, reports_submitted=with_reports,
            reports_outstanding=total - with_reports, applications_started=started, applications_not_started=total - started,
            total_candidates=sum(submissions.values()), no_recent_activity=quiet, commissions_due=float(sum(due.values(), Decimal(0))),
            partners_flagged=len(flagged),
        ),
        flags=flagged,
        recent_partners=[
            RecentPartner(
                id=p.id, name=p.name, status=p.status.value, candidates=submissions.get(p.id, 0),
                assigned_to=(members[p.assigned_team_member_id].full_name if p.assigned_team_member_id in members else None),
            ) for p in partners[:8]
        ],
    )}
