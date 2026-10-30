"""Partner submission writes for the pipeline handover, step 6.6
(docs/architecture/pipeline-handover.md): a partner's drafts, submissions
and corrections (Agency Application Form, SRS FR-5.1), with HR and
operations entering them on a partner's behalf; and HR's review: opening
the case, rejecting, overturning a rejection and deleting.

Built ahead of the switch (D3 B): every route answers 503 until
PIPELINE_WRITES_ENABLED is set at step 6.7, when Next.js's
/api/partner/candidates[/draft|/[id]|/[id]/submit] and
/api/partner-candidates/[id][/create-case|/reject|/overturn] start
passing requests on. The lists and detail pages stay in Next.js.

They answer as those routes do: the same roles (tests fail if the lists
drift), checks, messages and status codes. Any HR or operations user can
reach any submission, as today (Q2, owner's decision D4). The emails go
back in `notify` (D1).

Submitting creates the Candidate (partner-sourced, never in a recruiter's
or country supervisor's queue) and its Application, and bridges the
submission to them, all in one transaction; a draft's documents move to
the candidate. Every change is on the audit trail (PartnerCandidate,
Candidate, Application and Document are in AUDITED_MODELS).
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, status
from pydantic import BaseModel, ConfigDict, Field, create_model, field_validator
from sqlalchemy import func, select

from app.api.notices import Notice, Notifying, PartnerCaseCreatedEmail, PartnerSubmissionRejectedEmail, PartnerSubmittedEmail
from app.api.v1.applications import ApplicationRow, _country_named, _position_belongs
from app.api.v1.candidates import MaritalStatus, _blank_is_missing, _date
from app.api.v1.cases import CaseRow
from app.core.api import ApiError, Data, Email, UtcDateTime, js_date
from app.core.audit import AuditedDb
from app.core.auth import AuthUser
from app.core.pipeline import PipelineWrites
from app.core.rbac import HR_ROLES, require_role
from app.models.candidate import Application, Candidate, Document
from app.models.enums import CandidateLifecycleStatus, CandidateSource, Gender, JobStatus, PartnerCandidateStatus, Role
from app.models.identity import Country
from app.models.jobs import Job
from app.models.partners import Partner, PartnerCandidate
from app.services import storage
from app.services.case_lifecycle import open_case
from app.services.documents import is_non_programme_type, required_types_by_country

router = APIRouter()

# A partner, or staff entering a partner's paper-form backlog for it.
SUBMITTERS: tuple[Role, ...] = (Role.partner, Role.hr, Role.operations_team, Role.operations_director, Role.admin)
REVIEWERS: tuple[Role, ...] = tuple(HR_ROLES)
DELETERS: tuple[Role, ...] = (*HR_ROLES, Role.operations_team, Role.operations_director)
CUID = r"^c[^\s-]{8,}$"
Channel = Literal["email", "whatsapp"]


def _now() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


def _required_date(message: str):
    def check(value: Any) -> Any:
        if value == "":
            raise ValueError(message)
        return js_date(value) if isinstance(value, str) else value

    return check


# --- input -------------------------------------------------------------------


class _Form(BaseModel):
    """The Agency Application Form, every field optional: a draft's shape
    (savePartnerCandidateDraftSchema). SubmitIn makes the required ones
    required. There's no phone or contact field: the partner is the
    candidate's only point of contact."""

    partner_id: str | None = Field(None, pattern=CUID)  # staff only; a partner's comes from its login
    full_name: str | None = Field(None, min_length=2, max_length=100)
    nationality: str | None = Field(None, min_length=2, max_length=100)
    date_of_birth: datetime | None = None
    gender: Gender | None = None
    passport_number: str | None = Field(None, min_length=1)
    passport_expiry: datetime | None = None
    email: Email | None = None
    second_nationality: str | None = Field(None, max_length=100)
    current_occupation: str | None = Field(None, max_length=150)
    highest_education: str | None = Field(None, max_length=150)
    home_address: str | None = Field(None, max_length=500)
    whatsapp_number: str | None = Field(None, max_length=30)
    marital_status: MaritalStatus | None = None
    job_id: str | None = Field(None, pattern=CUID)
    job_position_id: str | None = Field(None, pattern=CUID)
    earliest_travel_date: datetime | None = None
    prior_eu_visa_applied: bool | None = None
    prior_eu_visa_applied_details: str | None = Field(None, max_length=500)
    documents_available: list[Annotated[str, Field(min_length=1, max_length=60)]] | None = None
    payment_plan_acknowledged: bool | None = None
    current_location_country_name: str | None = Field(None, min_length=2)
    holds_schengen_visa: bool | None = None
    holds_schengen_visa_details: str | None = Field(None, max_length=500)
    prior_visa_refusals: bool | None = None
    prior_visa_refusals_details: str | None = Field(None, max_length=500)
    available_for_embassy_appointment: bool | None = None
    willing_to_start_within_30_days: bool | None = None
    preferred_contact_channel: Channel | None = None

    _blanks = field_validator("gender", "marital_status", mode="before")(_blank_is_missing)
    _dates = field_validator("date_of_birth", "passport_expiry", "earliest_travel_date", mode="before")(_date)


