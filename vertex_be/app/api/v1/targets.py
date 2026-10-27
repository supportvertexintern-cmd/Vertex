"""Recruiter targets, staff KPI targets and recruiter notes, owned by FastAPI
since recruitment-operations step 5.2.

They answer as Next.js's /api/recruiter-targets, POST /api/staff-kpi-targets
and /api/recruiter-notes did, which now pass requests on through
callBackend(): the same roles (tests fail if the lists drift), the same
management hierarchy, rules, messages, status codes and Prisma-shaped JSON.
Who the caller is comes from their session, never from the request; who
they may manage is read from the database (a recruiter's supervisor, a
country supervisor's country, an In-House Supervisor's assigned countries).

Reads that measure targets against actual candidates stay in Next.js
(GET /api/staff-kpi-targets, /api/recruiter-targets/progress) until the
candidate pipeline moves: they only read these tables.

Every change is on the audit trail (RecruiterTarget, StaffKpiTarget and
RecruiterNote are in AUDITED_MODELS).
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Query, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import selectinload

from app.api.deps import DbSession
from app.core.api import ApiError, Data, UtcDateTime
from app.core.audit import AuditedDb
from app.core.auth import AuthUser
from app.core.rbac import STAFF_ROLES, require_role
from app.core.report_templates import REPORT_KPI_LABELS
from app.models.campaign import CampaignTarget, RecruiterTarget
from app.models.enums import CampaignMetric, CampaignStatus, ReportCycle, Role
from app.models.identity import InhouseCountryAssignment, User
from app.models.reporting import RecruiterNote, StaffKpiTarget

router = APIRouter()

# Recruiter targets are read by every staff role, each seeing their own
# slice; a Country Supervisor splits their country's campaign target across
# their recruiters (admin keeps override).
TARGET_READERS: tuple[Role, ...] = (
    Role.regional_recruiter,
    Role.country_supervisor,
    Role.inhouse_supervisor,
    Role.director,
    Role.admin,
)
TARGET_SETTERS: tuple[Role, ...] = (Role.country_supervisor, Role.admin)
# A recruiter reads their own notes; a Country Supervisor reads and writes
# their recruiters'.
NOTE_READERS: tuple[Role, ...] = (Role.regional_recruiter, Role.country_supervisor, Role.admin)
NOTE_WRITERS: tuple[Role, ...] = (Role.country_supervisor, Role.admin)

CUID = r"^c[^\s-]{8,}$"  # zod's .cuid()
UNIQUE_VIOLATION = "23505"


def _forbidden(message: str) -> ApiError:
    return ApiError(403, "forbidden", message)


def _upsert(db: AuditedDb, write) -> None:
    """Runs write() and commits; a row a concurrent request created between
    the lookup and the insert is updated on a second try."""
    try:
        write()
        db.commit()
    except IntegrityError as err:
        db.rollback()
        if getattr(err.orig, "pgcode", None) != UNIQUE_VIOLATION:
            raise
        write()
        db.commit()


# --- shapes ------------------------------------------------------------------


class Named(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str


class Person(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    full_name: str


class CampaignBrief(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    start_date: UtcDateTime
    end_date: UtcDateTime
    status: CampaignStatus


class CampaignTargetBrief(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    metric: CampaignMetric
    target_value: float
    country: Named | None
    campaign: CampaignBrief


class RecruiterTargetOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    campaign_target_id: str
    target_value: float
    updated_at: UtcDateTime
    recruiter: Person


class RecruiterTargetListItem(RecruiterTargetOut):
    campaign_target: CampaignTargetBrief


class RecruiterTargetIn(BaseModel):
    campaign_target_id: str = Field(pattern=CUID)
    recruiter_id: str = Field(pattern=CUID)
    target_value: float = Field(gt=0)


class StaffKpiTargetOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    staff_id: str
    cycle: ReportCycle
    kpi_label: str
    target_value: float
    updated_at: UtcDateTime


class StaffKpiTargetIn(BaseModel):
    staff_id: str = Field(pattern=CUID)
    cycle: ReportCycle
    kpi_label: str = Field(min_length=1)
    target_value: float = Field(gt=0)


class Author(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    full_name: str


class NoteOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    message: str
    created_at: UtcDateTime
    author: Author


class NoteIn(BaseModel):
    recruiter_id: str = Field(pattern=CUID)
    message: str = Field(min_length=1, max_length=2000)


# --- recruiter targets -------------------------------------------------------


@router.get("/recruiter-targets")
def list_recruiter_targets(
    db: DbSession,
    user: Annotated[AuthUser, Depends(require_role(*TARGET_READERS))],
    campaign_target_id: Annotated[str | None, Query()] = None,
) -> Data[list[RecruiterTargetListItem]]:
    """A recruiter sees their own allocations, a Country Supervisor their
    recruiters', everyone else all of them. Most recently set first."""
    query = (
        select(RecruiterTarget)
        .options(
            selectinload(RecruiterTarget.recruiter),
            selectinload(RecruiterTarget.campaign_target).selectinload(CampaignTarget.country),
            selectinload(RecruiterTarget.campaign_target).selectinload(CampaignTarget.campaign),
        )
        .order_by(RecruiterTarget.updated_at.desc())
    )
    if campaign_target_id:
        query = query.where(RecruiterTarget.campaign_target_id == campaign_target_id)
    if user.role is Role.regional_recruiter:
        query = query.where(RecruiterTarget.recruiter_id == user.user_id)
    elif user.role is Role.country_supervisor:
        query = query.where(RecruiterTarget.recruiter.has(User.supervisor_id == user.user_id))
    return Data(data=[RecruiterTargetListItem.model_validate(t) for t in db.scalars(query)])


