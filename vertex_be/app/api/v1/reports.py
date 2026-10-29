"""Supervisory reports (SRS FR-3.4/FR-3.5, Supervisory Reporting Framework
§3-§5): their writes, owned by FastAPI since recruitment-operations step
5.4.

They answer as Next.js's POST /api/reports and PATCH /api/reports/[id]/
{verify,return,resubmit} did, which now pass requests on through
callBackend(): the same roles (tests fail if the lists drift), reporting
line, rules, messages, status codes and JSON. The list, the detail page and
the consolidation preview stay in Next.js: they only read reports.

The reporting line:

- A recruiter submits at recruiter scope, a Country Supervisor at country
  scope, an In-House Supervisor at portfolio ("inhouse") scope. A country
  report consolidates verified recruiter reports from its own country; a
  portfolio report, verified country reports from the supervisor's
  assigned countries. Consolidated reports point to their parent.
- One controlling position reviews each scope (FR-3.5): a Country
  Supervisor the recruiter reports of their country, an In-House Supervisor
  the country reports of their countries, the director the portfolio
  reports. Admin overrides. Verifying a portfolio report approves it.
- A returned report is corrected and resubmitted by its submitter (or
  admin).

The CRM Submission Ref. in a report's content is always the report's own
id, written with the report rather than in a second statement. Every
change is on the audit trail, each consolidated child included (Report is
in AUDITED_MODELS).
"""

from __future__ import annotations

import math
from datetime import UTC, datetime
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Body, Depends, status
from fastapi.exceptions import RequestValidationError
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator
from sqlalchemy import select

from app.core.api import ApiError, Data, js_date
from app.core.audit import AuditedDb
from app.core.auth import AuthUser
from app.core.rbac import require_role
from app.db.base import new_id
from app.models.enums import ReportCycle, ReportStatus, Role, ScopeLevel
from app.models.identity import InhouseCountryAssignment, User
from app.models.reporting import Report

router = APIRouter()

SUBMITTERS: tuple[Role, ...] = (Role.regional_recruiter, Role.country_supervisor, Role.inhouse_supervisor)
REVIEWERS: tuple[Role, ...] = (Role.country_supervisor, Role.inhouse_supervisor, Role.director, Role.admin)
RESUBMITTERS: tuple[Role, ...] = (Role.regional_recruiter, Role.country_supervisor, Role.inhouse_supervisor, Role.admin)

SCOPE_OF: dict[Role, ScopeLevel] = {
    Role.regional_recruiter: ScopeLevel.recruiter,
    Role.country_supervisor: ScopeLevel.country,
    Role.inhouse_supervisor: ScopeLevel.inhouse,
}
CHILD_SCOPE = {ScopeLevel.country: ScopeLevel.recruiter, ScopeLevel.inhouse: ScopeLevel.country}
REVIEWER_OF = {ScopeLevel.recruiter: Role.country_supervisor, ScopeLevel.country: Role.inhouse_supervisor, ScopeLevel.inhouse: Role.director}

CUID = r"^c[^\s-]{8,}$"


def can_review(role: Role, scope: ScopeLevel) -> bool:
    """The one controlling position for a scope (FR-3.5); admin overrides.
    The director is deliberately not a fallback for country reports."""
    return role is Role.admin or REVIEWER_OF.get(scope) is role


# --- report content (reportContentSchema) -------------------------------------
# Optional fields default to None but aren't typed to take it: as zod's
# .optional(), an explicit null is refused, and an absent field is left out
# of the stored content (model_dump(exclude_none=True)).


class _Row(BaseModel):
    """zod strips keys it doesn't know; so do these."""


class KpiRow(_Row):
    label: str = Field(min_length=1)
    target: float = None  # type: ignore[assignment]
    actual: float = None  # type: ignore[assignment]
    comment: str = Field(default=None, max_length=1000)  # type: ignore[assignment]


