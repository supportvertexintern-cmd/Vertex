"""Application writes for the pipeline handover, step 6.4
(docs/architecture/pipeline-handover.md): submitting the Candidate
Information Form (a candidate, a walk-in lead entered by staff, or an
anonymous self-applicant), the reviewer's status and notes, and staff
corrections to the programme and travel answers. Referral commissions and
the duplicate-referral flag come with submission.

Built ahead of the switch (D3 B): every route answers 503 until
PIPELINE_WRITES_ENABLED is set at step 6.7, when Next.js's POST
/api/applications, PUT /api/applications/[id] and PATCH
/api/candidates/[id]/application start passing requests on.

They answer as those routes do: the same roles (tests fail if the lists
drift), access rules, checks, messages and status codes. Reviewers see
every application, as today (Q3, owner's decision D4).

Submission is a service route: an anonymous self-applicant has no session,
so Next.js calls it as itself, with the user's session when there is one.
Next.js keeps rate-limiting anonymous submissions and signs the form's
upload token when `screening_passed` says so (FastAPI issues no tokens).
The emails go back in `notify` (D1).

Every change is on the audit trail (Candidate, Application,
PartnerCandidate and ReferralCommission are in AUDITED_MODELS).
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, status
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from sqlalchemy import func, select

from app.api.deps import DbSession
from app.api.notices import ApplicationConfirmationEmail, ApplicationStatusEmail, Notice, Notifying, commission_email, invite_email
from app.api.v1.candidates import DETAIL_EDITORS, MaritalStatus, _blank_is_missing, _date
from app.core.api import ApiError, Data, Email, UtcDateTime, js_date
from app.core.audit import AuditedDb, set_audit_actor
from app.core.auth import AuthUser, OptionalUser, calling_service
from app.core.pipeline import PipelineWrites
from app.core.rbac import STAFF_ROLES, require_role
from app.core.scope import CandidateRef, can_access_candidate
from app.models.candidate import Application, Candidate
from app.models.enums import (
    ApplicationStatus,
    CandidateLifecycleStatus,
    CandidateSource,
    ContactChannel,
    Gender,
    JobStatus,
    PaymentStatus,
    ReferralAgentStatus,
    ReferralMilestone,
    Role,
)
from app.models.identity import Country
from app.models.jobs import Job, JobPosition, JobSector
from app.models.partners import PartnerCandidate
from app.models.payments import Payment
from app.models.referral import ReferralAgent
from app.services.referrals import commission_if_due, flag_if_duplicate
from app.services.screening import screen_and_invite

router = APIRouter()

# "Approved by In-House" is the controlling position; admin keeps override.
REVIEWERS: tuple[Role, ...] = (Role.inhouse_supervisor, Role.director, Role.admin)
CUID = r"^c[^\s-]{8,}$"  # zod's .cuid()
FALLBACK_JOB_TITLE = "your Vertex programme"


def _now() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


Blank = _blank_is_missing


# --- input -------------------------------------------------------------------


class SubmissionIn(BaseModel):
    """submitApplicationSchema: the Candidate Information Form."""

    # Section 1: programme selection.
    job_id: str = Field(pattern=CUID)
    job_position_id: str | None = Field(None, pattern=CUID)
    cover_letter: str | None = None
    # Staff submitting for a candidate already on file.
    candidate_id: str | None = Field(None, pattern=CUID)
    # From ?ref= on /apply; checked against real agents in the route.
    referral_code: str | None = Field(None, max_length=30)

    # Section 2: required when there's no candidate_id (see below).
    full_name: str | None = Field(None, min_length=2, max_length=100)
    nationality: str | None = Field(None, min_length=2, max_length=100)
    date_of_birth: datetime | None = None
    passport_number: str | None = None
    passport_expiry: datetime | None = None
    second_nationality: str | None = Field(None, max_length=100)
    gender: Gender | None = None
    current_occupation: str | None = Field(None, max_length=150)
    highest_education: str | None = Field(None, max_length=150)
    home_address: str | None = Field(None, max_length=500)
    phone: str | None = None
    whatsapp_number: str | None = Field(None, max_length=30)
    email: Email | None = None
    marital_status: MaritalStatus | None = None
    consent_given: bool | None = None

    earliest_travel_date: datetime
    prior_eu_visa_applied: bool | None = None
    prior_eu_visa_applied_details: str | None = Field(None, max_length=500)
    # Section 3: what the candidate says they can provide, not the files.
    documents_available: list[Annotated[str, Field(min_length=1, max_length=60)]] = []
    # Section 5: a free choice of world country, resolved by name.
    current_location_country_name: str = Field(min_length=1)
    holds_schengen_visa: bool | None = None
    holds_schengen_visa_details: str | None = Field(None, max_length=500)
    prior_visa_refusals: bool | None = None
    prior_visa_refusals_details: str | None = Field(None, max_length=500)
    available_for_embassy_appointment: bool = False
    willing_to_start_within_30_days: bool = False
    preferred_contact_channel: ContactChannel
    # Section 4: must be ticked.
    payment_plan_acknowledged: Literal[True]

    _blanks = field_validator("gender", "email", "marital_status", mode="before")(Blank)
    _dates = field_validator("date_of_birth", "passport_expiry", mode="before")(_date)

    @field_validator("earliest_travel_date", mode="before")
    @classmethod
    def _travel_date(cls, value: Any) -> Any:
        if value == "":
            raise ValueError("Earliest possible travel date is required")
        return js_date(value) if isinstance(value, str) else value

    def section_2_missing(self) -> dict[str, list[str]]:
        """The superRefine: Section 2 is required unless staff name an
        existing candidate."""
        if self.candidate_id:
            return {}
        required = {
            "full_name": (self.full_name, "Full name is required"),
            "nationality": (self.nationality, "Nationality is required"),
            "date_of_birth": (self.date_of_birth, "Date of birth is required"),
            "passport_number": (self.passport_number, "Passport number is required"),
            "passport_expiry": (self.passport_expiry, "Passport expiry date is required"),
            "gender": (self.gender, "Gender is required"),
            "phone": (self.phone, "Phone number is required"),
            "email": (self.email, "A valid email is required"),
        }
        missing = {name: [message] for name, (value, message) in required.items() if not value}
        if self.consent_given is not True:
            missing["consent_given"] = ["You must confirm the candidate declaration to submit."]
        return missing

    def section_2(self) -> dict[str, Any]:
        return {
            "full_name": self.full_name,
            "nationality": self.nationality,
            "date_of_birth": self.date_of_birth,
            "passport_number": self.passport_number,
            "passport_expiry": self.passport_expiry,
            "second_nationality": self.second_nationality,
            "gender": self.gender,
            "current_occupation": self.current_occupation,
            "highest_education": self.highest_education,
            "home_address": self.home_address,
            "phone": self.phone,
            "whatsapp_number": self.whatsapp_number,
            "email": self.email,
            "marital_status": self.marital_status,
            "consent_given": True,
            "consent_at": _now(),
        }


class ReviewIn(BaseModel):
    """updateApplicationStatusSchema: the legacy status, and notes."""

    application_status: ApplicationStatus | None = None
    internal_notes: str | None = Field(None, max_length=2000)

    @model_validator(mode="after")
    def _something(self) -> ReviewIn:
        if self.application_status is None and self.internal_notes is None:
            raise ValueError("Provide at least one field to update.")
        return self


class DetailsIn(BaseModel):
    """updateApplicationDetailsSchema: staff corrections."""

    job_id: str | None = Field(None, pattern=CUID)
    # null clears a position that doesn't belong to a newly picked job.
    job_position_id: str | None = Field(None, pattern=CUID)
    earliest_travel_date: datetime | None = None
    prior_eu_visa_applied: bool | None = None
    prior_eu_visa_applied_details: str | None = Field(None, max_length=500)
    current_location_country_name: str | None = Field(None, min_length=2, max_length=100)
    holds_schengen_visa: bool | None = None
    holds_schengen_visa_details: str | None = Field(None, max_length=500)
    prior_visa_refusals: bool | None = None
    prior_visa_refusals_details: str | None = Field(None, max_length=500)
    available_for_embassy_appointment: bool | None = None
    willing_to_start_within_30_days: bool | None = None
    preferred_contact_channel: ContactChannel | None = None

    _dates = field_validator("earliest_travel_date", mode="before")(_date)


# --- output ------------------------------------------------------------------


class ApplicationRow(BaseModel):
    """Every column, as Prisma returns an application row."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    candidate_id: str
    job_id: str | None
    job_position_id: str | None
    application_status: ApplicationStatus
    cover_letter: str | None
    internal_notes: str | None
    interview_date: UtcDateTime | None
    submitted_at: UtcDateTime
    updated_at: UtcDateTime
    preferred_country_1_id: str | None
    preferred_country_2_id: str | None
    preferred_country_3_id: str | None
    preferred_sector_id: str | None
    earliest_travel_date: UtcDateTime | None
    prior_eu_visa_applied: bool | None
    prior_eu_visa_applied_details: str | None
    documents_available: list[str]
    current_location_country_name: str | None
    current_location_country_id: str | None
    holds_schengen_visa: bool | None
    holds_schengen_visa_details: str | None
    prior_visa_refusals: bool | None
    prior_visa_refusals_details: str | None
    available_for_embassy_appointment: bool
    willing_to_start_within_30_days: bool
    preferred_contact_channel: ContactChannel | None
    payment_plan_acknowledged: bool


