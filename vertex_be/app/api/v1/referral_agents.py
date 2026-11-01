"""Referral agents, owned by FastAPI from users and sessions step 8.1
(docs/architecture/users-handover.md): a director or admin sets an agent's
referral target for a period, replacing POST
/api/admin/referral-agents/[id]/targets, which now passes requests on.

It answers as that route did: the same roles (a test fails if the lists
drift), messages, status codes and Prisma-shaped JSON. One difference: a
date the website's new Date() couldn't read was a 500 there and is a 422
here. The target-vs-actual read (GET) stays in Next.js. Every change is on
the audit trail (ReferralAgentTarget is in AUDITED_MODELS).

From step 8.4 the agent itself is FastAPI's too: the public application
and its email verification (only the website may call these, as with
accounts.py), and a director or admin approving, rejecting, suspending or
reactivating one. They replace POST /api/referral-agents/register, GET
/api/referral-agents/verify-email, POST
/api/admin/referral-agents/[id]/approve and PATCH
/api/admin/referral-agents/[id], which pass requests on while
FLAG_ACCOUNTS_FASTAPI_REFERRAL_AGENTS is on. The website keeps the
per-address rate limits and sends the emails each answer lists in
`notify`; FastAPI signs the verification link.

What changes (users-handover.md §6):
  - Unknown fields are ignored (#11): an application can't set its status,
    referral code or verification, and only approval gives a login.
  - The agent's row is locked while a decision is checked and made, so two
    approvals can't both create a login.
  - A date of birth the website's new Date() couldn't read was a 500 and
    is a 422.
"""

from __future__ import annotations

import secrets
from datetime import datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, status
from pydantic import AfterValidator, BaseModel, ConfigDict, Field, StringConstraints, field_validator
from pydantic_core import PydanticCustomError
from sqlalchemy import exists, func, select
from sqlalchemy.exc import IntegrityError

from app.api.deps import DbSession
from app.api.notices import (
    AccountSetupEmail,
    Notice,
    Notifying,
    ReferralAgentAdminEmail,
    ReferralAgentApplicationEmail,
    ReferralAgentApprovedEmail,
    ReferralAgentRejectedEmail,
    ReferralAgentSuspendedEmail,
)
from app.core.api import ApiError, Data, Email, UtcDateTime, js_date
from app.core.audit import AuditedDb, set_audit_actor
from app.core.auth import AuthUser, calling_service
from app.core.clock import utc_now_ms
from app.core.rbac import REFERRAL_AGENT_MANAGER_ROLES, require_role
from app.core.tokens import (
    InvalidToken,
    sign_account_setup_token,
    sign_referral_agent_verification_token,
    verify_referral_agent_verification_token,
)
from app.models.enums import ReferralAgentStatus, Role
from app.models.identity import Country, User
from app.models.referral import ReferralAgent, ReferralAgentTarget

router = APIRouter()
# Nobody is signed in to apply or to verify: only the website may call these.
public = APIRouter(dependencies=[Depends(calling_service)])

Manager = Annotated[AuthUser, Depends(require_role(*REFERRAL_AGENT_MANAGER_ROLES))]


def _required_date(message: str):
    """createReferralAgentTargetSchema's z.string().min(1, message), then the
    website's new Date(value)."""

    def check(value: object) -> object:
        if isinstance(value, str):
            if not value:
                raise PydanticCustomError("value_error", message)
            return js_date(value)
        return value

    return check


class TargetIn(BaseModel):
    period_start: datetime
    period_end: datetime
    target_referrals: int = Field(ge=0)  # z.coerce.number().int().min(0)

    _start = field_validator("period_start", mode="before")(_required_date("Start date is required"))
    _end = field_validator("period_end", mode="before")(_required_date("End date is required"))