class PipelineRow(_Row):
    stage: str = Field(min_length=1)
    opening: float = None  # type: ignore[assignment]
    added: float = None  # type: ignore[assignment]
    moved_forward: float = None  # type: ignore[assignment]
    closed_rejected: float = None  # type: ignore[assignment]
    closing: float = None  # type: ignore[assignment]
    target: float = None  # type: ignore[assignment]


class ActivityRow(_Row):
    candidate_ref: str = Field(min_length=1)
    role: str = Field(default=None, max_length=150)  # type: ignore[assignment]
    current_status: str = Field(default=None, max_length=100)  # type: ignore[assignment]
    action_completed: str = Field(default=None, max_length=500)  # type: ignore[assignment]
    next_action: str = Field(default=None, max_length=500)  # type: ignore[assignment]


class IssueRow(_Row):
    label: str = Field(min_length=1)
    detail: str = Field(default=None, max_length=1000)  # type: ignore[assignment]
    action: str = Field(default=None, max_length=1000)  # type: ignore[assignment]
    owner: str = Field(default=None, max_length=150)  # type: ignore[assignment]
    due_date: str = None  # type: ignore[assignment]
    status: str = Field(default=None, max_length=100)  # type: ignore[assignment]
    escalation: bool = None  # type: ignore[assignment]


class PriorityRow(_Row):
    label: str = Field(min_length=1)
    planned_activity: str = Field(default=None, max_length=500)  # type: ignore[assignment]
    target_measure: str = Field(default=None, max_length=300)  # type: ignore[assignment]
    support_required: str = Field(default=None, max_length=500)  # type: ignore[assignment]
    owner: str = Field(default=None, max_length=150)  # type: ignore[assignment]
    due_date: str = None  # type: ignore[assignment]


class AchievementRow(_Row):
    label: str = Field(min_length=1)
    evidence: str = Field(default=None, max_length=1000)  # type: ignore[assignment]
    business_impact: str = Field(default=None, max_length=1000)  # type: ignore[assignment]


class CompetencyRow(_Row):
    area: str = Field(min_length=1)
    self_rating: float = Field(default=None, ge=1, le=5)  # type: ignore[assignment]
    evidence: str = Field(default=None, max_length=1000)  # type: ignore[assignment]
    supervisor_rating: float = Field(default=None, ge=1, le=5)  # type: ignore[assignment]


class ReportContent(BaseModel):
    campaign_or_role: str = Field(default=None, max_length=200)  # type: ignore[assignment]
    crm_reference: str = Field(default=None, max_length=200)  # type: ignore[assignment]
    executive_summary: str = Field(default=None, max_length=3000)  # type: ignore[assignment]
    overall_status: Literal["green", "amber", "red", "grey"] = None  # type: ignore[assignment]
    kpis: list[KpiRow] = Field(default_factory=list)
    pipeline: list[PipelineRow] = Field(default_factory=list)
    activity: list[ActivityRow] = Field(default_factory=list)
    issues: list[IssueRow] = Field(default_factory=list)
    achievements: list[AchievementRow] = Field(default_factory=list)
    priorities: list[PriorityRow] = Field(default_factory=list)
    competencies: list[CompetencyRow] = Field(default_factory=list)
    key_achievement: str = Field(default=None, max_length=500)  # type: ignore[assignment]
    next_priority: str = Field(default=None, max_length=500)  # type: ignore[assignment]
    certified: bool

    @field_validator("certified")
    @classmethod
    def _certified(cls, value: bool) -> bool:
        if value is not True:
            raise ValueError("You must certify this report before submitting.")
        return value

    def stored(self, report_id: str) -> dict[str, Any]:
        """What is saved: the content as sent, with the report's own id as its
        CRM Submission Ref. (never user-entered)."""
        return self.model_dump(exclude_none=True) | {"crm_reference": report_id}


# --- submitting ---------------------------------------------------------------


