"""Staff scorecards (Supervisory Reporting Framework §7), owned by FastAPI
since recruitment-operations step 5.3.

They answer as Next.js's /api/staff-scorecards routes did, which now pass
requests on through callBackend(): the same roles (tests fail if the lists
drift), rules, messages, status codes and Prisma-shaped JSON. A monthly
scorecard is authored by the staff member's own supervisor (admin keeps
override), never self-submitted, saved as a draft area by area, then
finalized: the weighted overall score, its performance category and the
required action are computed and stored, and the scorecard is locked.

The seven areas and their weights are a copy of SCORECARD_AREAS
(vertex/src/lib/validations.ts, which the scorecard panel still renders
with their labels); tests fail if the copies drift. Scoring lives only
here: the website's scorecardScoring.ts was removed with the move. Every change is on the audit trail (StaffScorecard and
StaffScorecardArea are in AUDITED_MODELS; the website didn't audit them).

One difference: a rating must be a whole number from 1 to 5. The website
accepted 3.5, which the integer column then refused with a 500.
"""

from __future__ import annotations

import math
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Query, status
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import selectinload

from app.api.deps import DbSession
from app.core.api import ApiError, Data, UtcDateTime, js_date
from app.core.audit import AuditedDb
from app.core.auth import AuthUser
from app.core.rbac import require_role
from app.models.enums import Role, ScorecardStatus
from app.models.identity import User
from app.models.reporting import StaffScorecard, StaffScorecardArea

router = APIRouter()

# A staff member reads their own; a reviewer the ones they authored;
# director and admin all of them.
SCORECARD_READERS: tuple[Role, ...] = (
    Role.regional_recruiter,
    Role.country_supervisor,
    Role.inhouse_supervisor,
    Role.director,
    Role.admin,
)
SCORECARD_REVIEWERS: tuple[Role, ...] = (Role.country_supervisor, Role.inhouse_supervisor, Role.director, Role.admin)
SEES_ALL = frozenset({Role.director, Role.admin})

Reviewer = Annotated[AuthUser, Depends(require_role(*SCORECARD_REVIEWERS))]

# (key, weight): SCORECARD_AREAS, in its order. The weights sum to 1.00, so
# the overall score is on the same 1-5 scale as a rating.
SCORECARD_AREAS: tuple[tuple[str, float], ...] = (
    ("target_achievement", 0.2),
    ("quality_accuracy", 0.2),
    ("reporting_timeliness", 0.15),
    ("compliance_data_discipline", 0.15),
    ("supervision_collaboration", 0.15),
    ("issue_resolution_escalation", 0.1),
    ("professional_conduct", 0.05),
)
AREA_ORDER = {key: i for i, (key, _) in enumerate(SCORECARD_AREAS)}

# (minimum score, category, required action), highest first: the framework
# (§7) names the 5-point scale; these cut points are ours.
CATEGORY_BANDS: tuple[tuple[float, str, str], ...] = (
    (4.5, "Exceptional", "Recognition"),
    (3.5, "Strong", "Maintain"),
    (2.5, "Effective", "Coaching"),
    (1.5, "Improvement Required", "Improvement Plan"),
    (0, "Unsatisfactory", "Formal Review"),
)

UNIQUE_VIOLATION = "23505"


def overall_score(areas: list[tuple[float, int | None]]) -> float:
    """The weighted sum of (weight, rating) pairs, an unrated area counting
    zero, rounded to 2 places half up as Math.round does."""
    return math.floor(sum(weight * (rating or 0) for weight, rating in areas) * 100 + 0.5) / 100


def categorize(score: float) -> tuple[str, str]:
    for minimum, category, action in CATEGORY_BANDS:
        if score >= minimum:
            return category, action
    return CATEGORY_BANDS[-1][1], CATEGORY_BANDS[-1][2]


# --- shapes ------------------------------------------------------------------