class Submitted(Notifying[ApplicationRow]):
    # When true, the website signs the form's upload token for this candidate.
    screening_passed: bool = False


# --- helpers -----------------------------------------------------------------


def _country_named(db, name: str | None) -> str | None:
    """An admin-managed Country by name, ignoring case; None when Vertex has
    no such country (the name itself is kept regardless)."""
    if not name:
        return None
    return db.scalar(select(Country.id).where(func.lower(Country.name) == name.lower()).limit(1))


def _position_belongs(db, position_id: str, job_id: str | None) -> bool:
    owner = db.scalar(select(JobSector.job_id).join(JobPosition, JobPosition.job_sector_id == JobSector.id).where(JobPosition.id == position_id))
    return owner is not None and owner == job_id


def _job_title(job: Job | None, fallback: str | None = None) -> str:
    return job.title if job else (fallback or FALLBACK_JOB_TITLE)


# --- submission --------------------------------------------------------------


def _who_applies(db, user: AuthUser | None, body: SubmissionIn) -> Candidate | None:
    """The candidate on file this form is for, or None for a new one."""
    if body.candidate_id:
        if user is None or user.role not in STAFF_ROLES:
            raise ApiError(403, "forbidden", "Only staff can submit an application on behalf of a candidate.")
        candidate = db.get(Candidate, body.candidate_id)
        if candidate is None:
            raise ApiError(404, "not_found", "Candidate not found.")
        if not can_access_candidate(db, user, CandidateRef.of(candidate)):
            raise ApiError(403, "forbidden", "Forbidden.")
        return candidate
    if user is not None and user.role is Role.candidate:
        candidate = db.scalar(select(Candidate).where(Candidate.user_id == user.user_id))
        if candidate is None:
            raise ApiError(404, "not_found", "Candidate profile not found.")
        return candidate
    if user is not None and user.role not in STAFF_ROLES:
        raise ApiError(403, "forbidden", "Forbidden.")
    return None  # anonymous, or staff entering a walk-in lead