class DraftIn(_Form):
    pass


class SubmitIn(_Form):
    """submitPartnerCandidateSchema: finishing must clear the full bar."""

    full_name: str = Field(min_length=2, max_length=100)
    nationality: str = Field(min_length=2, max_length=100)
    date_of_birth: datetime
    gender: Gender
    passport_number: str = Field(min_length=1)
    passport_expiry: datetime
    email: Email | None = None  # a plain email when given: "" is refused
    job_id: str = Field(pattern=CUID)
    earliest_travel_date: datetime
    documents_available: list[Annotated[str, Field(min_length=1, max_length=60)]] = []
    payment_plan_acknowledged: Literal[True]
    current_location_country_name: str = Field(min_length=2)
    available_for_embassy_appointment: bool = False
    willing_to_start_within_30_days: bool = False

    _blanks = field_validator("marital_status", mode="before")(_blank_is_missing)
    _gender = field_validator("gender", mode="before")(lambda v: None if v == "" else v)
    _dob = field_validator("date_of_birth", mode="before")(_required_date("Date of birth is required"))
    _expiry = field_validator("passport_expiry", mode="before")(_required_date("Passport expiry date is required"))
    _travel = field_validator("earliest_travel_date", mode="before")(_required_date("Earliest possible travel date is required"))


class DetailsIn(BaseModel):
    """updatePartnerCandidateDetailsSchema: corrections to a submission."""

    job_id: str | None = Field(None, pattern=CUID)
    job_position_id: str | None = Field(None, pattern=CUID)  # null clears it
    full_name: str | None = Field(None, min_length=2, max_length=150)
    email: Email | None = None
    nationality: str | None = Field(None, min_length=2, max_length=100)
    second_nationality: str | None = Field(None, max_length=100)
    gender: Gender | None = None
    passport_number: str | None = Field(None, min_length=3, max_length=50)
    date_of_birth: datetime | None = None
    passport_expiry: datetime | None = None
    current_occupation: str | None = Field(None, max_length=150)
    highest_education: str | None = Field(None, max_length=150)
    home_address: str | None = Field(None, max_length=500)
    whatsapp_number: str | None = Field(None, max_length=30)
    marital_status: MaritalStatus | None = None
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
    preferred_contact_channel: Channel | None = None
    documents_available: list[Annotated[str, Field(min_length=1, max_length=60)]] | None = None
    payment_plan_acknowledged: bool | None = None

    _blanks = field_validator("email", "gender", "marital_status", mode="before")(_blank_is_missing)
    _dates = field_validator("date_of_birth", "passport_expiry", "earliest_travel_date", mode="before")(_date)


class RejectIn(BaseModel):
    rejection_reason: str = Field(min_length=1, max_length=2000)


class OverturnIn(BaseModel):
    status: Literal["submitted"]


# --- output ------------------------------------------------------------------


def _row_model(name: str, table) -> type[BaseModel]:
    """Every column of a table, as Prisma returns its row."""
    fields: dict[str, Any] = {}
    for column in table.columns:
        python_type = column.type.python_type
        annotation: Any = UtcDateTime if python_type is datetime else list[str] if python_type is list else python_type
        if column.nullable:
            annotation = annotation | None
        fields[column.key] = (annotation, ...)
    return create_model(name, __config__=ConfigDict(from_attributes=True), **fields)


PartnerCandidateRow = _row_model("PartnerCandidateRow", PartnerCandidate.__table__)


