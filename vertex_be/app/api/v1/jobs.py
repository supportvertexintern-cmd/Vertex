"""Job postings and their payment stages, owned by FastAPI since the jobs
handover (backend plan step 3.2). Marketing creates and maintains every
job; admin keeps override access.

They answer as Next.js's POST /api/jobs and PUT/DELETE /api/jobs/[id] did,
which now pass requests on through callBackend(): the same roles, the rules
of createJobSchema field for field (including the payment-stage checks the
routes added), the same status codes and Prisma-shaped JSON. Reads (the
public listing and detail pages) stay in Next.js.

Differences, all deliberate:

- Editing a job's stages updates them in place, matched by `order`, instead
  of deleting and recreating them. A stage keeps its id, so its Stripe
  Product, its receipt document type and any payments made against it stay
  attached; a stage with payments that is removed is a 409, not a 500.
- Each stage's receipt document type is created in the same transaction as
  the stage, not after the response.
- Stripe pricing is synced by FastAPI (app/services/stripe_pricing.py)
  after the response, and on request through the manual sync below.

Every change is on the audit trail (Job, JobPaymentStage and
DocumentRequirementType are in AUDITED_MODELS).
"""

from __future__ import annotations

import math
from collections.abc import Iterator
from contextlib import contextmanager
from typing import Annotated, Any

from fastapi import APIRouter, BackgroundTasks, Body, Depends, status
from fastapi.exceptions import RequestValidationError
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator
from pydantic_core import PydanticCustomError
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.core.api import ApiError, Data, UtcDateTime
from app.core.audit import AuditedDb
from app.core.auth import AuthUser
from app.core.rbac import require_role
from app.db.session import SessionLocal
from app.models.enums import CaseStage, JobStatus, Role
from app.models.jobs import Job, JobPaymentStage
from app.models.reference import DocumentRequirementType
from app.services.stripe_pricing import (
    PricingClient,
    SessionFactory,
    StripeNotConfigured,
    pricing_client,
    stripe_error_message,
    sync_after_save,
    sync_job_pricing,
)

router = APIRouter()

# Job postings are Marketing's; admin keeps override access.
JOB_MANAGERS: tuple[Role, ...] = (Role.marketing, Role.admin)
JobManager = Annotated[AuthUser, Depends(require_role(*JOB_MANAGERS))]

# Editing any of these leaves Stripe pricing stale, so they trigger a sync.
FEE_RELEVANT_FIELDS = frozenset({"service_fee_gbp", "country", "visa_type", "duration_permit", "payment_stages"})
# Fields whose length minimum older rows may break: an edit carrying one
# unchanged isn't held to it (the edit form always sends the whole job).
MIN_LENGTH_FIELDS = ("title", "country", "city", "job_description", "requirements")

# lib/documentTypes.ts's paymentReceiptTypeKey().
PAYMENT_RECEIPT_TYPE_PREFIX = "payment_receipt_stage_"

FOREIGN_KEY_VIOLATION = "23503"
STAGES_OVER_100 = "Payment stage percentages must not exceed 100"
STAGES_NEEDED = "At least one payment stage is required when a service fee is set"


def session_factory() -> SessionFactory:
    """Where the after-response Stripe sync gets its session (tests swap it)."""
    return SessionLocal


def stripe_client() -> PricingClient | None:
    return pricing_client()


Sessions = Annotated[SessionFactory, Depends(session_factory)]
Stripe = Annotated[PricingClient | None, Depends(stripe_client)]


# --- input and output --------------------------------------------------------


def _min_length(n: int, message: str):
    def check(value: str | None) -> str | None:
        if value is not None and len(value) < n:
            raise PydanticCustomError("string_too_short", message)
        return value

    return check


class PaymentStageIn(BaseModel):
    order: int = Field(gt=0)
    label: str = Field(min_length=1, max_length=100)
    percent: float = Field(gt=0, le=100)
    trigger_stage: CaseStage


