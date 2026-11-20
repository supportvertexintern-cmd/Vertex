"""Partner tracking for Phase 6 (upstream staging, 2026-11-05 to 11-10): the
panel a Virtual Assistant or a partner manager opens for one partner, and the
report and follow-up records a VA keeps for it.

A VA reaches only the partners assigned to them (Partner.
assigned_team_member_id, per the business, 2026-11-02), on every read and
every write: opening, recording and editing alike (upstream's DEF-013 was a
VA editing another partner's report). Partner managers (in-house
supervisor, director, admin) reach every partner. A refusal is a 403, which
lands on the audit trail as access_denied.

The panel's activity feed is the audit trail itself (upstream's DEF-004):
changes to the partner and to its submissions, reports, follow-ups,
commissions and admin fees, summarised as sentences.

The VA team list (GET /va-users) is for the managers who assign partners.
"""

from __future__ import annotations

import json
from datetime import datetime
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, status
from pydantic import BaseModel, ConfigDict, Field, StringConstraints
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.api.deps import DbSession
from app.api.v1.va import VA_LIST_ROLES
from app.core.api import ApiError, Data, UtcDateTime
from app.core.audit import AuditedDb
from app.core.auth import AuthUser
from app.core.clock import utc_now_ms
from app.core.rbac import require_role
from app.models.audit import AuditLog
from app.models.candidate import Candidate
from app.models.enums import (
    MouStatus,
    PartnerCandidateStatus,
    PartnerFollowUpStatus,
    PartnerReportStatus,
    PartnerStatus,
    Role,
    SlaStatus,
)
from app.models.identity import User
from app.models.partner_tracking import AdminFee, PartnerCommission, PartnerFollowUp, PartnerReport
from app.models.partners import Partner, PartnerCandidate

router = APIRouter()

TRACKERS: tuple[Role, ...] = VA_LIST_ROLES  # the VA and the partner managers
MANAGERS: tuple[Role, ...] = (Role.inhouse_supervisor, Role.director, Role.admin)
Tracker = Annotated[AuthUser, Depends(require_role(*TRACKERS))]
Manager = Annotated[AuthUser, Depends(require_role(*MANAGERS))]

NOT_YOURS = "This partner is not assigned to you."
FEED_SIZE = 50


def reachable_partner(db: Session, user: AuthUser, partner_id: str) -> Partner:
    """The partner, if this user may track it: a VA only its own."""
    partner = db.get(Partner, partner_id)
    if partner is None:
        raise ApiError(404, "not_found", "Partner not found.")
    if user.role is Role.virtual_assistant and partner.assigned_team_member_id != user.user_id:
        raise ApiError(403, "forbidden", NOT_YOURS)
    return partner


def _active_user(db: Session, user_id: str) -> None:
    member = db.get(User, user_id)
    if member is None or member.deactivated_at is not None:
        raise ApiError(422, "validation_error", "Assigned team member must be an active user.")


# --- reading the panel -------------------------------------------------------


