"""Which documents a candidate must upload, and whether they have: a port of
vertex/src/server/services/documentCompleteness.ts for the pipeline
handover (steps 6.2 and 6.3).

A candidate needs the universal document types (DocumentRequirementType.
is_universal) plus each destination country's extras
(CountryDocumentRequirement), across every application that isn't
rejected. A job-linked application has no preferred country: its
destination is the Country named like Job.country, ignoring case.
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass

from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.models.candidate import Application, Document
from app.models.enums import ApplicationStatus
from app.models.identity import Country
from app.models.reference import CountryDocumentRequirement, DocumentRequirementType


@dataclass(frozen=True)
class Completeness:
    complete: bool
    missing_types: list[str]


def required_types_by_country(db: Session, country_ids: Iterable[str | None]) -> dict[str | None, list[str]]:
    """getRequiredDocumentTypesForCountryIds: the required type keys per
    country, in two queries; None maps to the universal set alone."""
    ids = list(dict.fromkeys(i for i in country_ids if i))
    universal = list(db.scalars(select(DocumentRequirementType.key).where(DocumentRequirementType.is_universal.is_(True))))
    extras: dict[str, list[str]] = {}
    if ids:
        rows = db.execute(
            select(CountryDocumentRequirement.country_id, CountryDocumentRequirement.document_type).where(
                CountryDocumentRequirement.country_id.in_(ids)
            )
        )
        for country_id, document_type in rows:
            extras.setdefault(country_id, []).append(document_type)

    result: dict[str | None, list[str]] = {None: universal}
    for country_id in ids:
        result[country_id] = list(dict.fromkeys([*universal, *extras.get(country_id, [])]))
    return result


def document_completeness(db: Session, candidate_id: str) -> Completeness:
    """evaluateDocumentCompletenessForCandidateId."""
    uploaded = set(db.scalars(select(Document.type).where(Document.candidate_id == candidate_id)))
    applications = list(
        db.scalars(
            select(Application)
            .where(Application.candidate_id == candidate_id, Application.application_status != ApplicationStatus.rejected)
            .options(selectinload(Application.job))
        )
    )

    job_country_names = {a.job.country.lower() for a in applications if not a.preferred_country_1_id and a.job}
    country_id_by_name: dict[str, str] = {}
    if job_country_names:
        for country_id, name in db.execute(select(Country.id, Country.name).where(func.lower(Country.name).in_(job_country_names))):
            country_id_by_name[name.lower()] = country_id

    def destination(a: Application) -> str | None:
        if a.preferred_country_1_id:
            return a.preferred_country_1_id
        return country_id_by_name.get(a.job.country.lower()) if a.job else None

    required = required_types_by_country(db, [destination(a) for a in applications])
    needed = list(dict.fromkeys(t for types in required.values() for t in types))
    missing = [t for t in needed if t not in uploaded]
    return Completeness(complete=not missing, missing_types=missing)


# vertex/src/lib/documentTypes.ts (tests fail if they drift): types never
# self-reported on the application forms, so never required by them. Each
# has its own upload (the screening-gate CV, issued permits, receipts).
NON_PROGRAMME_TYPE_KEYS: frozenset[str] = frozenset(
    {"cv", "transcript", "certificate", "medical", "contract", "visa", "other", "issued_work_permit", "issued_visa"}
)
PAYMENT_RECEIPT_TYPE_PREFIX = "payment_receipt_stage_"
LEGACY_PAYMENT_RECEIPT_KEYS: frozenset[str] = frozenset(
    {"payment_receipt_documentation", "payment_receipt_permit", "payment_receipt_visa", "payment_receipt_upfront"}
)


def is_payment_receipt_type(key: str) -> bool:
    return key == "payment_receipt" or key.startswith(PAYMENT_RECEIPT_TYPE_PREFIX) or key in LEGACY_PAYMENT_RECEIPT_KEYS


def is_non_programme_type(key: str) -> bool:
    return key in NON_PROGRAMME_TYPE_KEYS or is_payment_receipt_type(key)
