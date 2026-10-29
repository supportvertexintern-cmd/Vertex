"""Case writes for the pipeline handover, step 6.5
(docs/architecture/pipeline-handover.md): moving a case through the SOP's
stages, Operations' documentation review, rejecting a case and overturning
a rejection, reminders (step 6.5a); the contract and its signature, and the
90-day retention follow-up (6.5b). Opening a case happens when a candidate is
approved (candidates.py, set_status).

Built ahead of the switch (D3 B): every route answers 503 until
PIPELINE_WRITES_ENABLED is set at step 6.7, when Next.js's
/api/cases/[id]/{stage,ops-review,reject,overturn,remind,contract,
contract/sign,retention} start passing requests on.

They answer as those routes do: the same roles (tests fail if the lists
drift), access rules (a case is its candidate's, app/core/scope.py),
checks, messages and status codes. The emails go back in `notify` (D1): a
reminder is recorded here and sent by the website.

Every change is on the audit trail (Case, CaseStageEvent, CaseReminder,
Contract, RetentionFollowUp, Candidate, Application and ReferralCommission are in
AUDITED_MODELS).
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Request, status
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from sqlalchemy import select

from app.api.notices import (
    CaseRejectedEmail,
    CaseReminderEmail,
    CaseStageEmail,
    Notice,
    Notifying,
    PartnerCaseRejectedEmail,
    PartnerCaseStageEmail,
    commission_email,
)
from app.api.v1.candidates import _date
from app.core.api import ApiError, Data, UtcDateTime
from app.core.audit import AuditedDb
from app.core.auth import AuthUser, check_service_header
from app.core.pipeline import PipelineWrites
from app.core.rbac import OPERATIONS_ROLES, require_role
from app.core.scope import CandidateRef, can_access_case
from app.models.candidate import Application
from app.models.cases import Case, CaseReminder, CaseStageEvent, Contract, RetentionFollowUp
from app.models.enums import (
    ApplicationStatus,
    CandidateLifecycleStatus,
    CaseOpsReviewStatus,
    CaseReminderChannel,
    CaseStage,
    CaseStatus,
    ContractStatus,
    Role,
)
from app.models.identity import User
from app.services.case_lifecycle import can_set_case_stage
from app.services.referrals import STAGE_MILESTONES, commission_if_due

router = APIRouter()

STAGE_OWNERS: tuple[Role, ...] = tuple(OPERATIONS_ROLES)
# HR may also reject: undoing a case it opened by mistake.
REJECTERS: tuple[Role, ...] = (*OPERATIONS_ROLES, Role.hr)
OVERTURNERS: tuple[Role, ...] = (Role.hr, Role.director, Role.admin)
RETENTION_DAYS = 90


def _now() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


# --- input -------------------------------------------------------------------


class StageIn(BaseModel):
    stage: CaseStage
    notes: str | None = Field(None, max_length=2000)
    # When the move really happened, for backdating; now when left out.
    stage_date: datetime | None = None

    _dates = field_validator("stage_date", mode="before")(_date)


class OpsReviewIn(BaseModel):
    decision: Literal["confirmed", "rejected"]
    notes: str | None = Field(None, max_length=2000)

    @model_validator(mode="after")
    def _note_on_reject(self) -> OpsReviewIn:
        if self.decision == "rejected" and not (self.notes or "").strip():
            raise ValueError("A note is required when rejecting.")
        return self


class RejectIn(BaseModel):
    reason: str = Field(min_length=1, max_length=2000)


class OverturnIn(BaseModel):
    status: CaseStatus


class ReminderIn(BaseModel):
    channel: CaseReminderChannel
    recipient: Literal["candidate", "partner"]
    message: str | None = Field(None, max_length=1000)


# --- output ------------------------------------------------------------------


class StageEventRow(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    case_id: str
    stage: CaseStage
    owner_id: str | None
    entered_at: UtcDateTime
    completed_at: UtcDateTime | None
    notes: str | None


class CaseRow(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    application_id: str
    current_stage: CaseStage
    created_at: UtcDateTime
    updated_at: UtcDateTime
    stage_deadline: UtcDateTime | None
    ops_review_status: CaseOpsReviewStatus
    ops_reviewed_by_id: str | None
    ops_reviewed_at: UtcDateTime | None
    ops_review_notes: str | None
    status: CaseStatus
    rejected_at: UtcDateTime | None
    rejected_by_id: str | None
    rejection_reason: str | None


class CaseWithEvents(CaseRow):
    stage_events: list[StageEventRow]


class Named(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    full_name: str


class OpsReviewOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    ops_review_status: CaseOpsReviewStatus
    ops_reviewed_at: UtcDateTime | None
    ops_review_notes: str | None
    ops_reviewed_by: Named | None


class DecisionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    status: CaseStatus
    rejected_at: UtcDateTime | None
    rejection_reason: str | None
    rejected_by: Named | None


class ReminderRow(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    case_id: str
    channel: CaseReminderChannel
    recipient: str
    message: str | None
    sent_by: str
    sent_at: UtcDateTime


# --- helpers -----------------------------------------------------------------


def _load(db, case_id: str, user: AuthUser) -> Case:
    case = db.get(Case, case_id)
    if case is None:
        raise ApiError(404, "not_found", "Case not found.")
    if not can_access_case(db, user, CandidateRef.of(case.application.candidate)):
        raise ApiError(403, "forbidden", "Forbidden.")
    return case


def _programme(application: Application, fallback: str) -> str:
    if application.job:
        return application.job.title
    if application.preferred_sector:
        return application.preferred_sector.name
    return fallback


# --- stages ------------------------------------------------------------------


@router.patch("/cases/{case_id}/stage", response_model=Notifying[CaseWithEvents])
def set_stage(
    case_id: str,
    body: StageIn,
    user: Annotated[AuthUser, Depends(require_role(*STAGE_OWNERS))],
    db: AuditedDb,
    _on: PipelineWrites,
):
    """PATCH /api/cases/[id]/stage (SRS FR-4.2): closes the open stage and
    opens the next, earns a referral commission at its milestones, and
    starts the 90-day retention follow-up at the last stage (FR-4.7)."""
    case = _load(db, case_id, user)
    if case.status is CaseStatus.rejected:
        raise ApiError(422, "case_rejected", "This case has been rejected and is closed.")
    # Nothing moves until Operations have confirmed the documentation.
    if case.ops_review_status is not CaseOpsReviewStatus.confirmed:
        raise ApiError(422, "awaiting_ops_review", "Awaiting Operations/Director documentation confirmation before this case can proceed.")
    check = can_set_case_stage(user.role, case.current_stage, body.stage)
    if not check.allowed:
        raise ApiError(403, "invalid_transition", check.reason or "Transition not allowed.")

    now = _now()
    for event in db.scalars(select(CaseStageEvent).where(CaseStageEvent.case_id == case_id, CaseStageEvent.completed_at.is_(None))):
        event.completed_at = now
    db.add(CaseStageEvent(case_id=case_id, stage=body.stage, owner_id=user.user_id, notes=body.notes, entered_at=body.stage_date or now))
    case.current_stage = body.stage

    candidate = case.application.candidate
    notify: list[Notice] = []
    milestone = STAGE_MILESTONES.get(body.stage)
    if milestone is not None:
        notify += commission_email(commission_if_due(db, candidate.id, milestone, case_id=case_id))
    if body.stage is CaseStage.departure_arrival_support and case.retention_follow_up is None:
        db.add(RetentionFollowUp(case_id=case_id, due_at=now + timedelta(days=RETENTION_DAYS)))

    # The candidate with an account hears about it; a partner-sourced
    # candidate is reached through their partner only.
    programme = _programme(case.application, "your programme")
    if candidate.user is not None:
        notify.append(CaseStageEmail(email=candidate.user.email, full_name=candidate.user.full_name, job_title=programme, stage=body.stage))
    if candidate.partner is not None:
        name = candidate.full_name or (candidate.user.full_name if candidate.user else None) or "Candidate"
        notify.append(
            PartnerCaseStageEmail(
                email=candidate.partner.contact_email, partner_name=candidate.partner.name, candidate_name=name, job_title=programme, stage=body.stage
            )
        )

    db.commit()
    db.refresh(case)
    events = sorted(case.stage_events, key=lambda e: e.entered_at)
    return {"data": CaseWithEvents.model_validate(case).model_copy(update={"stage_events": [StageEventRow.model_validate(e) for e in events]}), "notify": notify}


# --- Operations' documentation review ----------------------------------------


@router.patch("/cases/{case_id}/ops-review", response_model=Data[OpsReviewOut])
def ops_review(
    case_id: str,
    body: OpsReviewIn,
    user: Annotated[AuthUser, Depends(require_role(*STAGE_OWNERS))],
    db: AuditedDb,
    _on: PipelineWrites,
):
    """PATCH /api/cases/[id]/ops-review: confirms or flags the paperwork
    before the operational process begins. It can be changed later; it
    never opens or closes a case."""
    case = _load(db, case_id, user)
    if case.status is CaseStatus.rejected:
        raise ApiError(422, "case_rejected", "This case has been rejected and is closed.")
    case.ops_review_status = CaseOpsReviewStatus(body.decision)
    case.ops_reviewed_by_id = user.user_id
    case.ops_reviewed_at = _now()
    case.ops_review_notes = body.notes
    db.commit()
    db.refresh(case)
    return {"data": case}


# --- rejection ---------------------------------------------------------------


@router.patch("/cases/{case_id}/reject", response_model=Notifying[DecisionOut])
def reject(
    case_id: str,
    body: RejectIn,
    user: Annotated[AuthUser, Depends(require_role(*REJECTERS))],
    db: AuditedDb,
    _on: PipelineWrites,
):
    """PATCH /api/cases/[id]/reject: closes the case for good, and the
    candidate and application with it. HR and the partner are told."""
    case = _load(db, case_id, user)
    if case.status is CaseStatus.rejected:
        raise ApiError(409, "already_rejected", "This case has already been rejected.")
    case.status = CaseStatus.rejected
    case.rejected_at = _now()
    case.rejected_by_id = user.user_id
    case.rejection_reason = body.reason
    application = case.application
    candidate = application.candidate
    candidate.lifecycle_status = CandidateLifecycleStatus.rejected
    application.application_status = ApplicationStatus.rejected

    candidate_name = candidate.full_name or "the candidate"
    programme = _programme(application, "their programme")
    notify: list[Notice] = [
        CaseRejectedEmail(email=email, full_name=full_name, candidate_name=candidate_name, job_title=programme, reason=body.reason)
        for email, full_name in db.execute(select(User.email, User.full_name).where(User.role == Role.hr))
    ]
    if candidate.partner is not None:
        notify.append(
            PartnerCaseRejectedEmail(
                email=candidate.partner.contact_email, partner_name=candidate.partner.name, candidate_name=candidate_name, job_title=programme, reason=body.reason
            )
        )
    db.commit()
    db.refresh(case)
    return {"data": case, "notify": notify}


@router.patch("/cases/{case_id}/overturn", response_model=Data[DecisionOut])
def overturn(
    case_id: str,
    body: OverturnIn,
    user: Annotated[AuthUser, Depends(require_role(*OVERTURNERS))],
    db: AuditedDb,
    _on: PipelineWrites,
):
    """PATCH /api/cases/[id]/overturn: clears a rejection. Reopening it puts
    the candidate and application back to "approved", where opening the
    case left them."""
    case = _load(db, case_id, user)
    if case.status is not CaseStatus.rejected:
        raise ApiError(400, "not_rejected", "This case is not rejected.")
    case.status = body.status
    case.rejected_at = None
    case.rejected_by_id = None
    case.rejection_reason = None
    if body.status is CaseStatus.active:
        case.application.candidate.lifecycle_status = CandidateLifecycleStatus.approved
        case.application.application_status = ApplicationStatus.approved
    db.commit()
    db.refresh(case)
    return {"data": case}


# --- reminders ---------------------------------------------------------------


@router.post("/cases/{case_id}/remind", response_model=Notifying[ReminderRow], status_code=status.HTTP_201_CREATED)
def remind(
    case_id: str,
    body: ReminderIn,
    user: Annotated[AuthUser, Depends(require_role(*STAGE_OWNERS))],
    db: AuditedDb,
    _on: PipelineWrites,
):
    """POST /api/cases/[id]/remind: Operations chasing a delayed document or
    payment, by email to the candidate or their partner."""
    case = _load(db, case_id, user)
    candidate = case.application.candidate
    if body.recipient == "partner":
        if candidate.partner is None:
            raise ApiError(422, "no_partner", "This candidate has no associated partner to remind.")
        email, name = candidate.partner.contact_email, candidate.partner.contact_name
    else:
        email = candidate.user.email if candidate.user else candidate.email
        name = (candidate.user.full_name if candidate.user else candidate.full_name) or "there"
    if not email:
        raise ApiError(422, "no_email", "No email on file for the selected recipient.")

    reminder = CaseReminder(case_id=case_id, channel=body.channel, recipient=email, message=body.message, sent_by=user.user_id)
    db.add(reminder)
    db.commit()
    db.refresh(reminder)
    candidate_name = (candidate.user.full_name if candidate.user else candidate.full_name) or "the candidate"
    programme = case.application.job.title if case.application.job else "their programme"
    notice = CaseReminderEmail(
        email=email, recipient_name=name, candidate_name=candidate_name, programme_title=programme, channel=body.channel, message=body.message
    )
    return {"data": reminder, "notify": [notice]}


# --- the contract (SRS FR-4.3) ------------------------------------------------


class ContractIn(BaseModel):
    content: str = Field(min_length=20, max_length=20000)


class SignIn(BaseModel):
    signed_by_name: str = Field(min_length=2, max_length=200)


class ContractRow(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    case_id: str
    content: str
    status: ContractStatus
    signed_by_name: str | None
    signed_at: UtcDateTime | None
    signed_ip: str | None
    created_by: str
    created_at: UtcDateTime
    updated_at: UtcDateTime


@router.post("/cases/{case_id}/contract", response_model=Data[ContractRow], status_code=status.HTTP_201_CREATED)
def issue_contract(
    case_id: str,
    body: ContractIn,
    user: Annotated[AuthUser, Depends(require_role(*STAGE_OWNERS))],
    db: AuditedDb,
    _on: PipelineWrites,
):
    """POST /api/cases/[id]/contract: Operations issue the contract, sent
    for the candidate to sign in the portal."""
    case = _load(db, case_id, user)
    if case.contract is not None:
        raise ApiError(409, "contract_exists", "A contract already exists for this case.")
    contract = Contract(case_id=case_id, content=body.content, status=ContractStatus.sent, created_by=user.user_id)
    db.add(contract)
    db.commit()
    db.refresh(contract)
    return {"data": contract}


def _signer_ip(request: Request) -> str:
    """Where the signature came from. Through the website the connection is
    Next.js's own, so the browser's address it forwards is used, and only
    then: a request without Next.js's credential can't name its own."""
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded and check_service_header(request) is not None:
        return forwarded
    return request.client.host if request.client else "unknown"


@router.post("/cases/{case_id}/contract/sign", response_model=Data[ContractRow])
def sign_contract(
    case_id: str,
    body: SignIn,
    request: Request,
    user: Annotated[AuthUser, Depends(require_role(Role.candidate))],
    db: AuditedDb,
    _on: PipelineWrites,
):
    """POST /api/cases/[id]/contract/sign: a simple electronic signature
    (typed legal name, the signed-in session, time and address). Only the
    candidate the contract is for can sign; staff never sign for them."""
    case = db.get(Case, case_id)
    if case is None:
        raise ApiError(404, "not_found", "Case not found.")
    if case.application.candidate.user_id != user.user_id:
        raise ApiError(403, "forbidden", "Forbidden.")
    contract = case.contract
    if contract is None:
        raise ApiError(404, "not_found", "No contract to sign yet.")
    if contract.status is ContractStatus.signed:
        raise ApiError(409, "already_signed", "Contract already signed.")
    contract.status = ContractStatus.signed
    contract.signed_by_name = body.signed_by_name
    contract.signed_at = _now()
    contract.signed_ip = _signer_ip(request)
    db.commit()
    db.refresh(contract)
    return {"data": contract}


# --- retention (SRS FR-4.7) ---------------------------------------------------


class RetentionIn(BaseModel):
    notes: str | None = Field(None, max_length=2000)


class RetentionRow(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    case_id: str
    due_at: UtcDateTime
    completed_at: UtcDateTime | None
    notes: str | None


@router.patch("/cases/{case_id}/retention", response_model=Data[RetentionRow])
def complete_retention(
    case_id: str,
    body: RetentionIn,
    user: Annotated[AuthUser, Depends(require_role(*STAGE_OWNERS))],
    db: AuditedDb,
    _on: PipelineWrites,
):
    """PATCH /api/cases/[id]/retention: the 90-day follow-up is done."""
    case = _load(db, case_id, user)
    follow_up = case.retention_follow_up
    if follow_up is None:
        raise ApiError(404, "not_found", "No retention follow-up scheduled yet — the case must reach travel & settlement first.")
    follow_up.completed_at = _now()
    if body.notes is not None:
        follow_up.notes = body.notes
    db.commit()
    db.refresh(follow_up)
    return {"data": follow_up}
