"""Campaigns and their targets (SRS FR-3.3), owned by FastAPI since the
recruitment-operations handover (backend plan step 5.1).

They answer as Next.js's /api/campaigns routes did, which now pass requests
on through callBackend(): the same roles (tests fail if the lists drift),
the rules of create/updateCampaignSchema and createCampaignTargetSchema,
the same scoping, messages, status codes and Prisma-shaped JSON.

In-House Supervisors create campaigns for their own countries, which
Country Supervisors then draw on for their recruiters' targets. An In-House
Supervisor edits and deletes only campaigns they created, and sets or
removes targets only for their own assigned countries; director and admin
reach every campaign, country and region.

Every change is on the audit trail (Campaign and CampaignTarget are in
AUDITED_MODELS; the website didn't audit targets). Two deliberate
differences: an edit that leaves the end date on or before the start date
is a 422 (only creation checked it), and a date that isn't one is a 422,
not a 500.
"""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query, status
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import and_, or_, select
from sqlalchemy.orm import selectinload

from app.api.deps import DbSession
from app.core.api import ApiError, Data, UtcDateTime, js_date
from app.core.audit import AuditedDb
from app.core.auth import AuthUser
from app.core.rbac import require_role
from app.models.campaign import Campaign, CampaignTarget
from app.models.enums import CampaignMetric, CampaignStatus, Role
from app.models.identity import Country, InhouseCountryAssignment, User

router = APIRouter()

# Every staff role sees campaigns: a recruiter needs the targets that apply
# to their work.
CAMPAIGN_READERS: tuple[Role, ...] = (
    Role.regional_recruiter,
    Role.country_supervisor,
    Role.inhouse_supervisor,
    Role.director,
    Role.admin,
)
CAMPAIGN_MANAGERS: tuple[Role, ...] = (Role.inhouse_supervisor, Role.director, Role.admin)
# Reach every campaign, country and region, not just their own.
CROSS_SCOPE_ROLES = frozenset({Role.director, Role.admin})

Reader = Annotated[AuthUser, Depends(require_role(*CAMPAIGN_READERS))]
Manager = Annotated[AuthUser, Depends(require_role(*CAMPAIGN_MANAGERS))]

CUID = r"^c[^\s-]{8,}$"  # zod's .cuid()


# --- shapes ------------------------------------------------------------------


