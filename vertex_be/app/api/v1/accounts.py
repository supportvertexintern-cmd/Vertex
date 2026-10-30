"""Accounts, owned by FastAPI from users and sessions step 8.3
(docs/architecture/users-handover.md): registration from a screening
invite, a staff or partner account's first password, email verification,
and forgot and reset password. They replace the work of Next.js's
/api/auth/register (POST), /api/auth/verify-email, /api/auth/forgot-password
and /api/auth/reset-password, which pass requests on while their flags are
on (FLAG_ACCOUNTS_FASTAPI_REGISTRATION and _RESET, lib/flags.ts).

They answer as those routes did: the same messages and status codes. The
website keeps the per-address rate limits and sends the emails each answer
lists in `notify` (D4 A): FastAPI signs the links. Nobody is signed in, so
only the website may call them (calling_service).

What changes (users-handover.md §6):
  - Registration creates the account and claims the candidate in one
    transaction: no half-made account to delete when the claim fails.
  - A reset link works once (#9): it names the password it was issued for,
    so it stops working when that password changes, by this link or
    otherwise. Links the website signed before the switch carry no such
    name and keep working until they expire (24 hours).
  - A verification link must be for the account's current address.
  - Unknown fields are ignored (#11): nothing here takes a role or a status
    from the request.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Request, status
from pydantic import AfterValidator, BaseModel, ConfigDict
from pydantic_core import PydanticCustomError
from sqlalchemy import exists, select
from sqlalchemy.exc import IntegrityError

from app.api.deps import DbSession
from app.api.notices import Notice, Notifying, PasswordResetEmail, VerificationEmail
from app.api.v1.candidates import claimable_candidate, link_account
from app.api.v1.sessions import security_event
from app.core.api import ApiError, Email
from app.core.audit import set_audit_actor
from app.core.auth import calling_service
from app.core.pipeline import PipelineWrites
from app.core.tokens import (
    InvalidToken,
    password_fingerprint,
    sign_reset_token,
    sign_verification_token,
    verify_account_setup_token,
    verify_candidate_invite_token,
    verify_email_token,
)
from app.models.candidate import Application
from app.models.enums import Role
from app.models.identity import Country, User
from app.services.sessions import email_fingerprint, hash_password

router = APIRouter(dependencies=[Depends(calling_service)])

INVITE_INVALID = "This invite link is invalid or has expired."
INVITE_USED = "This invite has already been used or is no longer valid."
RESET_INVALID = "This reset link is invalid or has expired. Request a new one."
FORGOT_MESSAGE = "If an account exists for that email, we've sent a password reset link."


# --- input --------------------------------------------------------------------


def _password(value: str) -> str:
    """The password rules in lib/validations.ts, first failing rule's message."""
    if len(value) < 8:
        raise PydanticCustomError("value_error", "Password must be at least 8 characters")
    if not any("A" <= c <= "Z" for c in value):
        raise PydanticCustomError("value_error", "Password must contain at least one uppercase letter")
    if not any("0" <= c <= "9" for c in value):
        raise PydanticCustomError("value_error", "Password must contain at least one number")
    return value


def _required(message: str):
    def check(value: str) -> str:
        if not value:
            raise PydanticCustomError("value_error", message)
        return value

    return AfterValidator(check)


Password = Annotated[str, AfterValidator(_password)]


class RegisterIn(BaseModel):
    password: Password
    invite: Annotated[str, _required("An invite link is required to create an account.")]


class SetupIn(BaseModel):
    password: Password
    setup: Annotated[str, _required("A setup link is required.")]


class VerifyIn(BaseModel):
    token: str | None = None


class ForgotIn(BaseModel):
    email: Email


class ResetIn(BaseModel):
    password: Password
    token: Annotated[str, _required("A reset link is required.")]


# --- output -------------------------------------------------------------------


class AccountOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    full_name: str
    email: str
    role: Role


class Done(BaseModel):
    message: str


class Registered(BaseModel):
    message: str
    user: AccountOut


# --- registration -------------------------------------------------------------


def _latest_country(db, candidate_id: str) -> str | None:
    """The country on the candidate's latest application, as registration
    copied it onto the account."""
    latest = db.scalar(select(Application).where(Application.candidate_id == candidate_id).order_by(Application.submitted_at.desc()).limit(1))
    if latest is None or latest.current_location_country_id is None:
        return None
    return db.scalar(select(Country.name).where(Country.id == latest.current_location_country_id))


def _email_taken(db, email: str) -> bool:
    return bool(db.scalar(select(exists().where(User.email == email))))