def _check_fee(db, job: Job, candidate: Candidate | None) -> None:
    """A fee-charging programme needs a completed payment from the
    candidate's own account."""
    if not job.application_fee or job.application_fee <= 0:
        return
    if candidate is None or not candidate.user_id:
        raise ApiError(
            402,
            "payment_required",
            "This position requires a paid application fee, which only the candidate can pay from their own account. Ask them to create an account first.",
        )
    paid = db.scalar(
        select(Payment.id).where(Payment.user_id == candidate.user_id, Payment.job_id == job.id, Payment.payment_status == PaymentStatus.completed)
    )
    if paid is None:
        raise ApiError(
            402,
            "payment_required",
            "An application fee is required for this position. Please complete the payment first.",
            {"requiresPayment": True, "jobId": job.id},
        )


@router.post(
    "/applications/submit",
    response_model=Submitted,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(calling_service)],
)
def submit(body: SubmissionIn, user: OptionalUser, db: DbSession, _on: PipelineWrites):
    """POST /api/applications: the Candidate Information Form, the first
    thing anyone fills in. A new candidate starts at "identified"; only a
    Regional Recruiter entering a walk-in lead becomes its recruiter, and a
    self-applicant goes to HR. A self-applicant is screened at once, and
    invited to create an account if they pass."""
    set_audit_actor(db, user.user_id if user else None)
    missing = body.section_2_missing()
    if missing:
        raise ApiError(422, "validation_error", "Validation failed", missing)

    candidate = _who_applies(db, user, body)
    is_new = candidate is None

    # One active application at a time: a resubmission belongs to whoever
    # owns that stage.
    if candidate is not None:
        active = db.scalar(
            select(Application.id).where(Application.candidate_id == candidate.id, Application.application_status != ApplicationStatus.rejected)
        )
        if active is not None:
            raise ApiError(409, "active_application", "This candidate already has an active application on file.")

    job = db.get(Job, body.job_id)
    if job is None:
        raise ApiError(404, "not_found", "Opportunity not found.")
    if job.status is not JobStatus.active:
        raise ApiError(404, "programme_closed", "Applications for this programme are closed.")
    if body.job_position_id and not _position_belongs(db, body.job_position_id, job.id):
        raise ApiError(422, "validation_error", "Selected position does not belong to this opportunity.")
    _check_fee(db, job, candidate)

    location_id = _country_named(db, body.current_location_country_name)
    notify: list[Notice] = []

    if candidate is None:
        staff = user is not None and user.role in STAFF_ROLES
        source = CandidateSource.recruiter_sourced if staff else CandidateSource.self_registered
        agent = None
        if not staff and body.referral_code:
            # An unknown or inactive code never blocks the form.
            agent = db.scalar(select(ReferralAgent).where(ReferralAgent.referral_code == body.referral_code))
            if agent is not None and agent.status is ReferralAgentStatus.active:
                source = CandidateSource.referral_sourced
            else:
                agent = None
        candidate = Candidate(
            **body.section_2(),
            source=source,
            recruiter_id=user.user_id if user is not None and user.role is Role.regional_recruiter else None,
            referral_agent_id=agent.id if agent else None,
            country_name=body.current_location_country_name,
            country_id=location_id,
            lifecycle_status=CandidateLifecycleStatus.identified,
        )
        db.add(candidate)
        db.flush()
        if agent is not None:
            flag_if_duplicate(db, candidate)
            notify += commission_email(commission_if_due(db, candidate.id, ReferralMilestone.registered))
    elif user is not None and user.role is Role.candidate:
        for name, value in body.section_2().items():
            setattr(candidate, name, value)

    application = Application(
        candidate_id=candidate.id,
        job_id=body.job_id,
        job_position_id=body.job_position_id,
        cover_letter=body.cover_letter,
        earliest_travel_date=body.earliest_travel_date,
        prior_eu_visa_applied=body.prior_eu_visa_applied,
        prior_eu_visa_applied_details=body.prior_eu_visa_applied_details,
        documents_available=body.documents_available,
        current_location_country_name=body.current_location_country_name,
        current_location_country_id=location_id,
        holds_schengen_visa=body.holds_schengen_visa,
        holds_schengen_visa_details=body.holds_schengen_visa_details,
        prior_visa_refusals=body.prior_visa_refusals,
        prior_visa_refusals_details=body.prior_visa_refusals_details,
        available_for_embassy_appointment=body.available_for_embassy_appointment,
        willing_to_start_within_30_days=body.willing_to_start_within_30_days,
        preferred_contact_channel=body.preferred_contact_channel,
        payment_plan_acknowledged=body.payment_plan_acknowledged,
    )
    db.add(application)
    db.flush()

    if not is_new and candidate.lifecycle_status is CandidateLifecycleStatus.guided_to_apply:
        candidate.lifecycle_status = CandidateLifecycleStatus.submitted

    screening_passed = False
    if is_new and candidate.source is CandidateSource.self_registered:
        result = screen_and_invite(db, candidate.id)
        screening_passed = result.passed
        notify += invite_email(result.invite) + commission_email(result.commission)

    account = candidate.user
    email = account.email if account else candidate.email
    name = account.full_name if account else candidate.full_name
    if email and name:
        notify.append(ApplicationConfirmationEmail(email=email, full_name=name, job_title=_job_title(job), has_account=account is not None))

    db.commit()
    db.refresh(application)
    return {"data": application, "notify": notify, "screening_passed": screening_passed}