class Named(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str


class Creator(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    full_name: str


class TargetOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    metric: CampaignMetric
    target_value: float
    country: Named | None
    region: Named | None


class CampaignSummary(BaseModel):
    """What a create or an edit answers with."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    status: CampaignStatus
    start_date: UtcDateTime
    end_date: UtcDateTime


class CampaignListItem(CampaignSummary):
    creator: Creator
    targets: list[TargetOut]


class CampaignDetail(CampaignListItem):
    criteria: dict[str, Any]


class CampaignCreate(BaseModel):
    name: str = Field(min_length=3, max_length=150)
    criteria: dict[str, Any] = Field(default_factory=dict)
    start_date: datetime
    end_date: datetime  # a campaign has a bounded timeline (FR-3.3)

    _dates = field_validator("start_date", "end_date", mode="before")(lambda v: js_date(v) if isinstance(v, str) else v)


class CampaignUpdate(BaseModel):
    name: str = Field(default=None, min_length=3, max_length=150)  # type: ignore[assignment]
    criteria: dict[str, Any] = None  # type: ignore[assignment]
    status: CampaignStatus = None  # type: ignore[assignment]
    # An empty string leaves the date alone, as the website's edit did.
    start_date: datetime | None = None
    end_date: datetime | None = None

    _dates = field_validator("start_date", "end_date", mode="before")(lambda v: (js_date(v) if v else None) if isinstance(v, str) else v)


class TargetCreate(BaseModel):
    metric: CampaignMetric
    country_id: str | None = Field(default=None, pattern=CUID)
    region_id: str | None = Field(default=None, pattern=CUID)
    target_value: float = Field(gt=0)


def _invalid(details: dict[str, list[str]]) -> ApiError:
    return ApiError(422, "validation_error", "Validation failed", details)


def _forbidden(message: str) -> ApiError:
    return ApiError(403, "forbidden", message)


def _campaign_or_404(db: DbSession, campaign_id: str) -> Campaign:
    campaign = db.get(Campaign, campaign_id)
    if campaign is None:
        raise ApiError(404, "not_found", "Campaign not found.")
    return campaign


def _inhouse_country_ids(db: DbSession, user_id: str) -> list[str]:
    return list(db.scalars(select(InhouseCountryAssignment.country_id).where(InhouseCountryAssignment.inhouse_supervisor_id == user_id)))


def _with_relations():
    return (
        selectinload(Campaign.creator),
        selectinload(Campaign.targets).selectinload(CampaignTarget.country),
        selectinload(Campaign.targets).selectinload(CampaignTarget.region),
    )


# --- campaigns ---------------------------------------------------------------


@router.get("/campaigns")
def list_campaigns(
    db: DbSession,
    user: Reader,
    campaign_status: Annotated[CampaignStatus | None, Query(alias="status")] = None,
    scope: Annotated[str | None, Query()] = None,
) -> Data[list[CampaignListItem]]:
    """Newest first. ?scope=mine keeps the campaigns with a target for the
    caller's own country, its region, or the whole campaign: the reporting
    cycle's "Campaign" picker (Supervisory Reporting Framework §3.1)."""
    query = select(Campaign).options(*_with_relations()).order_by(Campaign.created_at.desc())
    if campaign_status is not None:
        query = query.where(Campaign.status == campaign_status)
    if scope == "mine":
        me = db.get(User, user.user_id)
        country_id = me.assigned_country_id if me else None
        region_id = db.scalar(select(Country.region_id).where(Country.id == country_id)) if country_id else None
        # As Prisma's { country_id: null } matched IS NULL, an unassigned
        # caller matches every target missing a country or a region.
        same_country = CampaignTarget.country_id == country_id if country_id else CampaignTarget.country_id.is_(None)
        same_region = CampaignTarget.region_id == region_id if region_id else CampaignTarget.region_id.is_(None)
        campaign_wide = and_(CampaignTarget.country_id.is_(None), CampaignTarget.region_id.is_(None))
        query = query.where(Campaign.targets.any(or_(same_country, same_region, campaign_wide)))
    return Data(data=[CampaignListItem.model_validate(c) for c in db.scalars(query)])


@router.get("/campaigns/{campaign_id}")
def get_campaign(campaign_id: str, db: DbSession, _user: Reader) -> Data[CampaignDetail]:
    campaign = db.scalars(select(Campaign).options(*_with_relations()).where(Campaign.id == campaign_id)).first()
    if campaign is None:
        raise ApiError(404, "not_found", "Campaign not found.")
    return Data(data=CampaignDetail.model_validate(campaign))


@router.post("/campaigns", status_code=status.HTTP_201_CREATED)
def create_campaign(body: CampaignCreate, db: AuditedDb, user: Manager) -> Data[CampaignSummary]:
    if body.end_date <= body.start_date:
        raise _invalid({"end_date": ["End date must be after the start date."]})
    campaign = Campaign(**body.model_dump(), created_by=user.user_id)
    db.add(campaign)
    db.commit()
    db.refresh(campaign)
    return Data(data=CampaignSummary.model_validate(campaign))


def _owned(db: AuditedDb, campaign_id: str, user: AuthUser, verb: str) -> Campaign:
    campaign = _campaign_or_404(db, campaign_id)
    if user.role not in CROSS_SCOPE_ROLES and campaign.created_by != user.user_id:
        raise _forbidden(f"You can only {verb} campaigns you created.")
    return campaign


@router.patch("/campaigns/{campaign_id}")
def update_campaign(campaign_id: str, body: CampaignUpdate, db: AuditedDb, user: Manager) -> Data[CampaignSummary]:
    campaign = _owned(db, campaign_id, user, "edit")
    given = body.model_fields_set
    start = body.start_date or campaign.start_date
    end = body.end_date or campaign.end_date
    if end <= start:
        raise _invalid({"end_date": ["End date must be after the start date."]})
    for field in given:
        value = getattr(body, field)
        if value is not None:  # an empty date
            setattr(campaign, field, value)
    db.commit()
    db.refresh(campaign)
    return Data(data=CampaignSummary.model_validate(campaign))


@router.delete("/campaigns/{campaign_id}")
def delete_campaign(campaign_id: str, db: AuditedDb, user: Manager) -> Data[dict[str, str]]:
    """Its targets, and the recruiter allocations drawn from them, go with it."""
    db.delete(_owned(db, campaign_id, user, "delete"))
    db.commit()
    return Data(data={"id": campaign_id})


# --- targets -----------------------------------------------------------------


@router.post("/campaigns/{campaign_id}/targets", status_code=status.HTTP_201_CREATED)
def add_target(campaign_id: str, body: TargetCreate, db: AuditedDb, user: Manager) -> Data[TargetOut]:
    """Cascades a numeric target to a country, a region, or the whole
    campaign (FR-3.3)."""
    _campaign_or_404(db, campaign_id)
    if body.country_id and body.region_id:
        message = "A target can be scoped to a country or a region, not both."
        raise _invalid({"country_id": [message], "region_id": [message]})

    country_id, region_id = body.country_id, body.region_id
    if user.role not in CROSS_SCOPE_ROLES:
        countries = _inhouse_country_ids(db, user.user_id)
        if not countries:
            raise ApiError(422, "no_country", "You must be assigned a country first.")
        if region_id or (country_id and country_id not in countries):
            raise _forbidden("You can only set targets for one of your own assigned countries.")
        # One assigned country: it's the default. Several: the caller says which.
        country_id = country_id or (countries[0] if len(countries) == 1 else None)
        if not country_id:
            raise ApiError(422, "validation_error", "Specify which of your assigned countries this target is for.")

    target = CampaignTarget(campaign_id=campaign_id, metric=body.metric, country_id=country_id, region_id=region_id, target_value=body.target_value)
    db.add(target)
    db.commit()
    db.refresh(target)
    return Data(data=TargetOut.model_validate(target))


@router.delete("/campaigns/{campaign_id}/targets/{target_id}")
def remove_target(campaign_id: str, target_id: str, db: AuditedDb, user: Manager) -> Data[dict[str, str]]:
    target = db.get(CampaignTarget, target_id)
    if target is None or target.campaign_id != campaign_id:
        raise ApiError(404, "not_found", "Target not found.")
    if user.role is Role.inhouse_supervisor and (not target.country_id or target.country_id not in _inhouse_country_ids(db, user.user_id)):
        raise _forbidden("You can only remove targets for one of your own assigned countries.")
    db.delete(target)
    db.commit()
    return Data(data={"id": target_id})