class TargetRow(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    referral_agent_id: str
    period_start: UtcDateTime
    period_end: UtcDateTime
    target_referrals: int
    set_by: str
    created_at: UtcDateTime
    updated_at: UtcDateTime


@router.post("/referral-agents/{agent_id}/targets", status_code=status.HTTP_201_CREATED, response_model=Data[TargetRow])
def create_target(agent_id: str, body: TargetIn, user: Manager, db: AuditedDb):
    if db.get(ReferralAgent, agent_id) is None:
        raise ApiError(404, "not_found", "Referral agent not found.")
    target = ReferralAgentTarget(
        referral_agent_id=agent_id,
        period_start=body.period_start,
        period_end=body.period_end,
        target_referrals=body.target_referrals,
        set_by=user.user_id,
    )
    db.add(target)
    db.commit()
    db.refresh(target)
    return {"data": target}


# --- the application (public) --------------------------------------------------


def _min(length: int, message: str):
    """z.string().min(length, message)."""

    def check(value: str) -> str:
        if len(value) < length:
            raise PydanticCustomError("value_error", message)
        return value

    return AfterValidator(check)


def _optional_date(value: object) -> object:
    """date_of_birth: z.string().optional(), then new Date(value)."""
    return js_date(value) if isinstance(value, str) else value


class ApplicationIn(BaseModel):
    """registerReferralAgentSchema."""

    full_name: Annotated[str, StringConstraints(max_length=150), _min(2, "Full name is required")]
    email: Email
    phone: Annotated[str, StringConstraints(max_length=30), _min(3, "Phone number is required")]
    whatsapp_number: Annotated[str, StringConstraints(max_length=30)] | None = None
    country: Annotated[str, StringConstraints(max_length=100), _min(2, "Country is required")]
    city: Annotated[str, StringConstraints(max_length=100)] | None = None
    date_of_birth: datetime | None = None
    nationality: Annotated[str, StringConstraints(max_length=100)] | None = None
    preferred_contact_channel: Literal["email", "whatsapp", "phone"] | None = None
    previous_experience: Annotated[str, StringConstraints(max_length=2000)] | None = None
    current_occupation: Annotated[str, StringConstraints(max_length=150)] | None = None
    network_size: Annotated[int, Field(ge=0)] | None = None  # z.coerce.number().int().min(0)
    social_media_profiles: Annotated[str, StringConstraints(max_length=1000)] | None = None
    promotion_plan: Annotated[str, StringConstraints(max_length=2000)] | None = None
    payment_details: Annotated[str, StringConstraints(max_length=500)] | None = None

    _dob = field_validator("date_of_birth", mode="before")(_optional_date)


class Applied(BaseModel):
    id: str
    referral_code: str


class VerifyIn(BaseModel):
    token: str | None = None


class Message(BaseModel):
    message: str


APPLIED_TWICE = "An application with this email already exists."


def _applied(db, email: str) -> bool:
    return bool(db.scalar(select(exists().where(ReferralAgent.email == email))))


def referral_code(db, country: str) -> str:
    """generateReferralCode(): VTX-<first three letters of the country>-<four
    digits>, five tries for an unused one, then the clock's last digits."""
    fragment = ("".join(c for c in country if c.isascii() and c.isalpha()).upper() + "XXX")[:3]
    for _ in range(5):
        code = f"VTX-{fragment}-{1000 + secrets.randbelow(9000)}"
        if not db.scalar(select(exists().where(ReferralAgent.referral_code == code))):
            return code
    return f"VTX-{fragment}-{str(int(utc_now_ms().timestamp() * 1000))[-4:]}"


@public.post("/referral-agents/apply", status_code=status.HTTP_201_CREATED, response_model=Notifying[Applied])
def apply(body: ApplicationIn, db: DbSession):
    """A pending application, its referral code made here. The applicant is
    emailed the verification link, and the team told."""
    if _applied(db, body.email):
        raise ApiError(409, "duplicate", APPLIED_TWICE)
    set_audit_actor(db, None)  # self-service: nobody is signed in
    country = db.scalar(select(Country).where(func.lower(Country.name) == body.country.lower()).limit(1))
    fields = body.model_dump(exclude_none=True)
    for attempt in range(3):
        agent = ReferralAgent(**fields, country_id=country.id if country else None, referral_code=referral_code(db, body.country))
        db.add(agent)
        try:
            db.commit()
            break
        except IntegrityError:
            db.rollback()  # the address, or the code, was taken meanwhile
            set_audit_actor(db, None)
            if _applied(db, body.email) or attempt == 2:
                raise ApiError(409, "duplicate", APPLIED_TWICE) from None
    db.refresh(agent)

    notify: list[Notice] = [
        ReferralAgentApplicationEmail(email=agent.email, full_name=agent.full_name, token=sign_referral_agent_verification_token(agent.id)),
        ReferralAgentAdminEmail(full_name=agent.full_name, country=agent.country),
    ]
    return {"data": {"id": agent.id, "referral_code": agent.referral_code}, "notify": notify}


@public.post("/referral-agents/verify-email", response_model=Data[Message])
def verify_email(body: VerifyIn, db: DbSession):
    """The application's email, verified from the link. Needed before
    approval."""
    if not body.token:
        raise ApiError(400, "token_required", "Verification token is required.")
    try:
        agent_id = verify_referral_agent_verification_token(body.token)
    except InvalidToken:
        raise ApiError(400, "invalid_token", "Invalid or expired verification token.") from None

    agent = db.scalar(select(ReferralAgent).where(ReferralAgent.id == agent_id).with_for_update())
    if agent is None:
        raise ApiError(404, "not_found", "Referral agent application not found.")
    if agent.email_verified:
        return {"data": {"message": "Email is already verified."}}
    set_audit_actor(db, None)
    agent.email_verified = True
    db.commit()
    return {"data": {"message": "Email verified! Our team will review your application and let you know the outcome."}}


# --- decisions (director or admin) ---------------------------------------------


class AgentRow(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    full_name: str
    email: str
    phone: str
    whatsapp_number: str | None
    country: str
    country_id: str | None
    city: str | None
    date_of_birth: UtcDateTime | None
    nationality: str | None
    preferred_contact_channel: str | None
    previous_experience: str | None
    current_occupation: str | None
    network_size: int | None
    social_media_profiles: str | None
    promotion_plan: str | None
    payment_details: str | None
    status: ReferralAgentStatus
    referral_code: str
    email_verified: bool
    approved_by_id: str | None
    approved_at: UtcDateTime | None
    rejection_reason: str | None
    suspended_reason: str | None
    user_id: str | None
    created_at: UtcDateTime
    updated_at: UtcDateTime


class ApproveIn(BaseModel):
    """approveReferralAgentSchema: the login's address, the application's
    unless given."""

    email: Email | None = None


class DecisionIn(BaseModel):
    """updateReferralAgentStatusSchema. The reason is required to reject or
    suspend, and ignored when reactivating."""

    status: Literal["rejected", "suspended", "active"]
    reason: Annotated[str, StringConstraints(max_length=2000)] | None = None


def _locked(db, agent_id: str) -> ReferralAgent:
    agent = db.scalar(select(ReferralAgent).where(ReferralAgent.id == agent_id).with_for_update())
    if agent is None:
        raise ApiError(404, "not_found", "Referral agent not found.")
    return agent


@router.post("/referral-agents/{agent_id}/approve", status_code=status.HTTP_201_CREATED, response_model=Notifying[AgentRow])
def approve(agent_id: str, body: ApproveIn, user: Manager, db: AuditedDb):
    """Activates a verified, pending application and creates the agent's
    login, without a password: the approval email carries their code and
    link, the setup email lets them set a password."""
    agent = _locked(db, agent_id)
    if agent.status is not ReferralAgentStatus.pending_approval:
        raise ApiError(409, "invalid_transition", "Only a pending application can be approved.")
    if not agent.email_verified:
        raise ApiError(422, "email_not_verified", "This applicant hasn't verified their email yet.")
    if agent.user_id:
        raise ApiError(409, "already_provisioned", "This agent already has a login.")
    if "email" in body.model_fields_set and body.email is None:
        raise ApiError(422, "validation_error", "Validation failed", {"email": ["Invalid input: expected a value, received null"]})
    email = body.email or agent.email
    duplicate = ApiError(409, "duplicate", "A user with this email already exists.")
    if db.scalar(select(exists().where(User.email == email))):
        raise duplicate

    login = User(full_name=agent.full_name, email=email, role=Role.referral_agent, email_verified=True)
    db.add(login)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()  # the address was taken meanwhile
        raise duplicate from None
    agent.status = ReferralAgentStatus.active
    agent.user_id = login.id
    agent.approved_by_id = user.user_id
    agent.approved_at = utc_now_ms()
    db.commit()
    db.refresh(agent)

    notify: list[Notice] = [
        ReferralAgentApprovedEmail(email=agent.email, full_name=agent.full_name, referral_code=agent.referral_code),
        AccountSetupEmail(email=login.email, full_name=login.full_name, token=sign_account_setup_token(login.id)),
    ]
    return {"data": agent, "notify": notify}


@router.patch("/referral-agents/{agent_id}", response_model=Notifying[AgentRow])
def decide(agent_id: str, body: DecisionIn, _user: Manager, db: AuditedDb):
    """Reject a pending application, suspend an active agent, or reactivate a
    suspended one. Suspending keeps the history: earned commissions stay
    payable."""
    agent = _locked(db, agent_id)
    target = body.status
    if target == "rejected":
        if agent.status is not ReferralAgentStatus.pending_approval:
            raise ApiError(422, "invalid_transition", "Only a pending application can be rejected.")
        if not body.reason:
            raise ApiError(422, "reason_required", "A reason is required to reject an application.")
        agent.rejection_reason = body.reason
    elif target == "suspended":
        if agent.status is not ReferralAgentStatus.active:
            raise ApiError(422, "invalid_transition", "Only an active agent can be suspended.")
        if not body.reason:
            raise ApiError(422, "reason_required", "A reason is required to suspend an agent.")
        agent.suspended_reason = body.reason
    else:
        if agent.status is not ReferralAgentStatus.suspended:
            raise ApiError(422, "invalid_transition", "Only a suspended agent can be reactivated.")
        agent.suspended_reason = None
    agent.status = ReferralAgentStatus(target)
    db.commit()
    db.refresh(agent)

    notify: list[Notice] = []
    if target == "rejected":
        notify.append(ReferralAgentRejectedEmail(email=agent.email, full_name=agent.full_name, reason=body.reason))
    elif target == "suspended":
        notify.append(ReferralAgentSuspendedEmail(email=agent.email, full_name=agent.full_name, reason=body.reason))
    return {"data": agent, "notify": notify}
