"""Reference data: regions, countries, sectors, document requirements and the
work-permit programmes (the website's prisma/seed.ts until reads handover R8;
reference_data.json is its data, evaluated). Safe to re-run.

    DATABASE_URL=... python -m scripts.seed.reference     (from vertex_be/)

A programme's Stripe prices aren't synced here: the seed's only callers run
without a Stripe key. scripts/sync_stripe_pricing.py does that on a stack with one.
"""

from __future__ import annotations

import json
from datetime import timedelta

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from scripts.seed.common import HERE, first, purge, run, upsert

from app.core.clock import utc_now_ms  # noqa: E402  (after common sets the path)
from app.models.enums import JobStatus  # noqa: E402
from app.models.identity import Country, Region  # noqa: E402
from app.models.jobs import Job, JobPaymentStage, JobPosition, JobSector  # noqa: E402
from app.models.reference import CountryDocumentRequirement, DocumentRequirementType, Sector  # noqa: E402
from app.services.documents import PAYMENT_RECEIPT_TYPE_PREFIX  # noqa: E402

DATA = json.loads((HERE / "reference_data.json").read_text(encoding="utf-8"))
DEFAULT_POSITION_TITLE = "General Position"

STANDARD_STAGES = [
    (1, "Documentation", 25, "registration_document_submission"),
    (2, "Work Permit", 25, "permit_authorization_approved"),
    (3, "Visa", 50, "visa_interview_decision"),
]
TWO_STAGES = [
    (1, "Documentation", 50, "registration_document_submission"),
    (2, "Visa", 50, "visa_interview_decision"),
]
# From the Candidate Information Form's Section 3 checklist ("Required for: X"):
# passport copy, photos and CV are universal, so only the extras are here.
DOCUMENT_REQUIREMENTS = {
    "Poland": ["all_passport_pages"],
    "Belarus": ["national_id", "professional_training_certificate", "e_apostille"],
    "Italy": ["cv_europass"],
    "Hungary": ["cv_europass"],
    "Romania": ["cv_europass"],
    "Greece": ["cv_europass"],
    "Netherlands": ["cv_europass"],
    "Croatia": ["cv_europass"],
    "Serbia": ["education_diploma"],
    "Bulgaria": ["police_clearance"],
    "Slovakia": ["driving_licence", "tachograph_card"],
    "Germany": ["zab_recognition_letter"],
}
# Gone from the 2026 Price List: deleted rather than left inactive.
RETIRED_JOBS = [
    "Czech Republic — 3-Month Seasonal Work Permit",
    "Czech Republic — 6-Month Seasonal Work Permit",
    "Czech Republic — 9-Month Seasonal Work Permit",
]
JOB_FIELDS = ("country", "category", "tier", "salary_range", "job_description", "requirements", "visa_type", "duration_permit",
              "processing_time", "service_fee_gbp", "visa_success_rates")
CREDIT_FIELDS = ("country", "city", "category", "salary_range", "job_description", "requirements", "visa_type", "duration_permit",
                 "processing_time", "service_fee_gbp")


def credit_stages(financing_percent: float, installments: int) -> list[tuple[int, str, float, str]]:
    each = financing_percent / installments
    return [(1, "Upfront", 100 - financing_percent, "registration_document_submission")] + [
        (i + 2, f"Installment {i + 1} of {installments}", each, "departure_arrival_support") for i in range(installments)
    ]


def _ensure_stages(db: Session, job_id: str, stages: list[tuple[int, str, float, str]]) -> None:
    """Only on a job with none, so a reseed never clobbers what an admin edited."""
    if db.scalar(select(func.count()).select_from(JobPaymentStage).where(JobPaymentStage.job_id == job_id)):
        return
    for order, label, percent, trigger in stages:
        db.add(JobPaymentStage(job_id=job_id, order=order, label=label, percent=percent, trigger_stage=trigger))
    db.flush()
    for stage in db.scalars(select(JobPaymentStage).where(JobPaymentStage.job_id == job_id)):
        upsert(db, DocumentRequirementType, {"key": f"{PAYMENT_RECEIPT_TYPE_PREFIX}{stage.id}"}, create={
            "label": f"Payment Receipt — {stage.label}", "is_universal": False,
        })