class SubmitIn(BaseModel):
    type: ReportCycle
    period_start: datetime
    period_end: datetime
    content: ReportContent
    child_report_ids: list[Annotated[str, Field(pattern=CUID)]] | None = None

    _dates = field_validator("period_start", "period_end", mode="before")(lambda v: js_date(v) if isinstance(v, str) else v)


def _period_errors(body: SubmitIn) -> dict[str, list[str]]:
    """submitReportSchema's refinements. A daily report covers one day; a
    weekly one is a Monday-to-Sunday window, so reports for "the same week"
    match exactly when they're consolidated."""
    errors: dict[str, list[str]] = {}
    start, end = body.period_start, body.period_end
    if body.type is not ReportCycle.daily and end <= start:
        errors.setdefault("period_end", []).append("Period end must be after the period start.")
    if end > datetime.now(UTC).replace(tzinfo=None):
        errors.setdefault("period_end", []).append("A report can't cover a period that hasn't happened yet.")
    if body.type is ReportCycle.weekly:
        if start.weekday() != 0:
            errors.setdefault("period_start", []).append("A weekly report must start on a Monday.")
        if not math.isclose((end - start).total_seconds(), 6 * 86400):
            errors.setdefault("period_end", []).append("A weekly report must cover exactly 7 days (Monday through Sunday).")
    return errors


class SubmittedOut(BaseModel):
    id: str
    type: ReportCycle
    scope_level: ScopeLevel
    status: ReportStatus


def _inhouse_countries(db: AuditedDb, user_id: str) -> list[str]:
    return list(db.scalars(select(InhouseCountryAssignment.country_id).where(InhouseCountryAssignment.inhouse_supervisor_id == user_id)))


def _no_country() -> ApiError:
    return ApiError(422, "no_country", "You must be assigned a country before submitting a report.")


@router.post("/reports", status_code=status.HTTP_201_CREATED)
def submit_report(body: SubmitIn, db: AuditedDb, user: Annotated[AuthUser, Depends(require_role(*SUBMITTERS))]) -> Data[SubmittedOut]:
    """Submits a report at the caller's own scope, consolidating the given
    verified child reports into it."""
    if errors := _period_errors(body):
        raise ApiError(422, "validation_error", "Validation failed", errors)

    scope = SCOPE_OF[user.role]
    country_id: str | None = None
    inhouse_countries: list[str] = []
    if scope is ScopeLevel.inhouse:
        # A portfolio across several countries: it has no country of its own.
        inhouse_countries = _inhouse_countries(db, user.user_id)
        if not inhouse_countries:
            raise _no_country()
    else:
        country_id = db.scalar(select(User.assigned_country_id).where(User.id == user.user_id))
        if not country_id:
            raise _no_country()

    child_ids = body.child_report_ids or []
    if scope is ScopeLevel.recruiter and child_ids:
        raise ApiError(422, "invalid_scope", "Only a country-level or portfolio-level report can consolidate child reports.")

    children: list[Report] = []
    if child_ids:
        query = select(Report).where(
            Report.id.in_(child_ids),
            Report.scope_level == CHILD_SCOPE[scope],
            Report.status == ReportStatus.verified,
            Report.country_id.in_(inhouse_countries) if scope is ScopeLevel.inhouse else Report.country_id == country_id,
        )
        children = list(db.scalars(query))
        if len(children) != len(child_ids):
            mine = "one of your assigned countries" if scope is ScopeLevel.inhouse else "your own country"
            raise ApiError(422, "invalid_children", f"Every consolidated report must be a verified report from {mine}.")

    report_id = new_id()
    db.add(
        Report(
            id=report_id,
            type=body.type,
            scope_level=scope,
            country_id=country_id,
            submitted_by=user.user_id,
            period_start=body.period_start,
            period_end=body.period_end,
            status=ReportStatus.submitted,
            content=body.content.stored(report_id),
        )
    )
    db.flush()
    for child in children:
        child.parent_report_id = report_id
        child.status = ReportStatus.consolidated
    db.commit()
    return Data(data=SubmittedOut(id=report_id, type=body.type, scope_level=scope, status=ReportStatus.submitted))


