"""Exception writes for the pipeline handover, step 6.5
(docs/architecture/pipeline-handover.md): raising an exception (Supervisory
Reporting Framework §6) with its corrective actions, and escalating or
deciding one.

Built ahead of the switch (D3 B): every route answers 503 until
PIPELINE_WRITES_ENABLED is set at step 6.7, when Next.js's POST
/api/exceptions and PATCH /api/exceptions/[id] start passing requests on.
The list (GET) stays in Next.js.

They answer as those routes do: the same roles (tests fail if the lists
drift), escalation rules (app/services/exception_workflow.py), messages and
status codes. Every change is on the audit trail (Exception and
ExceptionCorrectiveAction are in AUDITED_MODELS).
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, status
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from app.api.v1.candidates import _date
from app.core.api import ApiError, Data, js_date
from app.core.audit import AuditedDb
from app.core.auth import AuthUser
from app.core.pipeline import PipelineWrites
from app.core.rbac import STAFF_ROLES, require_role
from app.core.scope import CandidateRef, can_access_candidate, inhouse_country_ids
from app.models.candidate import Candidate
from app.models.enums import EscalationLevel, ExceptionCategory, ExceptionDecision, ExceptionStatus, Role
from app.models.identity import User
from app.models.reporting import ExceptionCorrectiveAction, ExceptionReport
from app.services.exception_workflow import RAISE_LEVEL_BY_ROLE, next_escalation_level, role_can_act_on_level

router = APIRouter()

RAISERS: tuple[Role, ...] = tuple(STAFF_ROLES)
CUID = r"^c[^\s-]{8,}$"
UNIQUE_VIOLATION = "23505"
FOREIGN_KEY_VIOLATION = "23503"


def _now() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


# --- input -------------------------------------------------------------------


class CorrectiveActionIn(BaseModel):
    action: str = Field(min_length=1, max_length=500)
    owner_id: str | None = Field(None, pattern=CUID)
    due_date: datetime | None = None
    success_measure: str | None = Field(None, max_length=500)

    _dates = field_validator("due_date", mode="before")(_date)


class RaiseIn(BaseModel):
    """raiseExceptionSchema."""

    category: ExceptionCategory
    candidate_id: str | None = Field(None, pattern=CUID)
    reference_note: str | None = Field(None, max_length=300)
    issue_statement: str = Field(min_length=10, max_length=2000)
    immediate_impact: str = Field(min_length=5, max_length=2000)
    actions_taken: str | None = Field(None, max_length=2000)
    root_cause: str | None = Field(None, max_length=2000)
    options_considered: str | None = Field(None, max_length=2000)
    recommendation: str | None = Field(None, max_length=2000)
    decision_required: str = Field(min_length=5, max_length=1000)
    decision_deadline: datetime
    corrective_actions: list[CorrectiveActionIn] = []

    @field_validator("decision_deadline", mode="before")
    @classmethod
    def _deadline(cls, value: object) -> object:
        if value == "":
            raise ValueError("A decision deadline is required.")
        return js_date(value) if isinstance(value, str) else value


class EscalateIn(BaseModel):
    action: Literal["escalate"]


class DecideIn(BaseModel):
    action: Literal["decide"]
    decision: ExceptionDecision
    decision_notes: str | None = Field(None, max_length=2000)


UpdateIn = Annotated[EscalateIn | DecideIn, Field(discriminator="action")]


# --- output ------------------------------------------------------------------


class Raised(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    reference: str


class Updated(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    escalation_level: EscalationLevel
    status: ExceptionStatus
    decision: ExceptionDecision | None = None


# --- raising -----------------------------------------------------------------


def _exception_country(db, user: AuthUser, body: RaiseIn) -> str | None:
    """The candidate's country when there is one (a candidate has exactly
    one); else the raiser's own, when it's unambiguous."""
    if body.candidate_id:
        candidate = db.get(Candidate, body.candidate_id)
        if candidate is None or not can_access_candidate(db, user, CandidateRef.of(candidate)):
            raise ApiError(403, "forbidden", "You don't have access to that candidate.")
        return candidate.country_id
    if user.role is Role.inhouse_supervisor:
        countries = inhouse_country_ids(db, user.user_id)
        return countries[0] if len(countries) == 1 else None
    return db.scalar(select(User.assigned_country_id).where(User.id == user.user_id))


def _next_reference(db) -> str:
    count = db.scalar(select(func.count()).select_from(ExceptionReport)) or 0
    return f"EXC-{count + 1:06d}"


@router.post("/exceptions", response_model=Data[Raised], status_code=status.HTTP_201_CREATED)
def raise_exception(
    body: RaiseIn,
    user: Annotated[AuthUser, Depends(require_role(*RAISERS))],
    db: AuditedDb,
    _on: PipelineWrites,
):
    """POST /api/exceptions: any staff role, at any time, independent of
    the reporting cadence. It starts at the raiser's tier."""
    country_id = _exception_country(db, user, body)
    fields = body.model_dump(exclude={"corrective_actions"})
    # The reference is sequential: a concurrent raise taking the same one
    # is retried once with the next.
    for attempt in range(2):
        savepoint = db.begin_nested()
        exception = ExceptionReport(
            **fields,
            reference=_next_reference(db),
            raised_by=user.user_id,
            role_at_raise=user.role,
            country_id=country_id,
            escalation_level=RAISE_LEVEL_BY_ROLE[user.role],
        )
        exception.corrective_actions = [ExceptionCorrectiveAction(**a.model_dump()) for a in body.corrective_actions]
        db.add(exception)
        try:
            savepoint.commit()
            break
        except IntegrityError as err:
            savepoint.rollback()
            code = getattr(err.orig, "pgcode", None)
            if code == FOREIGN_KEY_VIOLATION:
                raise ApiError(422, "validation_error", "A corrective action's owner doesn't exist.") from None
            if code != UNIQUE_VIOLATION or attempt == 1:
                raise
    db.commit()
    db.refresh(exception)
    return {"data": exception}


