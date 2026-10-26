"""Sectors and the documents each country requires, owned by FastAPI since
the reference-data handover (backend plan step 2.2).

They answer as Next.js's /api/admin/sectors and /api/admin/countries/[id]/
document-requirements did, which now pass requests on through
callBackend(): the same roles (tests/test_reference.py fails if the reader
lists drift), rules, messages, status codes and Prisma-shaped JSON. Every
change is on the audit trail.

Document requirement types are FastAPI's too since the jobs handover (step
3.2): the admin adds and removes them here, and a job's payment stages get
their receipt types in app/api/v1/jobs.py. Their list (GET) stays in
Next.js's /api/admin/document-types.
"""

from __future__ import annotations

import re
from typing import Annotated

from fastapi import APIRouter, Depends, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from app.api.deps import DbSession
from app.core.api import ApiError, Data, UtcDateTime
from app.core.audit import AuditedDb
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
def create_sector(body: SectorIn, db: AuditedDb, _admin: AdminUser) -> Data[SectorOut]:
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
def delete_sector(sector_id: str, db: AuditedDb, _admin: AdminUser) -> Data[dict[str, str]]:
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
def replace_requirements(country_id: str, body: RequirementsIn, db: AuditedDb, _admin: AdminUser) -> Data[list[RequirementOut]]:
    """Replaces the country's whole list (the admin ticks a checklist)."""
    if db.get(Country, country_id) is None:
        raise ApiError(404, "not_found", "Country not found.")
    wanted = sorted(set(body.document_types))  # a type ticked twice is still one requirement
    known = set(db.scalars(select(DocumentRequirementType.key).where(DocumentRequirementType.key.in_(wanted))))
    if len(known) != len(wanted):
        raise ApiError(422, "unknown_type", "One or more document types don't exist.")

    # Only what changed, through the ORM, so the trail shows each type
    # ticked or unticked rather than the whole list rewritten.
    current = {r.document_type: r for r in db.scalars(select(CountryDocumentRequirement).where(CountryDocumentRequirement.country_id == country_id))}
    for doc_type, row in current.items():
        if doc_type not in known:
            db.delete(row)
    db.add_all(CountryDocumentRequirement(country_id=country_id, document_type=t) for t in wanted if t not in current)
    try:
        db.commit()
    except IntegrityError as err:
        db.rollback()
        if _pgcode(err) == FOREIGN_KEY_VIOLATION:  # a type deleted meanwhile
            raise ApiError(422, "unknown_type", "One or more document types don't exist.") from None
        raise
    return Data(data=_requirements(db, country_id))


# --- document requirement types (step 3.2) ------------------------------------


class DocumentTypeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    key: str
    label: str
    is_universal: bool
    sort_order: int
    created_at: UtcDateTime


class DocumentTypeIn(BaseModel):
    label: str = Field(min_length=2, max_length=150)


def _slug(label: str) -> str:
    # The website's slugify(): the key stored on Document.type and friends.
    return re.sub(r"[^a-z0-9]+", "_", label.strip().lower()).strip("_")


@router.post("/document-types", status_code=status.HTTP_201_CREATED)
def create_document_type(body: DocumentTypeIn, db: AuditedDb, _admin: AdminUser) -> Data[DocumentTypeOut]:
    """A new type from just a label; its key is the label, slugified."""
    key = _slug(body.label)
    if not key:
        raise ApiError(422, "validation_error", "Label must contain at least one letter or number.")
    duplicate = ApiError(409, "duplicate", "A document type with this name already exists.")
    if db.scalars(select(DocumentRequirementType.id).where(DocumentRequirementType.key == key)).first() is not None:
        raise duplicate
    last = db.scalars(select(func.max(DocumentRequirementType.sort_order))).first() or 0
    doc_type = DocumentRequirementType(key=key, label=body.label, sort_order=last + 1)
    db.add(doc_type)
    try:
        db.commit()
    except IntegrityError as err:
        db.rollback()
        if _pgcode(err) == UNIQUE_VIOLATION:  # taken by a concurrent request
            raise duplicate from None
        raise
    db.refresh(doc_type)
    return Data(data=DocumentTypeOut.model_validate(doc_type))


@router.delete("/document-types/{type_id}")
def delete_document_type(type_id: str, db: AuditedDb, _admin: AdminUser) -> Data[dict[str, str]]:
    """Refused while an uploaded document uses the type. Countries that
    required it stop requiring it, each removal on the audit trail."""
    doc_type = db.get(DocumentRequirementType, type_id)
    if doc_type is None:
        raise ApiError(404, "not_found", "Document type not found.")
    for requirement in db.scalars(select(CountryDocumentRequirement).where(CountryDocumentRequirement.document_type == doc_type.key)):
        db.delete(requirement)
    db.delete(doc_type)
    try:
        db.commit()
    except IntegrityError as err:
        db.rollback()
        if _pgcode(err) == FOREIGN_KEY_VIOLATION:
            raise ApiError(409, "in_use", "This document type is still referenced by an uploaded document and can't be deleted.") from None
        raise
    return Data(data={"id": type_id})