class JobUpdate(BaseModel):
    """createJobSchema.partial(): every field optional, none defaulted. The
    columns that can't be null refuse an explicit null; the "nullish" ones
    take it to clear the column."""

    title: str = Field(default=None, min_length=3, max_length=150)  # type: ignore[assignment]
    country: str = Field(default=None, min_length=2, max_length=100)  # type: ignore[assignment]
    city: str = Field(default=None, min_length=2, max_length=100)  # type: ignore[assignment]
    category: str | None = None
    salary_range: str | None = None
    job_description: str = None  # type: ignore[assignment]
    requirements: str = None  # type: ignore[assignment]
    status: JobStatus = None  # type: ignore[assignment]
    employer_client_id: str | None = Field(default=None, min_length=1, max_length=100)
    visa_type: str | None = None
    duration_permit: str | None = None
    processing_time: str | None = None
    service_fee_gbp: float | None = Field(default=None, gt=0)
    visa_success_rates: str | None = None
    is_credit_service: bool = None  # type: ignore[assignment]
    payment_stages: list[PaymentStageIn] | None = None
    partner_only: bool = None  # type: ignore[assignment]

    _description = field_validator("job_description")(_min_length(50, "Job description must be at least 50 characters"))
    _requirements = field_validator("requirements")(_min_length(20, "Requirements must be at least 20 characters"))


class JobCreate(JobUpdate):
    """createJobSchema: the required fields, and its defaults."""

    title: str = Field(min_length=3, max_length=150)
    country: str = Field(min_length=2, max_length=100)
    city: str = Field(min_length=2, max_length=100)
    job_description: str
    requirements: str
    status: JobStatus = JobStatus.active
    is_credit_service: bool = False
    partner_only: bool = False