@router.post("/recruiter-targets", status_code=status.HTTP_201_CREATED)
def set_recruiter_target(
    body: RecruiterTargetIn, db: AuditedDb, user: Annotated[AuthUser, Depends(require_role(*TARGET_SETTERS))]
) -> Data[RecruiterTargetOut]:
    """Sets one recruiter's share of a campaign target (creates or replaces it)."""
    campaign_target = db.get(CampaignTarget, body.campaign_target_id)
    if campaign_target is None:
        raise ApiError(404, "not_found", "Campaign target not found.")
    recruiter = db.get(User, body.recruiter_id)
    if recruiter is None or recruiter.role is not Role.regional_recruiter:
        raise ApiError(404, "not_found", "Recruiter not found.")
    if user.role is Role.country_supervisor:
        if recruiter.supervisor_id != user.user_id:
            raise _forbidden("You can only set targets for recruiters you supervise.")
        if not campaign_target.country_id or campaign_target.country_id != recruiter.assigned_country_id:
            raise _forbidden("This campaign target isn't scoped to your recruiter's country.")

    def write() -> None:
        target = db.scalars(
            select(RecruiterTarget).where(
                RecruiterTarget.campaign_target_id == body.campaign_target_id, RecruiterTarget.recruiter_id == body.recruiter_id
            )
        ).first()
        if target is None:
            db.add(RecruiterTarget(campaign_target_id=body.campaign_target_id, recruiter_id=body.recruiter_id, target_value=body.target_value, set_by=user.user_id))
        else:
            target.target_value, target.set_by = body.target_value, user.user_id

    _upsert(db, write)
    target = db.scalars(
        select(RecruiterTarget).where(RecruiterTarget.campaign_target_id == body.campaign_target_id, RecruiterTarget.recruiter_id == body.recruiter_id)
    ).one()
    db.refresh(target)
    return Data(data=RecruiterTargetOut.model_validate(target))


# --- staff KPI targets -------------------------------------------------------


def can_manage(db: DbSession, caller: AuthUser, staff: User) -> bool:
    """One mechanism for the three supervisory relationships: who may set a
    staff member's targets depends on the staff member's own role and
    reporting line. Admin manages everyone."""
    if caller.role is Role.admin:
        return True
    if staff.role is Role.regional_recruiter:
        return caller.role is Role.country_supervisor and staff.supervisor_id == caller.user_id
    if staff.role is Role.country_supervisor:
        if caller.role is not Role.inhouse_supervisor or not staff.assigned_country_id:
            return False
        assigned = select(InhouseCountryAssignment.id).where(
            InhouseCountryAssignment.inhouse_supervisor_id == caller.user_id, InhouseCountryAssignment.country_id == staff.assigned_country_id
        )
        return db.scalars(assigned).first() is not None
    if staff.role is Role.inhouse_supervisor:
        return caller.role is Role.director
    return False


