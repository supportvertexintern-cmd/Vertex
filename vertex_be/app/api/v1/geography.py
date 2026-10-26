"""Regions and countries (SRS FR-1.4), owned by FastAPI since the
reference-data handover (backend plan step 2.1).

They answer as Next.js's /api/admin/regions and /api/admin/countries did
(vertex/src/app/api/admin/...), which now pass requests on through
callBackend(): the same roles (tests/test_geography.py fails if the reader
lists drift), the same rules and messages as the Zod schemas they replace,
the same status codes and Prisma-shaped JSON. Anyone on staff who works by
region or country reads them; only admin changes them. Every change is on
the audit trail; what Postgres does to other tables when a country goes (SET
NULL, CASCADE) is not.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import selectinload

from app.api.deps import DbSession
from app.core.api import ApiError, Data
from app.core.audit import AuditedDb
from app.core.auth import AuthUser
from app.core.rbac import require_role
from app.models.enums import Role
from app.models.identity import Country, Region

router = APIRouter()

# Dashboard filters and campaign targets: the three-tier hierarchy.
REGION_READERS: tuple[Role, ...] = (
    Role.regional_recruiter,
    Role.country_supervisor,
    Role.inhouse_supervisor,
    Role.director,
    Role.admin,
)
# Assignment dropdowns and the case lists' Country filter: the hierarchy,
# plus the case-management directorates (2026-08-18).
COUNTRY_READERS: tuple[Role, ...] = (
    *REGION_READERS,
    Role.hr,
    Role.operations_team,
    Role.operations_director,
    Role.finance,
)

AdminUser = Annotated[AuthUser, Depends(require_role(Role.admin))]

CUID = r"^c[^\s-]{8,}$"
UNIQUE_VIOLATION = "23505"
FOREIGN_KEY_VIOLATION = "23503"


class RegionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str


class CountryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    region_id: str


class RegionWithCountries(RegionOut):
    countries: list[CountryOut]


class CountryWithRegion(CountryOut):
    region: RegionOut


class RegionIn(BaseModel):
    name: str = Field(min_length=2, max_length=100)


class CountryIn(BaseModel):
    name: str = Field(min_length=2, max_length=100)
    region_id: str = Field(pattern=CUID)


class CountryUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=100)
    region_id: str | None = Field(default=None, pattern=CUID)


def _duplicate(kind: str) -> ApiError:
    return ApiError(409, "duplicate", f"A {kind} with this name already exists.")


def _pgcode(err: IntegrityError) -> str | None:
    return getattr(err.orig, "pgcode", None)


def _commit(db: DbSession, kind: str) -> None:
    """Commits; a name taken by a concurrent request is still a 409."""
    try:
        db.commit()
    except IntegrityError as err:
        db.rollback()
        if _pgcode(err) == UNIQUE_VIOLATION:
            raise _duplicate(kind) from None
        raise


def _region(db: DbSession, region_id: str) -> Region:
    region = db.get(Region, region_id)
    if region is None:
        raise ApiError(404, "not_found", "Region not found.")
    return region


def _name_taken(db: DbSession, model: type[Region] | type[Country], name: str, except_id: str | None = None) -> bool:
    found = db.scalars(select(model.id).where(model.name == name)).first()
    return found is not None and found != except_id


# --- regions -----------------------------------------------------------------


@router.get("/regions")
def list_regions(db: DbSession, _user: Annotated[AuthUser, Depends(require_role(*REGION_READERS))]) -> Data[list[RegionWithCountries]]:
    """Every region with its countries, both by name."""
    regions = db.scalars(select(Region).options(selectinload(Region.countries)).order_by(Region.name)).all()
    return Data(data=[
        RegionWithCountries(id=r.id, name=r.name, countries=sorted((CountryOut.model_validate(c) for c in r.countries), key=lambda c: c.name))
        for r in regions
    ])


@router.post("/regions", status_code=status.HTTP_201_CREATED)
def create_region(body: RegionIn, db: AuditedDb, _admin: AdminUser) -> Data[RegionOut]:
    if _name_taken(db, Region, body.name):
        raise _duplicate("region")
    region = Region(name=body.name)
    db.add(region)
    _commit(db, "region")
    return Data(data=RegionOut.model_validate(region))


@router.patch("/regions/{region_id}")
def rename_region(region_id: str, body: RegionIn, db: AuditedDb, _admin: AdminUser) -> Data[RegionOut]:
    region = _region(db, region_id)
    if _name_taken(db, Region, body.name, except_id=region_id):
        raise _duplicate("region")
    region.name = body.name
    _commit(db, "region")
    return Data(data=RegionOut.model_validate(region))


# --- countries ---------------------------------------------------------------


@router.get("/countries")
def list_countries(db: DbSession, _user: Annotated[AuthUser, Depends(require_role(*COUNTRY_READERS))]) -> Data[list[CountryWithRegion]]:
    """Every country with its region, by name."""
    countries = db.scalars(select(Country).options(selectinload(Country.region)).order_by(Country.name)).all()
    return Data(data=[CountryWithRegion.model_validate(c) for c in countries])


@router.post("/countries", status_code=status.HTTP_201_CREATED)
def create_country(body: CountryIn, db: AuditedDb, _admin: AdminUser) -> Data[CountryOut]:
    _region(db, body.region_id)
    if _name_taken(db, Country, body.name):
        raise _duplicate("country")
    country = Country(name=body.name, region_id=body.region_id)
    db.add(country)
    _commit(db, "country")
    return Data(data=CountryOut.model_validate(country))


@router.patch("/countries/{country_id}")
def update_country(country_id: str, body: CountryUpdate, db: AuditedDb, _admin: AdminUser) -> Data[CountryOut]:
    """Renames a country and/or moves it to another region."""
    country = db.get(Country, country_id)
    if country is None:
        raise ApiError(404, "not_found", "Country not found.")
    if body.region_id is not None:
        _region(db, body.region_id)
        country.region_id = body.region_id
    if body.name is not None:
        if _name_taken(db, Country, body.name, except_id=country_id):
            raise _duplicate("country")
        country.name = body.name
    _commit(db, "country")
    return Data(data=CountryOut.model_validate(country))


@router.delete("/countries/{country_id}")
def delete_country(country_id: str, db: AuditedDb, _admin: AdminUser) -> Data[dict[str, str]]:
    """Candidates, cases, staff assignments and the rest let go of the
    country (SET NULL or CASCADE); anything that still requires it makes
    Postgres refuse, which is a 409."""
    country = db.get(Country, country_id)
    if country is None:
        raise ApiError(404, "not_found", "Country not found.")
    db.delete(country)
    try:
        db.commit()
    except IntegrityError as err:
        db.rollback()
        if _pgcode(err) == FOREIGN_KEY_VIOLATION:
            raise ApiError(409, "in_use", "This country is still referenced and can't be deleted.") from None
        raise
    return Data(data={"id": country_id})