class StaffBrief(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    full_name: str
    role: Role


class ReviewerBrief(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    full_name: str


class AreaOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    area_key: str
    weight: float
    rating: int | None
    evidence: str | None


class AreaListed(AreaOut):
    id: str


class ScorecardListItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    staff: StaffBrief
    reviewer: ReviewerBrief
    period_month: UtcDateTime
    status: ScorecardStatus
    overall_score: float | None
    performance_category: str | None
    required_action: str | None
    review_date: UtcDateTime | None
    areas: list[AreaListed]
    created_at: UtcDateTime


class DraftOut(BaseModel):
    id: str
    status: ScorecardStatus
    areas: list[AreaOut]


class FinalizedOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    status: ScorecardStatus
    overall_score: float | None
    performance_category: str | None
    required_action: str | None
    review_date: UtcDateTime | None


class AreaIn(BaseModel):
    area_key: str
    rating: int | None = Field(default=None, ge=1, le=5)
    evidence: str | None = Field(default=None, max_length=1000)

    @field_validator("area_key")
    @classmethod
    def _known_area(cls, key: str) -> str:
        if key not in AREA_ORDER:
            raise ValueError(f"must be one of {', '.join(AREA_ORDER)}")
        return key


class DraftIn(BaseModel):
    staff_id: str = Field(pattern=r"^c[^\s-]{8,}$")
    period_month: datetime
    areas: list[AreaIn] = Field(max_length=len(SCORECARD_AREAS))

    _month = field_validator("period_month", mode="before")(lambda v: js_date(v) if isinstance(v, str) and v else v)


class FinalizeIn(BaseModel):
    review_date: datetime | None = None

    _date = field_validator("review_date", mode="before")(lambda v: js_date(v) if isinstance(v, str) and v else None if v == "" else v)


def _sorted(areas: list[StaffScorecardArea]) -> list[StaffScorecardArea]:
    return sorted(areas, key=lambda a: AREA_ORDER.get(a.area_key, len(AREA_ORDER)))


# --- routes ------------------------------------------------------------------


@router.get("/staff-scorecards")
def list_scorecards(
    db: DbSession,
    user: Annotated[AuthUser, Depends(require_role(*SCORECARD_READERS))],
    staff_id: Annotated[str | None, Query()] = None,
) -> Data[list[ScorecardListItem]]:
    """Newest month first."""
    query = (
        select(StaffScorecard)
        .options(selectinload(StaffScorecard.staff), selectinload(StaffScorecard.reviewer), selectinload(StaffScorecard.areas))
        .order_by(StaffScorecard.period_month.desc())
    )
    if user.role not in SEES_ALL:
        query = query.where(or_(StaffScorecard.staff_id == user.user_id, StaffScorecard.reviewer_id == user.user_id))
    if staff_id:
        query = query.where(StaffScorecard.staff_id == staff_id)
    return Data(data=[ScorecardListItem.model_validate(s) for s in db.scalars(query)])


@router.post("/staff-scorecards", status_code=status.HTTP_201_CREATED)
def save_draft(body: DraftIn, db: AuditedDb, user: Reviewer) -> Data[DraftOut]:
    """Creates the month's draft scorecard for a direct report, or updates
    it: each area sent sets the rating and evidence it carries; areas not
    sent keep theirs."""
    staff = db.get(User, body.staff_id)
    if staff is None:
        raise ApiError(404, "not_found", "Staff member not found.")
    if user.role is not Role.admin and staff.supervisor_id != user.user_id:
        raise ApiError(403, "forbidden", "You can only score your own direct reports.")

    def find() -> StaffScorecard | None:
        query = select(StaffScorecard).where(StaffScorecard.staff_id == body.staff_id, StaffScorecard.period_month == body.period_month)
        return db.scalars(query).first()

    scorecard = find()
    if scorecard is None:
        scorecard = StaffScorecard(staff_id=body.staff_id, reviewer_id=user.user_id, period_month=body.period_month)
        db.add(scorecard)
        try:
            db.flush()
        except IntegrityError as err:
            db.rollback()
            if getattr(err.orig, "pgcode", None) != UNIQUE_VIOLATION:
                raise
            scorecard = find()  # created by a concurrent request
            assert scorecard is not None
    if scorecard.status is not ScorecardStatus.draft:
        raise ApiError(422, "already_finalized", "This scorecard has already been finalized.")

    existing = {a.area_key: a for a in db.scalars(select(StaffScorecardArea).where(StaffScorecardArea.scorecard_id == scorecard.id))}
    sent = {a.area_key: a for a in body.areas}
    for key, weight in SCORECARD_AREAS:
        area = existing.get(key)
        if area is None:
            area = StaffScorecardArea(scorecard_id=scorecard.id, area_key=key, weight=weight)
            db.add(area)
            existing[key] = area
        given = sent.get(key)
        if given is not None:
            for field in given.model_fields_set & {"rating", "evidence"}:
                setattr(area, field, getattr(given, field))
    db.commit()
    db.refresh(scorecard)
    return Data(data=DraftOut(id=scorecard.id, status=scorecard.status, areas=[AreaOut.model_validate(a) for a in _sorted(scorecard.areas)]))


@router.patch("/staff-scorecards/{scorecard_id}")
def finalize(scorecard_id: str, body: FinalizeIn, db: AuditedDb, user: Reviewer) -> Data[FinalizedOut]:
    """Computes the weighted overall score from the rated areas, derives the
    performance category and required action, and locks the scorecard. Only
    its author (or admin) finalizes it, and only once every area is rated."""
    scorecard = db.scalars(select(StaffScorecard).options(selectinload(StaffScorecard.areas)).where(StaffScorecard.id == scorecard_id)).first()
    if scorecard is None:
        raise ApiError(404, "not_found", "Scorecard not found.")
    if user.role is not Role.admin and scorecard.reviewer_id != user.user_id:
        raise ApiError(403, "forbidden", "Forbidden.")
    if scorecard.status is not ScorecardStatus.draft:
        raise ApiError(422, "already_finalized", "This scorecard has already been finalized.")
    if any(a.rating is None for a in scorecard.areas):
        raise ApiError(422, "incomplete", "Every area must be rated before finalizing.")

    score = overall_score([(a.weight, a.rating) for a in scorecard.areas])
    category, action = categorize(score)
    scorecard.status = ScorecardStatus.finalized
    scorecard.overall_score = score
    scorecard.performance_category = category
    scorecard.required_action = action
    scorecard.review_date = body.review_date or datetime.now(UTC).replace(tzinfo=None)
    db.commit()
    db.refresh(scorecard)
    return Data(data=FinalizedOut.model_validate(scorecard))
