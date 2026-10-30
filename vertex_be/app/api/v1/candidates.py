"""Candidate writes for the pipeline handover, step 6.2
(docs/architecture/pipeline-handover.md): the candidate's own profile, staff
edits and deletion, lifecycle status (with screening and the invite), the
candidate's message thread, and registration claiming a candidate.

Built ahead of the switch (owner's decision D3 B): every route here answers
503 until PIPELINE_WRITES_ENABLED is set at step 6.7, when Next.js's
/api/candidates/profile, /api/candidates/[id], /api/candidates/[id]/status,
/api/candidates/[id]/messages[/messageId] and /api/auth/register start
passing requests on. Until then the website writes these rows.

They answer as those routes do: the same roles (tests fail if the lists
drift), the same access rules (app/core/scope.py), transitions
(app/services/candidate_lifecycle.py), messages, status codes and JSON.
Who the caller is comes from their session, never from the request.

The website keeps sending the emails (owner's decision D1, 2026-10-29): a
response lists the emails now due in `notify`, next to `data`, and the
website sends them after the write has committed.

Approving a candidate opens their case (app/services/case_lifecycle.py,
step 6.5).

Every change is on the audit trail (Candidate, CandidateMessage,
PartnerCandidate and ReferralCommission are in AUDITED_MODELS). Deleting a
candidate removes their applications, documents and messages through the
ORM, so each of those is on the trail too.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated, Any, Literal, get_args

from fastapi import APIRouter, Depends, status
from pydantic import BaseModel, BeforeValidator, ConfigDict, Field, field_validator
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.api.deps import DbSession
from app.api.notices import CandidateApprovedEmail, MessageEmail, Notice, Notifying, commission_email, invite_email
from app.core.api import ApiError, Data, Email, UtcDateTime, js_date
from app.core.audit import AuditedDb, set_audit_actor
from app.core.auth import AuthUser, CurrentUser, calling_service
from app.core.pipeline import PipelineWrites
from app.core.rbac import require_role
from app.core.scope import CandidateRef, can_access_candidate
from app.core.tokens import InvalidToken, verify_candidate_invite_token
from app.models.candidate import Application, Candidate, CandidateMessage
from app.models.cases import Case
from app.models.enums import CandidateLifecycleStatus, CandidateSource, Gender, PartnerCandidateStatus, ReferralMilestone, Role
from app.models.identity import User
from app.models.partners import Partner, PartnerCandidate
from app.services.candidate_lifecycle import can_set_lifecycle_status
from app.services.case_lifecycle import open_case
from app.services.referrals import commission_if_due
from app.services.documents import document_completeness
from app.services.screening import screen_and_invite

router = APIRouter()

# PATCH /api/candidates/[id]: minor corrections by whoever handles the
# candidate before a case (the recruiter and their supervisor; HR,
# operations and the director for self-applications and partner submissions).
DETAIL_EDITORS: tuple[Role, ...] = (
    Role.regional_recruiter,
    Role.country_supervisor,
    Role.admin,
    Role.hr,
    Role.operations_team,
    Role.operations_director,
    Role.director,
)
# DELETE /api/candidates/[id]: an erroneous, duplicate or spam submission.
DELETERS: tuple[Role, ...] = (Role.hr, Role.operations_team, Role.operations_director, Role.director, Role.admin)
# PATCH /api/candidates/[id]/status.
STATUS_SETTERS: tuple[Role, ...] = (
    Role.regional_recruiter,
    Role.country_supervisor,
    Role.inhouse_supervisor,
    Role.director,
    Role.admin,
    Role.hr,
)
# The staff on a partner-sourced or self-submitted candidate's thread.
CASE_STAFF: tuple[Role, ...] = (Role.hr, Role.operations_team, Role.operations_director, Role.director)

# vertex/src/lib/maritalStatus.ts (tests fail if they drift).
MaritalStatus = Literal["Single", "Married", "Divorced", "Widowed", "Separated"]
MARITAL_STATUS_VALUES: tuple[str, ...] = get_args(MaritalStatus)
MESSAGE_MAX_LENGTH = 4000


def _now() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


def _not_found(what: str = "Candidate") -> ApiError:
    return ApiError(404, "not_found", f"{what} not found.")


def _forbidden(message: str = "Forbidden.") -> ApiError:
    return ApiError(403, "forbidden", message)


# --- input -------------------------------------------------------------------


def _blank_is_missing(value: Any) -> Any:
    # An untouched date input or dropdown sends "": treated as not sent.
    return None if value == "" else value


def _date(value: Any) -> Any:
    # Runs before Blank, so it sees the "" too.
    if value == "":
        return None
    return js_date(value) if isinstance(value, str) else value


Blank = BeforeValidator(_blank_is_missing)


class _Fields(BaseModel):
    """Fields a request may leave out. A missing or null field leaves the
    column as it is, as Prisma treats a missing key."""

    def changes(self) -> dict[str, Any]:
        return {k: v for k, v in self.model_dump(exclude_unset=True).items() if v is not None}


class ProfileIn(_Fields):
    """candidateProfileSchema: Section 2 of the Candidate Information Form,
    edited by the candidate."""

    passport_number: str | None = None
    date_of_birth: Annotated[datetime | None, Blank] = None
    nationality: str | None = None
    second_nationality: str | None = Field(None, max_length=100)
    gender: Annotated[Gender | None, Blank] = None
    passport_expiry: Annotated[datetime | None, Blank] = None
    current_occupation: str | None = Field(None, max_length=150)
    highest_education: str | None = Field(None, max_length=150)
    home_address: str | None = Field(None, max_length=500)
    whatsapp_number: str | None = Field(None, max_length=30)
    marital_status: Annotated[MaritalStatus | None, Blank] = None

    _dates = field_validator("date_of_birth", "passport_expiry", mode="before")(_date)


class DetailsIn(_Fields):
    """updateCandidateDetailsSchema: staff corrections and consent."""

    full_name: str | None = Field(None, min_length=2, max_length=100)
    nationality: str | None = Field(None, min_length=2, max_length=100)
    date_of_birth: Annotated[datetime | None, Blank] = None
    passport_number: str | None = None
    phone: str | None = None
    email: Annotated[Email | None, Blank] = None
    desired_role: str | None = Field(None, max_length=150)
    consent_given: bool | None = None
    second_nationality: str | None = Field(None, max_length=100)
    gender: Annotated[Gender | None, Blank] = None
    passport_expiry: Annotated[datetime | None, Blank] = None
    current_occupation: str | None = Field(None, max_length=150)
    highest_education: str | None = Field(None, max_length=150)
    home_address: str | None = Field(None, max_length=500)
    whatsapp_number: str | None = Field(None, max_length=30)
    marital_status: Annotated[MaritalStatus | None, Blank] = None
    # HR clearing a duplicate-referral warning after looking at it.
    referral_duplicate_flag: bool | None = None

    _dates = field_validator("date_of_birth", "passport_expiry", mode="before")(_date)


class StatusIn(BaseModel):
    """updateCandidateStatusSchema."""

    lifecycle_status: CandidateLifecycleStatus
    return_reason: str | None = Field(None, min_length=5, max_length=1000)


class MessageIn(BaseModel):
    # Checked in the route, for the website's own messages.
    body: Any = None


class ClaimIn(BaseModel):
    invite: str = Field(min_length=1)
    user_id: str = Field(min_length=1)


# --- output ------------------------------------------------------------------


class CandidateRow(BaseModel):
    """Every column, as Prisma returns a candidate row."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    user_id: str | None
    passport_number: str | None
    passport_expiry: UtcDateTime | None
    date_of_birth: UtcDateTime | None
    nationality: str | None
    second_nationality: str | None
    gender: Gender | None
    current_occupation: str | None
    highest_education: str | None
    home_address: str | None
    whatsapp_number: str | None
    marital_status: str | None
    created_at: UtcDateTime
    updated_at: UtcDateTime
    full_name: str | None
    phone: str | None
    email: str | None
    desired_role: str | None
    source: CandidateSource
    recruiter_id: str | None
    country_name: str | None
    country_id: str | None
    lifecycle_status: CandidateLifecycleStatus
    partner_id: str | None
    referral_agent_id: str | None
    referral_duplicate_flag: bool
    consent_given: bool
    consent_at: UtcDateTime | None
    return_reason: str | None
    screening_result: bool | None
    screening_evaluated_at: UtcDateTime | None