# --- reviewing ----------------------------------------------------------------


Reviewer = Annotated[AuthUser, Depends(require_role(*REVIEWERS))]


def _reviewable(db: AuditedDb, report_id: str, user: AuthUser, verb: str) -> Report:
    report = db.get(Report, report_id)
    if report is None:
        raise ApiError(404, "not_found", "Report not found.")
    if not can_review(user.role, report.scope_level):
        raise ApiError(403, "forbidden", "You are not the controlling position for this report.")
    if report.scope_level is ScopeLevel.recruiter and user.role is Role.country_supervisor:
        if db.scalar(select(User.assigned_country_id).where(User.id == user.user_id)) != report.country_id:
            raise ApiError(403, "forbidden", "This report is not in your assigned country.")
    if report.scope_level is ScopeLevel.country and user.role is Role.inhouse_supervisor:
        if not report.country_id or report.country_id not in _inhouse_countries(db, user.user_id):
            raise ApiError(403, "forbidden", "This report is not in one of your assigned countries.")
    if report.status is not ReportStatus.submitted:
        raise ApiError(422, "invalid_transition", f"A report in '{report.status.value}' status cannot be {verb}.")
    return report


class StatusOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    status: ReportStatus


class ReturnedOut(StatusOut):
    return_reason: str | None


class ReturnIn(BaseModel):
    return_reason: str = Field(min_length=5, max_length=1000)


@router.patch("/reports/{report_id}/verify")
def verify_report(report_id: str, db: AuditedDb, user: Reviewer) -> Data[StatusOut]:
    """The controlling position accepts the report as submitted: a Country
    Supervisor or In-House Supervisor "verifies", the director "approves"
    a portfolio report (§8.2). The parent report isn't created here: its
    submitter reviews the roll-up and submits it themselves."""
    report = _reviewable(db, report_id, user, "verified")
    report.status = ReportStatus.approved if report.scope_level is ScopeLevel.inhouse else ReportStatus.verified
    report.return_reason = None
    db.commit()
    return Data(data=StatusOut.model_validate(report))


@router.patch("/reports/{report_id}/return")
def return_report(report_id: str, body: ReturnIn, db: AuditedDb, user: Reviewer) -> Data[ReturnedOut]:
    """Sends an incomplete or incorrect report back to its submitter."""
    report = _reviewable(db, report_id, user, "returned")
    report.status = ReportStatus.returned
    report.return_reason = body.return_reason
    db.commit()
    return Data(data=ReturnedOut.model_validate(report))


@router.patch("/reports/{report_id}/resubmit")
def resubmit_report(
    report_id: str,
    db: AuditedDb,
    user: Annotated[AuthUser, Depends(require_role(*RESUBMITTERS))],
    body: Annotated[Any, Body()] = None,
) -> Data[StatusOut]:
    """Only the original submitter (or admin) corrects and resubmits a
    returned report. The content is checked after the report, as the
    website did."""
    report = db.get(Report, report_id)
    if report is None:
        raise ApiError(404, "not_found", "Report not found.")
    if report.submitted_by != user.user_id and user.role is not Role.admin:
        raise ApiError(403, "forbidden", "Only the original submitter can resubmit this report.")
    if report.status is not ReportStatus.returned:
        raise ApiError(422, "invalid_transition", "Only a returned report can be resubmitted.")
    try:
        content = ReportContent.model_validate(body.get("content") if isinstance(body, dict) else None)
    except ValidationError as err:
        raise RequestValidationError([{**e, "loc": ("body", "content", *e["loc"])} for e in err.errors()]) from None
    report.status = ReportStatus.submitted
    report.return_reason = None
    report.content = content.stored(report.id)
    db.commit()
    return Data(data=StatusOut.model_validate(report))