def _default_position(db: Session, job_id: str, category: str) -> None:
    sector = upsert(db, JobSector, {"job_id": job_id, "sector": category})
    upsert(db, JobPosition, {"job_sector_id": sector.id, "title": DEFAULT_POSITION_TITLE})


def _position_catalog(db: Session) -> None:
    """The real positions from "Positions by Country & Sector" (Edition 2026),
    replacing the default position wherever a programme has them."""
    for title, sectors in DATA["PDF_POSITIONS_BY_JOB_TITLE"].items():
        job = first(db, Job, title=title)
        if job is None:
            continue
        for entry in sectors:
            sector = upsert(db, JobSector, {"job_id": job.id, "sector": entry["sector"]})
            for position in entry["positions"]:
                upsert(db, JobPosition, {"job_sector_id": sector.id, "title": position["title"], "city": position.get("city")})
            purge(db, delete(JobPosition).where(JobPosition.job_sector_id == sector.id, JobPosition.title == DEFAULT_POSITION_TITLE))
        named = {entry["sector"] for entry in sectors}
        for sector in db.scalars(select(JobSector).where(JobSector.job_id == job.id, JobSector.sector.not_in(named))).all():
            titles = db.scalars(select(JobPosition.title).where(JobPosition.job_sector_id == sector.id)).all()
            if all(t == DEFAULT_POSITION_TITLE for t in titles):
                db.delete(sector)
    db.flush()


def _canada_fixup(db: Session) -> None:
    """Production-only programmes, not in JOBS: a no-op where they don't exist."""
    for title in DATA["CANADA_JOB_TITLES"]:
        job = first(db, Job, title=title)
        if job is None:
            continue
        if job.service_fee_gbp is None:
            job.service_fee_gbp = 3100
        _ensure_stages(db, job.id, TWO_STAGES)


def seed(db: Session) -> None:
    for t in DATA["DOCUMENT_REQUIREMENT_TYPES"]:
        upsert(db, DocumentRequirementType, {"key": t["key"]}, {
            "label": t["label"], "is_universal": t.get("is_universal", False), "sort_order": t["sort_order"],
        })
    for region_name, countries in DATA["REGIONS"].items():
        region = upsert(db, Region, {"name": region_name})
        for country in countries:
            upsert(db, Country, {"name": country}, {"region_id": region.id})
    for name in DATA["SECTORS"]:
        upsert(db, Sector, {"name": name})
    for country_name, document_types in DOCUMENT_REQUIREMENTS.items():
        country = first(db, Country, name=country_name)
        if country is None:
            continue
        for document_type in document_types:
            upsert(db, CountryDocumentRequirement, {"country_id": country.id, "document_type": document_type})

    purge(db, delete(Job).where(Job.title.in_(RETIRED_JOBS)))

    # One transaction would give every job the same time, and the lists sort
    # by it: each gets its own, in the order they're listed here.
    now = utc_now_ms()
    created_at = lambda i: now + timedelta(milliseconds=i)  # noqa: E731

    for i, j in enumerate(DATA["JOBS"]):
        job = upsert(db, Job, {"title": j["title"]}, {f: j[f] for f in JOB_FIELDS if f in j}, {
            "city": "Nationwide", "status": JobStatus.active, "application_fee": 0, "created_at": created_at(i),
        })
        _ensure_stages(db, job.id, STANDARD_STAGES)
        _default_position(db, job.id, j["category"])
    for i, j in enumerate(DATA["CREDIT_SERVICE_JOBS"], start=len(DATA["JOBS"])):
        fields = {f: j[f] for f in CREDIT_FIELDS if f in j} | {"status": JobStatus.active, "is_credit_service": True, "partner_only": True}
        job = upsert(db, Job, {"title": j["title"]}, fields, {"application_fee": 0, "created_at": created_at(i)})
        _ensure_stages(db, job.id, credit_stages(j["financing_percent"], j["installment_count"]))
        _default_position(db, job.id, j["category"])

    _position_catalog(db)
    _canada_fixup(db)
    db.flush()


if __name__ == "__main__":
    run(seed)
    print("Seed complete: regions, countries, sectors, document requirements, and work-permit programmes.")