class CandidateDetails(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    full_name: str | None
    nationality: str | None
    date_of_birth: UtcDateTime | None
    passport_number: str | None
    phone: str | None
    email: str | None
    desired_role: str | None
    consent_given: bool
    consent_at: UtcDateTime | None
    second_nationality: str | None
    gender: Gender | None
    passport_expiry: UtcDateTime | None
    current_occupation: str | None
    highest_education: str | None
    home_address: str | None
    whatsapp_number: str | None
    marital_status: str | None


class StatusOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    lifecycle_status: CandidateLifecycleStatus
    return_reason: str | None


class Sender(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    full_name: str
    role: Role


class MessageOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    body: str
    created_at: UtcDateTime
    updated_at: UtcDateTime
    sender_id: str
    sender: Sender


class Deleted(BaseModel):
    id: str


class Claimed(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    lifecycle_status: CandidateLifecycleStatus


# --- the candidate's own profile --------------------------------------------


@router.put("/candidates/profile", response_model=Data[CandidateRow])
def update_own_profile(body: ProfileIn, user: CurrentUser, db: AuditedDb, _on: PipelineWrites):
    """PUT /api/candidates/profile: a signed-in candidate edits Section 2."""
    candidate = db.scalar(select(Candidate).where(Candidate.user_id == user.user_id))
    if candidate is None:
        raise ApiError(404, "not_found", "No candidate profile for this account.")
    for name, value in body.changes().items():
        setattr(candidate, name, value)
    db.commit()
    db.refresh(candidate)
    return {"data": candidate}


# --- staff edits -------------------------------------------------------------


def _load(db, candidate_id: str) -> Candidate:
    candidate = db.get(Candidate, candidate_id)
    if candidate is None:
        raise _not_found()
    return candidate


def _check_access(db, user: AuthUser, candidate: Candidate) -> None:
    if not can_access_candidate(db, user, CandidateRef.of(candidate)):
        raise _forbidden()


# The fields PATCH copies to a partner-sourced candidate's PartnerCandidate,
# whose own columns its submission page shows. Partner submissions never
# collect a phone number, so phone isn't copied.
PARTNER_SNAPSHOT_FIELDS = (
    "full_name",
    "email",
    "nationality",
    "second_nationality",
    "gender",
    "passport_number",
    "date_of_birth",
    "passport_expiry",
    "current_occupation",
    "highest_education",
    "home_address",
    "whatsapp_number",
    "marital_status",
)


@router.patch("/candidates/{candidate_id}", response_model=Data[CandidateDetails])
def update_details(
    candidate_id: str,
    body: DetailsIn,
    user: Annotated[AuthUser, Depends(require_role(*DETAIL_EDITORS))],
    db: AuditedDb,
    _on: PipelineWrites,
):
    """PATCH /api/candidates/[id]: progressive detail edits and consent."""
    candidate = _load(db, candidate_id)
    _check_access(db, user, candidate)

    changes = body.changes()
    consent = changes.pop("consent_given", None)
    for name, value in changes.items():
        setattr(candidate, name, value)
    if consent is not None:
        candidate.consent_given = consent
        candidate.consent_at = _now() if consent else None

    partner_candidate = db.scalar(select(PartnerCandidate).where(PartnerCandidate.bridged_candidate_id == candidate_id))
    if partner_candidate is not None:
        for name in PARTNER_SNAPSHOT_FIELDS:
            if name in changes:
                setattr(partner_candidate, name, changes[name])

    db.commit()
    db.refresh(candidate)
    return {"data": candidate}


@router.delete("/candidates/{candidate_id}", response_model=Data[Deleted])
def delete_candidate(
    candidate_id: str,
    user: Annotated[AuthUser, Depends(require_role(*DELETERS))],
    db: AuditedDb,
    _on: PipelineWrites,
):
    """DELETE /api/candidates/[id]: removes a submission that shouldn't be
    there, with its applications, documents and messages. Refused once a
    case exists, whatever its status: a case is a permanent record."""
    candidate = _load(db, candidate_id)
    _check_access(db, user, candidate)
    has_case = db.scalar(select(Case.id).join(Application, Case.application_id == Application.id).where(Application.candidate_id == candidate_id))
    if has_case is not None:
        raise ApiError(
            409,
            "case_exists",
            "A case has already been created for this candidate — manage or close it from the Case instead of deleting.",
        )
    db.delete(candidate)
    db.commit()
    return {"data": {"id": candidate_id}}


# --- lifecycle status --------------------------------------------------------


@router.patch("/candidates/{candidate_id}/status", response_model=Notifying[StatusOut])
def set_status(
    candidate_id: str,
    body: StatusIn,
    user: Annotated[AuthUser, Depends(require_role(*STATUS_SETTERS))],
    db: AuditedDb,
    _on: PipelineWrites,
):
    """PATCH /api/candidates/[id]/status: a role-gated lifecycle move
    (SRS FR-2.4), the screening gate on "screened" (FR-2.5) and the
    supervisor's return for correction (FR-2.7)."""
    candidate = _load(db, candidate_id)
    _check_access(db, user, candidate)

    target = body.lifecycle_status
    transition = can_set_lifecycle_status(user.role, candidate.lifecycle_status, target, candidate.source)
    if not transition.allowed:
        raise ApiError(422, "invalid_transition", transition.reason or "This move isn't allowed.")
    needs_reason = transition.is_return or target is CandidateLifecycleStatus.rejected
    if needs_reason and not body.return_reason:
        raise ApiError(422, "return_reason_required", "A reason is required for this action.")

    if target is CandidateLifecycleStatus.screened:
        result = screen_and_invite(db, candidate_id)
        # The result is recorded whether or not the candidate passed.
        db.commit()
        if not result.passed:
            raise ApiError(422, "screening_gate_failed", "Candidate has not cleared the screening gate.", result.failures)
        db.refresh(candidate)
        return {"data": candidate, "notify": invite_email(result.invite) + commission_email(result.commission)}

    candidate.lifecycle_status = target
    candidate.return_reason = body.return_reason if needs_reason else None
    notify: list[Notice] = []
    if target is CandidateLifecycleStatus.approved:
        notify = _approve(db, candidate)
    db.commit()
    db.refresh(candidate)
    return {"data": candidate, "notify": notify}


def _approve(db, candidate: Candidate) -> list[Notice]:
    """"Approved by In-House" opens the case on the candidate's latest
    application (SRS FR-4.1), which is when a referral earns its
    "application submitted" commission; the candidate is told."""
    notify: list[Notice] = []
    application = db.scalar(select(Application).where(Application.candidate_id == candidate.id).order_by(Application.submitted_at.desc()).limit(1))
    if application is not None:
        case = open_case(db, application.id)
        notify += commission_email(commission_if_due(db, candidate.id, ReferralMilestone.application_submitted, case_id=case.id))
    account = candidate.user
    email = account.email if account else candidate.email
    name = account.full_name if account else candidate.full_name
    if email and name:
        notify.append(CandidateApprovedEmail(email=email, full_name=name))
    return notify


# --- messages ----------------------------------------------------------------


def _thread_access(db, user: AuthUser, candidate: Candidate) -> bool:
    """One thread per candidate: the candidate, their recruiter, admin, the
    sourcing partner, and the HR, operations and director staff on a
    partner-sourced or self-submitted candidate."""
    if user.role is Role.admin or user.user_id in (candidate.user_id, candidate.recruiter_id):
        return True
    if user.role is Role.partner and candidate.partner_id:
        return db.scalar(select(Partner.id).where(Partner.user_id == user.user_id)) == candidate.partner_id
    return user.role in CASE_STAFF and (candidate.partner_id is not None or candidate.source is CandidateSource.self_registered)


def _message_text(body: MessageIn) -> str:
    text = body.body
    if not isinstance(text, str) or not text.strip():
        raise ApiError(422, "validation_error", "Message body is required.")
    if len(text) > MESSAGE_MAX_LENGTH:
        raise ApiError(422, "validation_error", "Message is too long.")
    return text.strip()


def _message_email(db, user: AuthUser, candidate: Candidate) -> list[Notice]:
    """Tells whichever side didn't send the message."""
    recipient: tuple[str, str] | None = None
    view_path = "/dashboard"

    def person(user_id: str | None) -> tuple[str, str] | None:
        found = db.get(User, user_id) if user_id else None
        return (found.email, found.full_name) if found else None

    if candidate.user_id == user.user_id:
        recipient, view_path = person(candidate.recruiter_id), f"/recruiter/candidates/{candidate.id}"
    elif user.role is Role.partner and candidate.partner_id:
        reviewer = db.scalar(select(PartnerCandidate.reviewed_by).where(PartnerCandidate.bridged_candidate_id == candidate.id))
        recipient, view_path = person(reviewer), "/hr"
    elif user.role in CASE_STAFF and candidate.partner_id:
        partner = db.get(Partner, candidate.partner_id)
        recipient, view_path = ((partner.contact_email, partner.contact_name) if partner else None), "/partner"
    elif candidate.user_id:
        recipient = person(candidate.user_id)

    if recipient is None:
        return []
    return [MessageEmail(email=recipient[0], full_name=recipient[1], view_path=view_path)]


@router.post("/candidates/{candidate_id}/messages", response_model=Notifying[MessageOut], status_code=status.HTTP_201_CREATED)
def post_message(candidate_id: str, body: MessageIn, user: CurrentUser, db: AuditedDb, _on: PipelineWrites):
    """POST /api/candidates/[id]/messages."""
    candidate = _load(db, candidate_id)
    if not _thread_access(db, user, candidate):
        raise _forbidden()
    message = CandidateMessage(candidate_id=candidate_id, sender_id=user.user_id, body=_message_text(body))
    db.add(message)

    # HR saying anything on a partner submission nobody has picked up yet
    # tells the partner someone is now looking at it.
    if user.role is Role.hr and candidate.partner_id:
        submission = db.scalar(
            select(PartnerCandidate).where(
                PartnerCandidate.bridged_candidate_id == candidate_id, PartnerCandidate.status == PartnerCandidateStatus.submitted
            )
        )
        if submission is not None:
            submission.status = PartnerCandidateStatus.under_review

    notify = _message_email(db, user, candidate)
    db.commit()
    db.refresh(message)
    return {"data": message, "notify": notify}


def _own_message(db, candidate_id: str, message_id: str, user: AuthUser, verb: str) -> CandidateMessage:
    """Only the sender may change or remove their message; whether they can
    still reach the thread doesn't matter for their own words."""
    message = db.get(CandidateMessage, message_id)
    if message is None or message.candidate_id != candidate_id:
        raise _not_found("Message")
    if message.sender_id != user.user_id:
        raise _forbidden(f"You can only {verb} your own messages.")
    return message


@router.patch("/candidates/{candidate_id}/messages/{message_id}", response_model=Data[MessageOut])
def edit_message(candidate_id: str, message_id: str, body: MessageIn, user: CurrentUser, db: AuditedDb, _on: PipelineWrites):
    """PATCH /api/candidates/[id]/messages/[messageId]."""
    message = _own_message(db, candidate_id, message_id, user, "edit")
    message.body = _message_text(body)
    db.commit()
    db.refresh(message)
    return {"data": message}


@router.delete("/candidates/{candidate_id}/messages/{message_id}", response_model=Data[Deleted])
def delete_message(candidate_id: str, message_id: str, user: CurrentUser, db: AuditedDb, _on: PipelineWrites):
    """DELETE /api/candidates/[id]/messages/[messageId]."""
    message = _own_message(db, candidate_id, message_id, user, "delete")
    db.delete(message)
    db.commit()
    return {"data": {"id": message_id}}


# --- registration ------------------------------------------------------------


@router.post("/candidates/claim", response_model=Data[Claimed], dependencies=[Depends(calling_service)])
def claim(body: ClaimIn, db: DbSession, _on: PipelineWrites):
    """Registration (POST /api/auth/register) links the account it has just
    created to the candidate the screening invite was for. Users stay with
    the website until they move (data-ownership.md §2.3), so the website
    creates the User and only Next.js itself may call this. FastAPI checks
    the invite for itself, and that the account is that candidate's.

    Claiming the invite is what "guided to apply" means now. A candidate
    who attached every required document on the form is submitted at once,
    since no upload will come along to do it."""
    set_audit_actor(db, None)  # self-service: no signed-in actor yet
    candidate = claimable_candidate(db, body.invite)
    account = db.get(User, body.user_id)
    if account is None or account.role is not Role.candidate or account.email != candidate.email:
        raise ApiError(422, "account_mismatch", "This account isn't the one the invite was for.")
    link_account(db, candidate, account)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()  # the account already has a candidate
        raise invite_used() from None
    return {"data": candidate}


def invite_used() -> ApiError:
    return ApiError(410, "invite_used", "This invite has already been used or is no longer valid.")


def claimable_candidate(db, invite: str) -> Candidate:
    """The candidate a screening invite is for, locked, if nobody has claimed
    it yet. Shared with registration (app/api/v1/accounts.py, step 8.3), which
    creates the account and claims in one transaction."""
    try:
        candidate_id = verify_candidate_invite_token(invite)
    except InvalidToken:
        raise ApiError(400, "invalid_invite", "This invite link is invalid or has expired.") from None
    candidate = db.scalar(select(Candidate).where(Candidate.id == candidate_id).with_for_update())
    if candidate is None or candidate.user_id:
        raise invite_used()
    return candidate


def link_account(db, candidate: Candidate, account: User) -> None:
    """Claims the candidate for the account. The caller commits."""
    candidate.user_id = account.id
    if candidate.lifecycle_status is CandidateLifecycleStatus.screened:
        candidate.lifecycle_status = CandidateLifecycleStatus.guided_to_apply
        db.flush()
        if document_completeness(db, candidate.id).complete:
            candidate.lifecycle_status = CandidateLifecycleStatus.submitted