@router.post("/staff-kpi-targets", status_code=status.HTTP_201_CREATED)
def set_staff_kpi_target(
    body: StaffKpiTargetIn, db: AuditedDb, user: Annotated[AuthUser, Depends(require_role(*STAFF_ROLES))]
) -> Data[StaffKpiTargetOut]:
    """Sets one KPI-row target for a direct report, keyed to a label their
    own report's KPI table uses for that cycle (creates or replaces it)."""
    staff = db.get(User, body.staff_id)
    if staff is None:
        raise ApiError(404, "not_found", "Staff member not found.")
    if body.kpi_label not in REPORT_KPI_LABELS.get(staff.role, {}).get(body.cycle, ()):
        raise ApiError(422, "invalid_label", "That label doesn't appear on this staff member's report for this cycle.")
    if not can_manage(db, user, staff):
        raise _forbidden("You can only set targets for your own direct reports.")

    key = (StaffKpiTarget.staff_id == body.staff_id, StaffKpiTarget.cycle == body.cycle, StaffKpiTarget.kpi_label == body.kpi_label)

    def write() -> None:
        target = db.scalars(select(StaffKpiTarget).where(*key)).first()
        if target is None:
            db.add(StaffKpiTarget(staff_id=body.staff_id, cycle=body.cycle, kpi_label=body.kpi_label, target_value=body.target_value, set_by=user.user_id))
        else:
            target.target_value, target.set_by = body.target_value, user.user_id

    _upsert(db, write)
    target = db.scalars(select(StaffKpiTarget).where(*key)).one()
    db.refresh(target)
    return Data(data=StaffKpiTargetOut.model_validate(target))


# --- recruiter notes ---------------------------------------------------------


def _supervises(db: DbSession, caller: AuthUser, recruiter_id: str) -> bool:
    return db.scalar(select(User.supervisor_id).where(User.id == recruiter_id)) == caller.user_id


@router.get("/recruiter-notes")
def list_notes(
    db: DbSession,
    user: Annotated[AuthUser, Depends(require_role(*NOTE_READERS))],
    recruiter_id: Annotated[str | None, Query()] = None,
) -> Data[list[NoteOut]]:
    """A recruiter's notes, newest first: a recruiter reads their own (the
    id defaults to, and must be, theirs), a Country Supervisor any one of
    their recruiters', admin anyone's."""
    if user.role is Role.regional_recruiter:
        if recruiter_id and recruiter_id != user.user_id:
            raise _forbidden("You can only read your own notes.")
        recruiter_id = user.user_id
    else:
        if not recruiter_id:
            raise ApiError(422, "validation_error", "recruiter_id is required.")
        if user.role is Role.country_supervisor and not _supervises(db, user, recruiter_id):
            raise _forbidden("This recruiter is not under your supervision.")
    notes = db.scalars(
        select(RecruiterNote).options(selectinload(RecruiterNote.author)).where(RecruiterNote.recruiter_id == recruiter_id).order_by(RecruiterNote.created_at.desc())
    )
    return Data(data=[NoteOut.model_validate(n) for n in notes])


@router.post("/recruiter-notes", status_code=status.HTTP_201_CREATED)
def add_note(body: NoteIn, db: AuditedDb, user: Annotated[AuthUser, Depends(require_role(*NOTE_WRITERS))]) -> Data[NoteOut]:
    """A Country Supervisor's note to one of their own recruiters."""
    if user.role is Role.country_supervisor and not _supervises(db, user, body.recruiter_id):
        raise _forbidden("This recruiter is not under your supervision.")
    if db.get(User, body.recruiter_id) is None:
        raise ApiError(404, "not_found", "Recruiter not found.")
    note = RecruiterNote(recruiter_id=body.recruiter_id, author_id=user.user_id, message=body.message)
    db.add(note)
    db.commit()
    db.refresh(note)
    return Data(data=NoteOut.model_validate(note))