class Person(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    full_name: str


class Name(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    full_name: str


class TrackedPartner(BaseModel):
    id: str
    name: str
    status: PartnerStatus
    mou_status: MouStatus
    mou_signed_at: UtcDateTime | None
    sla_status: SlaStatus
    sla_signed_at: UtcDateTime | None
    documents_submitted_at: UtcDateTime | None
    assigned_team_member_id: str | None
    assigned_team_member: Person | None


class Stats(BaseModel):
    registered: int  # candidates the partner brought in (bridged), as everywhere else
    initiated: int  # every submission, drafts included
    submitted: int
    under_review: int
    approved: int  # HR approved and a case opened
    rejected_or_withdrawn: int
    first_activity_at: UtcDateTime | None
    last_activity_at: UtcDateTime | None


class ReportRow(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    partner_id: str
    status: PartnerReportStatus
    reported_at: UtcDateTime
    period_start: UtcDateTime | None
    period_end: UtcDateTime | None
    content: Any
    submitted_by: str | None
    submitter: Name | None
    created_at: UtcDateTime
    updated_at: UtcDateTime


class FollowUpRow(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    partner_id: str
    action: str
    status: PartnerFollowUpStatus
    due_at: UtcDateTime | None
    completed_at: UtcDateTime | None
    assigned_team_member: str | None
    assignee: Name | None
    created_at: UtcDateTime
    updated_at: UtcDateTime


class ActivityEntry(BaseModel):
    id: str
    at: UtcDateTime
    actor: str | None
    action: str
    entity: str
    summary: str


class Tracking(BaseModel):
    partner: TrackedPartner
    stats: Stats
    reports: list[ReportRow]
    follow_ups: list[FollowUpRow]
    activity: list[ActivityEntry]


ENTITY_LABELS = {
    "Partner": "Partner", "PartnerReport": "Report", "PartnerFollowUp": "Follow-up",
    "PartnerCandidate": "Candidate submission", "PartnerCommission": "Commission", "AdminFee": "Admin fee",
}
FIELD_LABELS = {
    "name": "Company name", "status": "Status", "mou_status": "MOU status", "mou_signed_at": "MOU signed date",
    "sla_status": "SLA status", "sla_signed_at": "SLA signed date", "documents_submitted_at": "Documents submitted",
    "onboarding_documents": "Onboarding documents", "assigned_team_member_id": "Assigned VA", "contact_name": "Contact name",
    "contact_email": "Contact email", "contact_phone": "Contact phone", "country_of_operation": "Country", "notes": "Notes",
    "content": "Report notes", "reported_at": "Report date", "action": "Action", "due_at": "Due date",
    "completed_at": "Completed", "amount": "Amount", "currency": "Currency", "period": "Period",
    "rule_type": "Commission type", "fee_type": "Fee type", "payment_reference": "Payment reference",
    "payment_method": "Payment method",
}
UNSHOWN = {"id", "created_at", "updated_at", "deleted_at", "deleted_links"}
MAX_CHANGES = 4


def _shown(value: Any) -> str:
    if value is None or value == "" or value == []:
        return "none"
    if isinstance(value, bool):
        return "yes" if value else "no"
    if isinstance(value, list):
        return ", ".join(str(v) for v in value)
    if isinstance(value, dict):
        notes = value.get("notes")
        return notes if isinstance(notes, str) else json.dumps(value)[:60]
    text = str(value)
    if len(text) >= 10 and text[4] == "-" and text[7] == "-":
        try:
            return datetime.fromisoformat(text.replace("Z", "+00:00")).strftime("%d/%m/%Y")
        except ValueError:
            return text
    return text


def summarise(entry: AuditLog, actors: dict[str, str]) -> ActivityEntry:
    """One audit row as a sentence: who changed what, and from what to what."""
    label = ENTITY_LABELS.get(entry.entity_type, entry.entity_type)
    if entry.action == "create":
        summary = f"Created {label.lower()}"
    elif entry.action == "delete":
        summary = f"Deleted {label.lower()}"
    else:
        before, after = entry.before or {}, entry.after or {}
        changed = [k for k in after if k not in UNSHOWN and before.get(k) != after.get(k)]
        if not changed:
            summary = f"Updated {label.lower()}"
        else:
            parts = [f"{FIELD_LABELS.get(k, k)}: {_shown(before.get(k))} → {_shown(after.get(k))}" for k in changed[:MAX_CHANGES]]
            more = f" · +{len(changed) - MAX_CHANGES} more" if len(changed) > MAX_CHANGES else ""
            summary = " · ".join(parts) + more
    return ActivityEntry(
        id=entry.id, at=entry.created_at, actor=actors.get(entry.actor_id) if entry.actor_id else None,
        action=entry.action, entity=label, summary=summary,
    )


def _ids(db: Session, model, partner_id: str) -> list[str]:
    return list(db.scalars(select(model.id).where(model.partner_id == partner_id)))


def _activity(db: Session, partner_id: str, reports: list[str], follow_ups: list[str]) -> list[ActivityEntry]:
    """The partner's own history: never another partner's rows."""
    owned = {
        "Partner": [partner_id], "PartnerReport": reports, "PartnerFollowUp": follow_ups,
        "PartnerCandidate": _ids(db, PartnerCandidate, partner_id),
        "PartnerCommission": _ids(db, PartnerCommission, partner_id), "AdminFee": _ids(db, AdminFee, partner_id),
    }
    clauses = [(AuditLog.entity_type == kind) & AuditLog.entity_id.in_(ids) for kind, ids in owned.items() if ids]
    entries = list(db.scalars(select(AuditLog).where(or_(*clauses)).order_by(AuditLog.created_at.desc()).limit(FEED_SIZE)))
    actor_ids = {e.actor_id for e in entries if e.actor_id}
    actors = dict(db.execute(select(User.id, User.full_name).where(User.id.in_(actor_ids))).all()) if actor_ids else {}
    return [summarise(e, actors) for e in entries]


@router.get("/partners/{partner_id}/tracking")
def tracking(partner_id: str, user: Tracker, db: DbSession) -> Data[Tracking]:
    """GET /api/management/partners/[id]/tracking: onboarding (documents,
    MOU, SLA, assigned VA), submissions by stage, first and last activity,
    reports, follow-ups and the activity feed. Computed when read."""
    partner = reachable_partner(db, user, partner_id)
    by_status = dict(
        db.execute(
            select(PartnerCandidate.status, func.count()).where(PartnerCandidate.partner_id == partner_id).group_by(PartnerCandidate.status)
        ).all()
    )
    count = lambda s: by_status.get(s, 0)  # noqa: E731
    first_submitted, first_drafted, last_change = db.execute(
        select(func.min(PartnerCandidate.submitted_at), func.min(PartnerCandidate.drafted_at), func.max(PartnerCandidate.updated_at))
        .where(PartnerCandidate.partner_id == partner_id)
    ).one()
    reports = list(db.scalars(select(PartnerReport).where(PartnerReport.partner_id == partner_id).order_by(PartnerReport.reported_at.desc()).limit(FEED_SIZE)))
    follow_ups = list(db.scalars(select(PartnerFollowUp).where(PartnerFollowUp.partner_id == partner_id).order_by(PartnerFollowUp.created_at.desc()).limit(FEED_SIZE)))
    member = db.get(User, partner.assigned_team_member_id) if partner.assigned_team_member_id else None
    return Data(
        data=Tracking(
            partner=TrackedPartner(
                id=partner.id, name=partner.name, status=partner.status, mou_status=partner.mou_status,
                mou_signed_at=partner.mou_signed_at, sla_status=partner.sla_status, sla_signed_at=partner.sla_signed_at,
                documents_submitted_at=partner.documents_submitted_at, assigned_team_member_id=partner.assigned_team_member_id,
                assigned_team_member=Person(id=member.id, full_name=member.full_name) if member else None,
            ),
            stats=Stats(
                registered=db.scalar(select(func.count()).select_from(Candidate).where(Candidate.partner_id == partner_id)) or 0,
                initiated=sum(by_status.values()),
                submitted=sum(count(s) for s in (PartnerCandidateStatus.submitted, PartnerCandidateStatus.under_review, PartnerCandidateStatus.job_assigned, PartnerCandidateStatus.rejected)),
                under_review=count(PartnerCandidateStatus.under_review),
                approved=count(PartnerCandidateStatus.job_assigned),
                rejected_or_withdrawn=count(PartnerCandidateStatus.rejected),
                first_activity_at=first_submitted or first_drafted,
                last_activity_at=last_change,
            ),
            reports=[ReportRow.model_validate(r) for r in reports],
            follow_ups=[FollowUpRow.model_validate(f) for f in follow_ups],
            activity=_activity(db, partner_id, [r.id for r in reports], [f.id for f in follow_ups]),
        )
    )


# --- reports -----------------------------------------------------------------

ReportStatus = Literal["pending", "submitted", "returned", "closed"]
Notes = Annotated[str, StringConstraints(strip_whitespace=True, min_length=2, max_length=10000)]


class ReportIn(BaseModel):
    """createPartnerReportSchema. Notes are required (upstream's DEF-011: an
    empty report saved a blank row)."""

    partner_id: str
    reported_at: datetime | None = None
    period_start: datetime | None = None
    period_end: datetime | None = None
    content: Notes
    status: ReportStatus = "submitted"


class ReportPatch(BaseModel):
    status: ReportStatus | None = None
    content: Annotated[str, StringConstraints(strip_whitespace=True, max_length=10000)] | None = None
    reported_at: datetime | None = None


@router.post("/partner-reports", response_model=Data[ReportRow], status_code=status.HTTP_201_CREATED)
def record_report(body: ReportIn, user: Tracker, db: AuditedDb):
    """POST /api/partner-reports: a report the VA records for the partner
    (partners still report over WhatsApp and email)."""
    reachable_partner(db, user, body.partner_id)
    report = PartnerReport(
        partner_id=body.partner_id,
        reported_at=body.reported_at or utc_now_ms(),
        period_start=body.period_start,
        period_end=body.period_end,
        content={"notes": body.content},
        status=PartnerReportStatus(body.status),
        submitted_by=user.user_id,
    )
    db.add(report)
    db.commit()
    db.refresh(report)
    return {"data": report}


@router.patch("/partner-reports/{report_id}", response_model=Data[ReportRow])
def update_report(report_id: str, body: ReportPatch, user: Tracker, db: AuditedDb):
    """PATCH /api/partner-reports/[id]: its status, notes or date."""
    report = db.get(PartnerReport, report_id)
    if report is None:
        raise ApiError(404, "not_found", "Report not found.")
    reachable_partner(db, user, report.partner_id)
    if body.status is not None:
        report.status = PartnerReportStatus(body.status)
    if body.content is not None:
        report.content = {"notes": body.content}
    if body.reported_at is not None:
        report.reported_at = body.reported_at
    db.commit()
    db.refresh(report)
    return {"data": report}


# --- follow-ups --------------------------------------------------------------


class FollowUpIn(BaseModel):
    partner_id: str
    action: Annotated[str, StringConstraints(strip_whitespace=True, min_length=2, max_length=500)]
    due_at: datetime | None = None
    assigned_team_member: str | None = None


class FollowUpPatch(BaseModel):
    status: Literal["open", "done"] | None = None
    action: Annotated[str, StringConstraints(strip_whitespace=True, min_length=2, max_length=500)] | None = None
    due_at: datetime | None = None


@router.post("/partner-follow-ups", response_model=Data[FollowUpRow], status_code=status.HTTP_201_CREATED)
def add_follow_up(body: FollowUpIn, user: Tracker, db: AuditedDb):
    """POST /api/partner-follow-ups: an action to take for the partner,
    assigned to whoever records it unless they name an active colleague."""
    reachable_partner(db, user, body.partner_id)
    if body.assigned_team_member:
        _active_user(db, body.assigned_team_member)
    follow_up = PartnerFollowUp(
        partner_id=body.partner_id,
        action=body.action,
        due_at=body.due_at,
        assigned_team_member=body.assigned_team_member or user.user_id,
        status=PartnerFollowUpStatus.open,
    )
    db.add(follow_up)
    db.commit()
    db.refresh(follow_up)
    return {"data": follow_up}


@router.patch("/partner-follow-ups/{follow_up_id}", response_model=Data[FollowUpRow])
def update_follow_up(follow_up_id: str, body: FollowUpPatch, user: Tracker, db: AuditedDb):
    """PATCH /api/partner-follow-ups/[id]: done (stamped) or reopened, or
    its action or due date changed. A due date sent as null clears it."""
    follow_up = db.get(PartnerFollowUp, follow_up_id)
    if follow_up is None:
        raise ApiError(404, "not_found", "Follow-up not found.")
    reachable_partner(db, user, follow_up.partner_id)
    if body.action is not None:
        follow_up.action = body.action
    if "due_at" in body.model_fields_set:
        follow_up.due_at = body.due_at
    if body.status is not None:
        follow_up.status = PartnerFollowUpStatus(body.status)
        follow_up.completed_at = utc_now_ms() if body.status == "done" else None
    db.commit()
    db.refresh(follow_up)
    return {"data": follow_up}


# --- the VA team, for assigning partners ---------------------------------------


class VaUserRow(BaseModel):
    id: str
    full_name: str
    email: str
    email_verified: bool
    is_active: bool
    created_at: UtcDateTime
    partners_assigned: int = Field(description="Partners this VA is responsible for")


@router.get("/va-users")
def va_users(_manager: Manager, db: DbSession) -> Data[list[VaUserRow]]:
    """GET /api/admin/va-users: every Virtual Assistant and how many
    partners each holds (a deactivated VA may still hold some until they
    are reassigned)."""
    vas = list(db.scalars(select(User).where(User.role == Role.virtual_assistant).order_by(User.full_name, User.id)))
    held = dict(
        db.execute(
            select(Partner.assigned_team_member_id, func.count())
            .where(Partner.assigned_team_member_id.in_([u.id for u in vas]))
            .group_by(Partner.assigned_team_member_id)
        ).all()
    ) if vas else {}
    return Data(
        data=[
            VaUserRow(
                id=u.id, full_name=u.full_name, email=u.email, email_verified=u.email_verified,
                is_active=u.deactivated_at is None, created_at=u.created_at, partners_assigned=held.get(u.id, 0),
            )
            for u in vas
        ]
    )