# --- escalating and deciding -------------------------------------------------


def _can_act_on(db, user: AuthUser, exception: ExceptionReport) -> bool:
    """The raiser and admin always; otherwise a role trusted at the
    exception's tier, in the exception's country (the director anywhere)."""
    if user.role is Role.admin or exception.raised_by == user.user_id:
        return True
    if user.role is Role.regional_recruiter or not role_can_act_on_level(user.role, exception.escalation_level):
        return False
    if user.role is Role.director:
        return True
    if not exception.country_id:
        return False
    if user.role is Role.inhouse_supervisor:
        return exception.country_id in inhouse_country_ids(db, user.user_id)
    return db.scalar(select(User.assigned_country_id).where(User.id == user.user_id)) == exception.country_id


@router.patch("/exceptions/{exception_id}", response_model=Data[Updated])
def update_exception(
    exception_id: str,
    body: UpdateIn,
    user: Annotated[AuthUser, Depends(require_role(*RAISERS))],
    db: AuditedDb,
    _on: PipelineWrites,
):
    """PATCH /api/exceptions/[id]: push it up a tier, or decide it. A
    decision of "escalated" also goes up a tier and stays open; any other
    closes it."""
    exception = db.get(ExceptionReport, exception_id)
    if exception is None:
        raise ApiError(404, "not_found", "Exception not found.")
    if exception.status is ExceptionStatus.closed:
        raise ApiError(422, "already_closed", "This exception is already closed.")
    if not _can_act_on(db, user, exception):
        raise ApiError(403, "forbidden", "Forbidden.")

    if isinstance(body, EscalateIn):
        exception.escalation_level = next_escalation_level(exception.escalation_level)
        db.commit()
        db.refresh(exception)
        return {"data": Updated(id=exception.id, escalation_level=exception.escalation_level, status=exception.status)}

    escalated = body.decision is ExceptionDecision.escalated
    exception.decision = body.decision
    exception.decision_notes = body.decision_notes
    exception.decided_by = user.user_id
    exception.decided_at = _now()
    if escalated:
        exception.escalation_level = next_escalation_level(exception.escalation_level)
    exception.status = ExceptionStatus.open if escalated else ExceptionStatus.closed
    db.commit()
    db.refresh(exception)
    return {"data": exception}