# --- review ------------------------------------------------------------------


@router.put("/applications/{application_id}", response_model=Notifying[ApplicationRow])
def review(
    application_id: str,
    body: ReviewIn,
    user: Annotated[AuthUser, Depends(require_role(*REVIEWERS))],
    db: AuditedDb,
    _on: PipelineWrites,
):
    """PUT /api/applications/[id]: the legacy hiring status and the internal
    notes (edited from a case). A case opens from the candidate's own
    lifecycle status, not from this. The candidate hears about a status
    change, not a notes edit."""
    application = db.get(Application, application_id)
    if application is None:
        raise ApiError(404, "not_found", "Application not found.")
    changes = body.model_dump(exclude_unset=True, exclude_none=True)
    for name, value in changes.items():
        setattr(application, name, value)
    db.commit()
    db.refresh(application)

    notify: list[Notice] = []
    account = application.candidate.user
    if "application_status" in changes and account is not None:
        title = _job_title(application.job, application.preferred_sector.name if application.preferred_sector else None)
        notify.append(ApplicationStatusEmail(email=account.email, full_name=account.full_name, job_title=title, status=body.application_status))
    return {"data": application, "notify": notify}


# --- staff corrections -------------------------------------------------------


@router.patch("/candidates/{candidate_id}/application", response_model=Data[ApplicationRow])
def correct(
    candidate_id: str,
    body: DetailsIn,
    user: Annotated[AuthUser, Depends(require_role(*DETAIL_EDITORS))],
    db: AuditedDb,
    _on: PipelineWrites,
):
    """PATCH /api/candidates/[id]/application: staff correcting the
    programme, travel and visa answers on the candidate's latest
    application, and on a partner submission's own copy of them."""
    candidate = db.get(Candidate, candidate_id)
    if candidate is None:
        raise ApiError(404, "not_found", "Candidate not found.")
    if not can_access_candidate(db, user, CandidateRef.of(candidate)):
        raise ApiError(403, "forbidden", "Forbidden.")
    application = db.scalar(select(Application).where(Application.candidate_id == candidate_id).order_by(Application.submitted_at.desc()).limit(1))
    if application is None:
        raise ApiError(404, "not_found", "No application on file for this candidate.")

    sent = body.model_fields_set
    changes = {k: v for k, v in body.model_dump(exclude_unset=True).items() if v is not None}
    if body.job_id and db.get(Job, body.job_id) is None:
        raise ApiError(404, "not_found", "Selected opportunity not found.")

    # A position is checked against the job it will belong to; a new job
    # without a position clears the old one, which can't belong to it.
    if body.job_position_id:
        if not _position_belongs(db, body.job_position_id, body.job_id or application.job_id):
            raise ApiError(422, "validation_error", "Selected position does not belong to this opportunity.")
    elif "job_position_id" in sent:
        changes["job_position_id"] = None
    elif body.job_id and body.job_id != application.job_id:
        changes["job_position_id"] = None

    if body.current_location_country_name:
        location_id = _country_named(db, body.current_location_country_name)
        if location_id is not None:
            changes["current_location_country_id"] = location_id

    for name, value in changes.items():
        setattr(application, name, value)
    partner_copy = db.scalar(select(PartnerCandidate).where(PartnerCandidate.bridged_candidate_id == candidate_id))
    if partner_copy is not None:
        for name, value in changes.items():
            setattr(partner_copy, name, value)
    db.commit()
    db.refresh(application)
    return {"data": application}
