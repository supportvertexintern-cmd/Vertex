"""Sectors and the documents each country requires, owned by FastAPI since
the reference-data handover (backend plan step 2.2).

They answer as Next.js's /api/admin/sectors and /api/admin/countries/[id]/
document-requirements did, which now pass requests on through
callBackend(): the same roles (tests/test_reference.py fails if the reader
lists drift), rules, messages, status codes and Prisma-shaped JSON. Not
audited, as in Next.js.

Document requirement *types* stay in Next.js until jobs move (step 3): a
job's payment stages create their receipt types there
(server/services/paymentReceiptTypes.ts), and a table has one writer.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError

from app.api.deps import DbSession
from app.core.api import ApiError, Data, UtcDateTime
from app.core.auth import AuthUser
from app.core.rbac import require_role
from app.models.enums import Role
from app.models.identity import Country
from app.models.reference import CountryDocumentRequirement, DocumentRequirementType, Sector

router = APIRouter()

# "Preferred Type of Work" on the Candidate Information Form: every role
# that fills one in or posts jobs.
SECTOR_READERS: tuple[Role, ...] = (
    Role.regional_recruiter,
    Role.country_supervisor,
    Role.inhouse_supervisor,
    Role.director,
    Role.marketing,
    Role.admin,
)
# A destination's extra documents: the same roles, plus the candidate, whose
# own checklist depends on them.
REQUIREMENT_READERS: tuple[Role, ...] = (Role.candidate, *SECTOR_READERS)

AdminUser = Annotated[AuthUser, Depends(require_role(Role.admin))]

UNIQUE_VIOLATION = "23505"
FOREIGN_KEY_VIOLATION = "23503"


def _pgcode(err: IntegrityError) -> str | None:
    return getattr(err.orig, "pgcode", None)


# --- sectors -----------------------------------------------------------------


class SectorOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    created_at: UtcDateTime


class SectorIn(BaseModel):
    name: str = Field(min_length=2, max_length=100)


def _sector_duplicate() -> ApiError:
    return ApiError(409, "duplicate", "A sector with this name already exists.")


@router.get("/sectors")
def list_sectors(db: DbSession, _user: Annotated[AuthUser, Depends(require_role(*SECTOR_READERS))]) -> Data[list[SectorOut]]:
    """Every sector, by name."""
    return Data(data=[SectorOut.model_validate(s) for s in db.scalars(select(Sector).order_by(Sector.name))])


@router.post("/sectors", status_code=status.HTTP_201_CREATED)
def create_sector(body: SectorIn, db: DbSession, _admin: AdminUser) -> Data[SectorOut]:
    if db.scalars(select(Sector.id).where(Sector.name == body.name)).first() is not None:
        raise _sector_duplicate()
    sector = Sector(name=body.name)
    db.add(sector)
    try:
        db.commit()
    except IntegrityError as err:
        db.rollback()
        if _pgcode(err) == UNIQUE_VIOLATION:  # taken by a concurrent request
            raise _sector_duplicate() from None
        raise
    db.refresh(sector)
    return Data(data=SectorOut.model_validate(sector))


@router.delete("/sectors/{sector_id}")
def delete_sector(sector_id: str, db: DbSession, _admin: AdminUser) -> Data[dict[str, str]]:
    """Applications that chose the sector let go of it (SET NULL)."""
    sector = db.get(Sector, sector_id)
    if sector is None:
        raise ApiError(404, "not_found", "Sector not found.")
    db.delete(sector)
    try:
        db.commit()
    except IntegrityError as err:
        db.rollback()
        if _pgcode(err) == FOREIGN_KEY_VIOLATION:
            raise ApiError(409, "in_use", "This sector is still referenced and can't be deleted.") from None
        raise
    return Data(data={"id": sector_id})


# --- a country's document requirements ---------------------------------------


class RequirementOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    country_id: str
    document_type: str
    created_at: UtcDateTime


class RequirementsIn(BaseModel):
    document_types: list[Annotated[str, Field(min_length=1, max_length=60)]]


def _requirements(db: DbSession, country_id: str) -> list[RequirementOut]:
    rows = db.scalars(
        select(CountryDocumentRequirement)
        .where(CountryDocumentRequirement.country_id == country_id)
        .order_by(CountryDocumentRequirement.document_type)
    )
    return [RequirementOut.model_validate(r) for r in rows]


@router.get("/countries/{country_id}/document-requirements")
def list_requirements(
    country_id: str, db: DbSession, _user: Annotated[AuthUser, Depends(require_role(*REQUIREMENT_READERS))]
) -> Data[list[RequirementOut]]:
    """The documents this destination requires beyond the universal set
    (passport, photo, CV): the form's "Required for: X". An unknown country
    has none."""
    return Data(data=_requirements(db, country_id))


@router.put("/countries/{country_id}/document-requirements")
def replace_requirements(country_id: str, body: RequirementsIn, db: DbSession, _admin: AdminUser) -> Data[list[RequirementOut]]:
    """Replaces the country's whole list (the admin ticks a checklist)."""
    if db.get(Country, country_id) is None:
        raise ApiError(404, "not_found", "Country not found.")
    wanted = sorted(set(body.document_types))  # a type ticked twice is still one requirement
    known = set(db.scalars(select(DocumentRequirementType.key).where(DocumentRequirementType.key.in_(wanted))))
    if len(known) != len(wanted):
        raise ApiError(422, "unknown_type", "One or more document types don't exist.")

    db.execute(delete(CountryDocumentRequirement).where(CountryDocumentRequirement.country_id == country_id))
    db.add_all(CountryDocumentRequirement(country_id=country_id, document_type=t) for t in wanted)
    try:
        db.commit()
    except IntegrityError as err:
        db.rollback()
        if _pgcode(err) == FOREIGN_KEY_VIOLATION:  # a type deleted meanwhile
            raise ApiError(422, "unknown_type", "One or more document types don't exist.") from None
        raise
    return Data(data=_requirements(db, country_id))