class JobOut(BaseModel):
    """The Job row, as Prisma returns it."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    title: str
    country: str
    city: str
    category: str | None
    salary_range: str | None
    job_description: str
    requirements: str
    status: JobStatus
    application_fee: float | None
    created_at: UtcDateTime
    updated_at: UtcDateTime
    visa_type: str | None
    duration_permit: str | None
    processing_time: str | None
    service_fee_gbp: float | None
    visa_success_rates: str | None
    tier: str | None
    is_credit_service: bool
    partner_only: bool
    employer_client_id: str | None


class StagePriceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    order: int
    label: str
    stripe_product_id: str | None
    stripe_price_id: str | None
    synced_amount_gbp: float | None


def _invalid(details: dict[str, list[str]]) -> ApiError:
    return ApiError(422, "validation_error", "Validation failed", details)


def _stages_total_ok(stages: list[PaymentStageIn]) -> bool:
    # Math.round(sum) <= 100 (half up, not Python's half to even):
    # financed programmes stage only part of the fee.
    return math.floor(sum(s.percent for s in stages) + 0.5) <= 100


def _job_or_404(db: AuditedDb, job_id: str) -> Job:
    job = db.get(Job, job_id)
    if job is None:
        raise ApiError(404, "not_found", "Job not found.")
    return job


# --- writing stages ----------------------------------------------------------


def _replace_stages(db: AuditedDb, job: Job, wanted: list[PaymentStageIn]) -> None:
    """The job's stages become `wanted`, matched by order: a kept stage is
    updated in place, a new one added, a missing one removed."""
    current = {s.order: s for s in db.scalars(select(JobPaymentStage).where(JobPaymentStage.job_id == job.id))}
    by_order = {s.order: s for s in wanted}
    for order, stage in current.items():
        if order not in by_order:
            db.delete(stage)
    db.flush()  # removals first: (job_id, order) is unique
    for order, s in by_order.items():
        stage = current.get(order)
        if stage is None:
            db.add(JobPaymentStage(job_id=job.id, order=order, label=s.label, percent=s.percent, trigger_stage=s.trigger_stage))
        else:
            stage.label, stage.percent, stage.trigger_stage = s.label, s.percent, s.trigger_stage


def _ensure_receipt_types(db: AuditedDb, job_id: str) -> None:
    """Each stage has a document type to upload its receipt against
    (POST /api/upload checks `type` against the table)."""
    db.flush()
    stages = db.scalars(select(JobPaymentStage).where(JobPaymentStage.job_id == job_id))
    for stage in stages:
        key = f"{PAYMENT_RECEIPT_TYPE_PREFIX}{stage.id}"
        if db.scalars(select(DocumentRequirementType.id).where(DocumentRequirementType.key == key)).first() is None:
            db.add(DocumentRequirementType(key=key, label=f"Payment Receipt — {stage.label}", is_universal=False))


@contextmanager
def _writing(db: AuditedDb) -> Iterator[None]:
    """Commits the block's changes; a reference Postgres refuses (at a flush
    or at the commit) becomes a 409 or a 422 instead of a 500."""
    try:
        yield
        db.commit()
    except IntegrityError as err:
        db.rollback()
        if getattr(err.orig, "pgcode", None) == FOREIGN_KEY_VIOLATION:
            constraint = getattr(getattr(err.orig, "diag", None), "constraint_name", "") or ""
            if constraint.startswith("CasePayment"):
                raise ApiError(409, "in_use", "A payment stage with recorded payments can't be removed.") from None
            if constraint.startswith("Job_employer_client_id"):
                raise _invalid({"employer_client_id": ["Unknown employer client"]}) from None
            raise ApiError(409, "in_use", "This job is still referenced and can't be deleted.") from None
        raise


# --- routes ------------------------------------------------------------------


@router.post("/jobs", status_code=status.HTTP_201_CREATED)
def create_job(body: JobCreate, db: AuditedDb, user: JobManager, tasks: BackgroundTasks, sessions: Sessions, stripe: Stripe) -> Data[JobOut]:
    if body.service_fee_gbp and not body.payment_stages:
        raise _invalid({"payment_stages": [STAGES_NEEDED]})
    if body.payment_stages and not _stages_total_ok(body.payment_stages):
        raise _invalid({"payment_stages": [STAGES_OVER_100]})

    job = Job(**body.model_dump(exclude={"payment_stages"}))
    with _writing(db):
        db.add(job)
        db.flush()
        if body.payment_stages:
            _replace_stages(db, job, body.payment_stages)
            _ensure_receipt_types(db, job.id)
    db.refresh(job)
    tasks.add_task(sync_after_save, sessions, stripe, job.id, user.user_id)
    return Data(data=JobOut.model_validate(job))


@router.put("/jobs/{job_id}")
def update_job(
    job_id: str,
    db: AuditedDb,
    user: JobManager,
    tasks: BackgroundTasks,
    sessions: Sessions,
    stripe: Stripe,
    body: Annotated[Any, Body()] = None,
) -> Data[JobOut]:
    job = _job_or_404(db, job_id)
    if isinstance(body, dict):
        # An unchanged field isn't held to a minimum it may predate.
        body = {k: v for k, v in body.items() if not (k in MIN_LENGTH_FIELDS and isinstance(v, str) and v == getattr(job, k))}
    try:
        data = JobUpdate.model_validate(body)
    except ValidationError as err:
        raise RequestValidationError([{**e, "loc": ("body", *e["loc"])} for e in err.errors()]) from None
    given = data.model_fields_set

    stages = data.payment_stages if "payment_stages" in given else None
    if stages is not None:
        removing_fee = len(stages) == 0 and "service_fee_gbp" in given and data.service_fee_gbp is None
        if not removing_fee and (len(stages) == 0 or not _stages_total_ok(stages)):
            raise _invalid({"payment_stages": [STAGES_OVER_100]})

    with _writing(db):
        for field in given - {"payment_stages"}:
            setattr(job, field, getattr(data, field))
        if stages is not None:
            _replace_stages(db, job, stages)
            _ensure_receipt_types(db, job.id)
    db.refresh(job)
    if given & FEE_RELEVANT_FIELDS:
        tasks.add_task(sync_after_save, sessions, stripe, job.id, user.user_id)
    return Data(data=JobOut.model_validate(job))


@router.delete("/jobs/{job_id}")
def delete_job(job_id: str, db: AuditedDb, _user: JobManager) -> Data[dict[str, str]]:
    """Its stages go with it; applications and payments for it are removed
    by Postgres (CASCADE). A job a partner submission or a recorded payment
    still points to is a 409."""
    job = _job_or_404(db, job_id)
    with _writing(db):
        db.delete(job)
    return Data(data={"id": job_id})


@router.post("/jobs/{job_id}/stripe-pricing/sync")
def sync_stripe_pricing(job_id: str, db: AuditedDb, _user: JobManager, stripe: Stripe) -> Data[list[StagePriceOut]]:
    """The manual retry for a sync that failed (e.g. Stripe was down):
    runs now and reports the outcome."""
    _job_or_404(db, job_id)
    try:
        if stripe is None:
            raise StripeNotConfigured
        stages = sync_job_pricing(db, job_id, stripe)
    except StripeNotConfigured:
        raise ApiError(503, "stripe_not_configured", "Stripe isn't configured on the server.") from None
    except Exception as err:  # noqa: BLE001  (a Stripe or network error)
        db.rollback()
        raise ApiError(502, "stripe_sync_failed", stripe_error_message(err)) from None
    return Data(data=[StagePriceOut.model_validate(s) for s in stages])