class Submission(PartnerCandidateRow):  # type: ignore[misc, valid-type]
    candidateId: str  # noqa: N815  (the Next.js field names)
    applicationId: str  # noqa: N815


class Bridged(BaseModel):
    partnerCandidate: PartnerCandidateRow  # type: ignore[valid-type]  # noqa: N815
    case: CaseRow


class Overturned(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    status: PartnerCandidateStatus
    rejection_reason: str | None


class Deleted(BaseModel):
    id: str


# --- helpers -----------------------------------------------------------------


def _own_partner(db, user: AuthUser) -> Partner | None:
    return db.scalar(select(Partner).where(Partner.user_id == user.user_id))


def _partner_for(db, user: AuthUser, partner_id: str | None) -> Partner:
    """A partner's own record from its login; staff name the partner."""
    if user.role is Role.partner:
        partner = _own_partner(db, user)
        if partner is None:
            raise ApiError(404, "not_found", "Partner record not found.")
        return partner
    partner = db.get(Partner, partner_id) if partner_id else None
    if partner is None:
        raise ApiError(422, "not_found", "partner_id is required and must reference a real partner.")
    return partner


def _submission(db, submission_id: str, *, drafts: bool) -> PartnerCandidate:
    row = db.get(PartnerCandidate, submission_id)
    if row is None or (not drafts and row.status is PartnerCandidateStatus.draft):
        raise ApiError(404, "not_found", "Partner candidate submission not found.")
    return row


FORM_FIELDS = (
    "full_name", "nationality", "date_of_birth", "passport_number", "passport_expiry", "email", "second_nationality", "gender",
    "current_occupation", "highest_education", "home_address", "whatsapp_number", "marital_status",
)
PROGRAMME_FIELDS = (
    "job_position_id", "earliest_travel_date", "prior_eu_visa_applied", "prior_eu_visa_applied_details",
    "current_location_country_name", "holds_schengen_visa", "holds_schengen_visa_details", "prior_visa_refusals",
    "prior_visa_refusals_details", "available_for_embassy_appointment", "willing_to_start_within_30_days", "preferred_contact_channel",
)


def _finalize(db, partner: Partner, body: SubmitIn, submitted_by: str, draft: PartnerCandidate | None = None) -> tuple[PartnerCandidate, Candidate, Application]:
    """finalizeSubmission: the checks, then Candidate, Application and the
    bridged submission, in the caller's transaction (all or nothing)."""
    job = db.get(Job, body.job_id)
    if job is None:
        raise ApiError(404, "not_found", "Opportunity not found.")
    if job.status is not JobStatus.active:
        raise ApiError(404, "programme_closed", "Applications for this programme are closed.")

    # One live submission per passport, across every partner: a draft was
    # never submitted, and a rejection can be corrected and resubmitted.
    duplicate = select(PartnerCandidate.id).where(
        PartnerCandidate.passport_number == body.passport_number,
        PartnerCandidate.status.not_in([PartnerCandidateStatus.draft, PartnerCandidateStatus.rejected]),
    )
    if draft is not None:
        duplicate = duplicate.where(PartnerCandidate.id != draft.id)
    if db.scalar(duplicate.limit(1)) is not None:
        raise ApiError(422, "duplicate_passport", "A submission with this passport number is already on file. If you believe this is an error, contact Vertex.")

    if body.job_position_id and not _position_belongs(db, body.job_position_id, job.id):
        raise ApiError(422, "validation_error", "Selected position does not belong to this opportunity.")

    # Every document the destination requires must be ticked (the types
    # with their own uploads aside).
    job_country = db.scalar(select(Country.id).where(func.lower(Country.name) == job.country.lower()).limit(1))
    by_country = required_types_by_country(db, [job_country])
    required = [t for t in by_country.get(job_country) or by_country[None] if not is_non_programme_type(t)]
    missing = [t for t in required if t not in body.documents_available]
    if missing:
        raise ApiError(422, "documents_incomplete", f"Missing required documents: {', '.join(missing)}")

    location_id = _country_named(db, body.current_location_country_name)
    personal = {name: getattr(body, name) for name in FORM_FIELDS}
    programme = {name: getattr(body, name) for name in PROGRAMME_FIELDS} | {
        "current_location_country_id": location_id,
        "documents_available": body.documents_available,
        "payment_plan_acknowledged": body.payment_plan_acknowledged,
    }

    # No country: a partner-sourced candidate is never in a recruiter's or
    # country supervisor's queue. The partner's submission is the consent.
    candidate = Candidate(
        **personal,
        consent_given=True,
        consent_at=_now(),
        source=CandidateSource.partner_sourced,
        partner_id=partner.id,
        lifecycle_status=CandidateLifecycleStatus.submitted,
    )
    db.add(candidate)
    db.flush()
    application = Application(candidate_id=candidate.id, job_id=job.id, **programme)
    db.add(application)

    row = draft or PartnerCandidate(partner_id=partner.id)
    for name, value in (personal | programme).items():
        setattr(row, name, value)
    row.job_id = job.id
    row.bridged_candidate_id = candidate.id
    row.status = PartnerCandidateStatus.submitted
    row.submitted_at = _now()
    row.submitted_by = submitted_by
    if draft is None:
        db.add(row)
    else:
        # The draft's files are the candidate's now: same files, no re-upload.
        for document in db.scalars(select(Document).where(Document.partner_candidate_id == draft.id)):
            document.candidate_id = candidate.id
    db.flush()
    return row, candidate, application


def _submitted(row: PartnerCandidate, candidate: Candidate, application: Application, partner: Partner) -> dict[str, Any]:
    data = Submission(**PartnerCandidateRow.model_validate(row).model_dump(), candidateId=candidate.id, applicationId=application.id)
    notice = PartnerSubmittedEmail(partner_name=partner.name, candidate_name=row.full_name or "the candidate")
    return {"data": data, "notify": [notice]}


# --- the partner's side ------------------------------------------------------


Submitter = Annotated[AuthUser, Depends(require_role(*SUBMITTERS))]


@router.post("/partner/candidates", response_model=Notifying[Submission], status_code=status.HTTP_201_CREATED)
def submit(body: SubmitIn, user: Submitter, db: AuditedDb, _on: PipelineWrites):
    """POST /api/partner/candidates: a fresh submission."""
    partner = _partner_for(db, user, body.partner_id)
    row, candidate, application = _finalize(db, partner, body, user.user_id)
    db.commit()
    db.refresh(row)
    return _submitted(row, candidate, application, partner)


@router.post("/partner/candidates/draft", response_model=Data[PartnerCandidateRow], status_code=status.HTTP_201_CREATED)
def save_draft(body: DraftIn, user: Submitter, db: AuditedDb, _on: PipelineWrites):
    """POST /api/partner/candidates/draft: work in progress, any fields; no
    checks until it's submitted."""
    partner = _partner_for(db, user, body.partner_id)
    fields = body.model_dump(exclude={"partner_id"}, exclude_none=True)
    draft = PartnerCandidate(
        **fields,
        partner_id=partner.id,
        status=PartnerCandidateStatus.draft,
        drafted_at=_now(),
        drafted_by=user.user_id,
        current_location_country_id=_country_named(db, body.current_location_country_name),
    )
    draft.documents_available = body.documents_available or []
    draft.payment_plan_acknowledged = bool(body.payment_plan_acknowledged)
    draft.available_for_embassy_appointment = bool(body.available_for_embassy_appointment)
    draft.willing_to_start_within_30_days = bool(body.willing_to_start_within_30_days)
    db.add(draft)
    db.commit()
    db.refresh(draft)
    return {"data": draft}


@router.post("/partner/candidates/{submission_id}/submit", response_model=Notifying[Submission])
def submit_draft(submission_id: str, body: SubmitIn, user: Submitter, db: AuditedDb, _on: PipelineWrites):
    """POST /api/partner/candidates/[id]/submit: a draft finished, upgraded in
    place, against the same bar as a fresh submission."""
    own = _own_partner(db, user) if user.role is Role.partner else None
    draft = db.get(PartnerCandidate, submission_id)
    if draft is None or (user.role is Role.partner and (own is None or draft.partner_id != own.id)):
        raise ApiError(404, "not_found", "Draft not found.")
    if draft.status is not PartnerCandidateStatus.draft:
        raise ApiError(409, "invalid_state", "This submission has already been finalized.")
    partner = own or db.get(Partner, draft.partner_id)
    row, candidate, application = _finalize(db, partner, body, user.user_id, draft)
    db.commit()
    db.refresh(row)
    return _submitted(row, candidate, application, partner)


@router.patch("/partner/candidates/{submission_id}", response_model=Data[PartnerCandidateRow])
def correct(submission_id: str, body: DetailsIn, user: Submitter, db: AuditedDb, _on: PipelineWrites):
    """PATCH /api/partner/candidates/[id]: a partner correcting its own
    submission, or staff re-saving a draft they're entering. A bridged
    submission's candidate and latest application follow."""
    staff = user.role is not Role.partner
    partner = None if staff else _own_partner(db, user)
    if not staff and partner is None:
        raise ApiError(404, "not_found", "Partner record not found.")
    row = db.get(PartnerCandidate, submission_id)
    if row is None or (row.status is not PartnerCandidateStatus.draft if staff else row.partner_id != partner.id):
        raise ApiError(404, "not_found", "Submission not found.")

    if body.job_id and db.get(Job, body.job_id) is None:
        raise ApiError(404, "not_found", "Selected opportunity not found.")
    changes = {k: v for k, v in body.model_dump(exclude_unset=True).items() if v is not None}
    if body.job_position_id:
        if not _position_belongs(db, body.job_position_id, body.job_id or row.job_id):
            raise ApiError(422, "validation_error", "Selected position does not belong to this opportunity.")
    elif "job_position_id" in body.model_fields_set or (body.job_id and body.job_id != row.job_id):
        changes["job_position_id"] = None
    if body.current_location_country_name:
        location_id = _country_named(db, body.current_location_country_name)
        if location_id is not None:
            changes["current_location_country_id"] = location_id

    for name, value in changes.items():
        setattr(row, name, value)
    if row.bridged_candidate_id:
        candidate = db.get(Candidate, row.bridged_candidate_id)
        for name in FORM_FIELDS:
            if name in changes:
                setattr(candidate, name, changes[name])
        application = db.scalar(
            select(Application).where(Application.candidate_id == candidate.id).order_by(Application.submitted_at.desc()).limit(1)
        )
        if application is not None:
            for name in ("job_id", *PROGRAMME_FIELDS, "current_location_country_id"):
                if name in changes:
                    setattr(application, name, changes[name])
    db.commit()
    db.refresh(row)
    return {"data": row}


def _remove_documents(db, documents) -> list[str]:
    """Deletes the rows (audited) and returns their files, for removal once
    the deletion has committed."""
    paths = []
    for document in documents:
        paths.append(document.storage_path)
        db.delete(document)
    return paths


@router.delete("/partner/candidates/{submission_id}", response_model=Data[Deleted])
def abandon_draft(
    submission_id: str,
    user: Annotated[AuthUser, Depends(require_role(Role.partner))],
    db: AuditedDb,
    _on: PipelineWrites,
):
    """DELETE /api/partner/candidates/[id]: a partner abandoning its own
    unfinished draft, with the files it uploaded. A real submission is
    never self-deleted, only rejected."""
    partner = _own_partner(db, user)
    if partner is None:
        raise ApiError(404, "not_found", "Partner record not found.")
    row = db.get(PartnerCandidate, submission_id)
    if row is None or row.partner_id != partner.id:
        raise ApiError(404, "not_found", "Submission not found.")
    if row.status is not PartnerCandidateStatus.draft:
        raise ApiError(409, "invalid_state", "Only an unsubmitted draft can be deleted.")
    paths = _remove_documents(db, list(row.documents))
    db.delete(row)
    db.commit()
    for path in paths:
        storage.delete_document(path)
    return {"data": {"id": submission_id}}


# --- HR's review -------------------------------------------------------------


Reviewer = Annotated[AuthUser, Depends(require_role(*REVIEWERS))]


@router.patch("/partner-candidates/{submission_id}/create-case", response_model=Notifying[Bridged])
def create_case(submission_id: str, user: Reviewer, db: AuditedDb, _on: PipelineWrites):
    """PATCH /api/partner-candidates/[id]/create-case: HR approves the
    submission and opens its case. The partner already screened the
    candidate, so they go straight to "approved"."""
    row = _submission(db, submission_id, drafts=False)
    if not row.bridged_candidate_id:
        raise ApiError(422, "not_bridged", "This submission has no linked candidate record to create a case for.")
    if row.status is PartnerCandidateStatus.job_assigned:
        raise ApiError(409, "already_bridged", "A case has already been created for this submission.")
    if row.status is PartnerCandidateStatus.rejected:
        raise ApiError(422, "rejected", "This submission was rejected — it cannot be bridged to a case.")
    candidate = db.get(Candidate, row.bridged_candidate_id)
    if candidate is None:
        raise ApiError(404, "not_found", "Linked candidate record no longer exists.")
    application = db.scalar(select(Application).where(Application.candidate_id == candidate.id).order_by(Application.submitted_at.desc()).limit(1))
    if application is None:
        raise ApiError(404, "not_found", "No application on file for this candidate.")

    candidate.lifecycle_status = CandidateLifecycleStatus.approved
    case = open_case(db, application.id)
    row.status = PartnerCandidateStatus.job_assigned
    row.reviewed_by = user.user_id
    db.commit()
    db.refresh(row)
    db.refresh(case)
    # The partner is told, never the candidate: the partner is their contact.
    notify: list[Notice] = []
    if row.partner.contact_email:
        notify.append(PartnerCaseCreatedEmail(email=row.partner.contact_email, partner_name=row.partner.name, candidate_name=candidate.full_name or "your candidate"))
    return {"data": {"partnerCandidate": row, "case": case}, "notify": notify}


@router.patch("/partner-candidates/{submission_id}/reject", response_model=Notifying[PartnerCandidateRow])
def reject(submission_id: str, body: RejectIn, user: Reviewer, db: AuditedDb, _on: PipelineWrites):
    """PATCH /api/partner-candidates/[id]/reject: sent back to the partner
    to correct; not a dead end."""
    row = _submission(db, submission_id, drafts=False)
    if row.status is PartnerCandidateStatus.job_assigned:
        raise ApiError(409, "already_bridged", "A case has already been created for this submission — it can no longer be rejected.")
    row.status = PartnerCandidateStatus.rejected
    row.rejection_reason = body.rejection_reason
    row.reviewed_by = user.user_id
    db.commit()
    db.refresh(row)
    notice = PartnerSubmissionRejectedEmail(
        email=row.partner.contact_email, partner_name=row.partner.name, candidate_name=row.full_name or "the candidate", reason=body.rejection_reason
    )
    return {"data": row, "notify": [notice]}


@router.patch("/partner-candidates/{submission_id}/overturn", response_model=Data[Overturned])
def overturn(submission_id: str, body: OverturnIn, user: Reviewer, db: AuditedDb, _on: PipelineWrites):
    """PATCH /api/partner-candidates/[id]/overturn: a rejection undone, the
    submission back to "submitted", where it was when it was rejected.

    The linked candidate keeps its status: rejecting never changed it, so
    undoing the rejection leaves it as it was. (Until 2026-10-30 this set
    the candidate to "approved", as the website did, though no case
    existed; the owner decided an overturn reinstates the previous status.)"""
    row = db.get(PartnerCandidate, submission_id)
    if row is None:
        raise ApiError(404, "not_found", "Partner candidate submission not found.")
    if row.status is not PartnerCandidateStatus.rejected:
        raise ApiError(400, "not_rejected", "This submission is not rejected.")
    row.status = PartnerCandidateStatus(body.status)
    row.rejection_reason = None
    row.reviewed_by = None
    db.commit()
    db.refresh(row)
    return {"data": row}


@router.delete("/partner-candidates/{submission_id}", response_model=Data[Deleted])
def delete_submission(
    submission_id: str,
    user: Annotated[AuthUser, Depends(require_role(*DELETERS))],
    db: AuditedDb,
    _on: PipelineWrites,
):
    """DELETE /api/partner-candidates/[id]: an erroneous or duplicate
    submission, with its candidate (and their applications, documents and
    messages). Refused once a case exists."""
    row = _submission(db, submission_id, drafts=False)
    if row.status is PartnerCandidateStatus.job_assigned:
        raise ApiError(
            409, "case_exists", "A case has already been created for this submission — manage or close it from the Case instead of deleting."
        )
    candidate = db.get(Candidate, row.bridged_candidate_id) if row.bridged_candidate_id else None
    # Documents still filed only under the submission go with it.
    _remove_documents(db, [d for d in row.documents if d.candidate_id is None])
    if candidate is not None:
        db.delete(candidate)
        db.flush()
    db.delete(row)
    db.commit()
    return {"data": {"id": submission_id}}