@router.post("/accounts/register", status_code=status.HTTP_201_CREATED, response_model=Notifying[Registered])
def register(body: RegisterIn, db: DbSession, _on: PipelineWrites):
    """A screened candidate creates their account from the invite. Name,
    email, phone and country come from the candidate record, never the
    request."""
    try:
        verify_candidate_invite_token(body.invite)
    except InvalidToken:
        raise ApiError(400, "invalid_invite", INVITE_INVALID) from None
    password_hash = hash_password(body.password)  # before any row is locked

    set_audit_actor(db, None)  # self-service: nobody is signed in
    candidate = claimable_candidate(db, body.invite)
    if not candidate.email or not candidate.full_name:
        raise ApiError(422, "missing_details", "Your candidate record is missing required details. Please contact your recruiter.")
    if _email_taken(db, candidate.email):
        raise ApiError(409, "duplicate", "An account with this email already exists. Please log in instead.")

    user = User(
        full_name=candidate.full_name, email=candidate.email, password_hash=password_hash,
        phone=candidate.phone, country=_latest_country(db, candidate.id), role=Role.candidate,
    )
    db.add(user)
    try:
        db.flush()
        link_account(db, candidate, user)
        db.commit()
    except IntegrityError:
        db.rollback()  # a request for the same address or invite won the race
        if _email_taken(db, candidate.email):
            raise ApiError(409, "duplicate", "An account with this email already exists. Please log in instead.") from None
        raise ApiError(410, "invite_used", INVITE_USED) from None
    db.refresh(user)

    notify: list[Notice] = [VerificationEmail(email=user.email, full_name=user.full_name, token=sign_verification_token(user.id, user.email))]
    message = "Account created successfully. Please check your email to verify your account."
    return {"data": {"message": message, "user": user}, "notify": notify}


@router.post("/accounts/setup", response_model=Notifying[Registered])
def complete_setup(body: SetupIn, db: DbSession):
    """A staff or partner account, created by an admin or director, sets its
    first password from the setup link. The link works until a password is
    set."""
    try:
        user_id = verify_account_setup_token(body.setup)
    except InvalidToken:
        raise ApiError(400, "invalid_invite", INVITE_INVALID) from None
    password_hash = hash_password(body.password)

    set_audit_actor(db, None)
    user = db.scalar(select(User).where(User.id == user_id).with_for_update())
    if user is None or user.password_hash:
        raise ApiError(410, "invite_used", INVITE_USED)
    user.password_hash = password_hash
    user.email_verified = True
    db.commit()
    db.refresh(user)
    return {"data": {"message": "Your password is set — you can now log in.", "user": user}}


# --- email verification -------------------------------------------------------


@router.post("/accounts/verify-email", response_model=Notifying[Done])
def verify_email(body: VerifyIn, db: DbSession):
    if not body.token:
        raise ApiError(400, "token_required", "Verification token is required.")
    try:
        link = verify_email_token(body.token, "email_verification")
    except InvalidToken:
        raise ApiError(400, "invalid_token", "Invalid or expired verification token.") from None

    user = db.scalar(select(User).where(User.id == link.user_id).with_for_update())
    if user is None:
        raise ApiError(404, "not_found", "User not found.")
    if user.email_verified:
        return {"data": {"message": "Email is already verified."}}
    if user.email != link.email:  # the address changed since the link was sent
        raise ApiError(400, "invalid_token", "Invalid or expired verification token.")
    set_audit_actor(db, user.id)
    user.email_verified = True
    db.commit()
    return {"data": {"message": "Email verified successfully! You can now log in."}}


# --- forgot and reset password ------------------------------------------------


@router.post("/accounts/forgot-password", response_model=Notifying[Done])
def forgot_password(body: ForgotIn, request: Request, db: DbSession):
    """The same answer whether or not the address has an account; an email
    only for an account that can sign in with a password."""
    user = db.scalar(select(User).where(User.email == body.email))
    can_reset = bool(user and user.password_hash)
    security_event(
        request, "password_reset_requested", actor_id=None, entity_type="Auth",
        entity_id=f"user:{user.id}" if user else "unknown_account",
        detail={"email_fp": email_fingerprint(body.email), "email_sent": can_reset},
    )
    notify: list[Notice] = []
    if user and can_reset:
        notify.append(PasswordResetEmail(email=user.email, full_name=user.full_name, token=sign_reset_token(user.id, user.email, user.password_hash)))
    return {"data": {"message": FORGOT_MESSAGE}, "notify": notify}


@router.post("/accounts/reset-password", response_model=Notifying[Done])
def reset_password(body: ResetIn, request: Request, db: DbSession):
    """Sets a new password from the emailed link. Every session of the
    account ends (the token_version trigger)."""
    try:
        link = verify_email_token(body.token, "password_reset")
    except InvalidToken:
        security_event(request, "password_reset_completed", actor_id=None, entity_type="Auth", entity_id="invalid_link",
                       detail={"outcome": "invalid_or_expired_link"})
        raise ApiError(400, "invalid_link", RESET_INVALID) from None
    password_hash = hash_password(body.password)

    user = db.scalar(select(User).where(User.id == link.user_id).with_for_update())
    if user is None:
        raise ApiError(404, "not_found", "Account not found.")
    if link.pwd is not None and link.pwd != password_fingerprint(user.password_hash):
        db.rollback()
        security_event(request, "password_reset_completed", actor_id=None, entity_type="Auth", entity_id=f"user:{user.id}",
                       detail={"outcome": "link_already_used"})
        raise ApiError(400, "invalid_link", RESET_INVALID)
    set_audit_actor(db, user.id)
    user.password_hash = password_hash
    db.commit()
    security_event(request, "password_reset_completed", actor_id=user.id, entity_type="Auth", entity_id=f"user:{user.id}",
                   detail={"outcome": "password_changed"})
    return {"data": {"message": "Password reset successfully. You can now log in."}}
