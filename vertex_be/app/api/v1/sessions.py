"""Sign-in, refresh, sign-out and the session lists, owned by FastAPI since
users and sessions step 8.2 (docs/architecture/users-handover.md).

They replace the work of Next.js's /api/auth/login, /api/auth/app/login,
/api/auth/refresh, /api/auth/app/refresh, /api/auth/logout,
/api/auth/app/logout, /api/auth/sessions, /api/auth/sessions/[id],
/api/admin/users/[id]/sessions and the Google callback, which now pass
requests on. The website keeps what only it can do: the per-address rate
limits (D2), the cookies and the app's token body, Google's state cookie,
and raising alerts from what these answers report (as it does for malware).

Sign-in, refresh, sign-out and Google answer only the website
(calling_service): nobody holds a session yet. The client's address is the
one the website forwards, read only alongside its credential. The session
lists need the user's own session; the admin's, an admin's.

Every decision is a security event with the address and, for failures, a
fingerprint of the email (never what was typed). An unknown account and a
wrong password get the same answer and take as long. A per-account limit on
failed sign-ins backs up the website's per-address one (D2).
"""

from __future__ import annotations

import logging
import threading
import time
from collections import deque
from dataclasses import asdict
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, field_validator
from pydantic_core import PydanticCustomError
from sqlalchemy import select

from app.api.deps import DbSession
from app.core.api import ApiError, Data, Email, UtcDateTime
from app.core.audit import record_security_event, set_audit_actor
from app.core.auth import AuthUser, CurrentUser, OptionalUser, calling_service, check_service_header
from app.core.logging import log_event
from app.core.rbac import require_role
from app.models.enums import Role
from app.models.identity import User
from app.services.google_signin import GoogleClient, GoogleFailed, google_client
from app.services.sessions import (
    IssuedSession,
    RefreshRefused,
    check_password,
    email_fingerprint,
    family_of,
    list_sessions,
    refresh_session,
    revoke_all_for_user,
    revoke_family,
    start_session,
)

router = APIRouter()

Service = Depends(calling_service)
Admin = Annotated[AuthUser, Depends(require_role(Role.admin))]  # requireAdmin()

INVALID_LOGIN = "Invalid email or password."
SESSION_ENDED = "Please sign in again."


# --- the caller, and what gets recorded --------------------------------------


def _client_ip(request: Request) -> str | None:
    """The browser's address as the website forwards it; never the
    connection's, which is the website's own."""
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded and check_service_header(request) is not None:
        return forwarded.split(",")[0].strip()[:64] or None
    return None


def _user_agent(request: Request) -> str | None:
    return request.headers.get("user-agent") if check_service_header(request) is not None else None


def security_event(request: Request, action: str, *, actor_id: str | None, entity_type: str, entity_id: str, detail: dict[str, Any]) -> None:
    detail = {**detail, "ip": _client_ip(request), "path": request.url.path}
    record_security_event(action, actor_id=actor_id, entity_type=entity_type, entity_id=entity_id, detail=detail)


# --- the per-account limit (D2) -----------------------------------------------

# Failed sign-ins per account, in this process, as lib/rate-limit.ts keeps
# the website's per-address ones. The security monitor's brute-force alert
# fires at the same count over the same window.
ACCOUNT_WINDOW_SECONDS = 15 * 60
ACCOUNT_MAX_FAILURES = 10
_failures: dict[str, deque[float]] = {}
_failures_lock = threading.Lock()


def _recent_failures(fp: str, now: float) -> deque[float]:
    times = _failures.setdefault(fp, deque())
    while times and now - times[0] > ACCOUNT_WINDOW_SECONDS:
        times.popleft()
    return times


def _account_locked(fp: str) -> bool:
    with _failures_lock:
        return len(_recent_failures(fp, time.monotonic())) >= ACCOUNT_MAX_FAILURES


def _note_failure(fp: str) -> None:
    with _failures_lock:
        now = time.monotonic()
        _recent_failures(fp, now).append(now)


# --- shapes -------------------------------------------------------------------


class SignedInUser(BaseModel):
    id: str
    full_name: str
    email: str
    role: Role


class SessionOut(BaseModel):
    family_id: str
    access_token: str
    refresh_token: str
    refresh_expires_at: UtcDateTime


class SignedIn(BaseModel):
    user: SignedInUser
    session: SessionOut


class SessionRow(BaseModel):
    id: str
    device: str | None
    started_at: UtcDateTime
    last_active_at: UtcDateTime
    expires_at: UtcDateTime
    current: bool


class Ended(BaseModel):
    ended: int


class EndedOne(BaseModel):
    id: str


class SignedOut(BaseModel):
    signed_out: bool


def _signed_in(user: User, session: IssuedSession) -> dict[str, Any]:
    return {
        "data": {
            "user": {"id": user.id, "full_name": user.full_name, "email": user.email, "role": user.role},
            "session": {
                "family_id": session.family_id,
                "access_token": session.access_token,
                "refresh_token": session.refresh_token,
                "refresh_expires_at": session.refresh_expires_at,
            },
        }
    }


# --- sign-in --------------------------------------------------------------------


class LoginIn(BaseModel):
    # loginSchema in validations.ts.
    email: Email
    password: str
    client: Literal["web", "app"] = "web"

    @field_validator("password")
    @classmethod
    def _required(cls, value: str) -> str:
        if not value:
            raise PydanticCustomError("value_error", "Password is required")
        return value


@router.post("/auth/login", response_model=Data[SignedIn], dependencies=[Service])
def login(body: LoginIn, request: Request, db: DbSession):
    """verifyPasswordLogin() and startSession(): the same checks, messages
    and status codes. The website records and answers a per-address
    refusal itself; this one is per account."""
    fp = email_fingerprint(body.email)
    if _account_locked(fp):
        security_event(request, "login_rate_limited", actor_id=None, entity_type="Auth", entity_id="login",
               detail={"scope": "account", "client": body.client, "email_fp": fp})
        raise ApiError(429, "rate_limited", "Too many login attempts. Please try again later.")

    user = db.scalar(select(User).where(User.email == body.email))

    def refuse(reason: str, status: int, code: str, message: str) -> ApiError:
        security_event(request, "login_failed", actor_id=None, entity_type="Auth", entity_id=f"user:{user.id}" if user else "unknown_account",
               detail={"reason": reason, "method": "password", "client": body.client, "email_fp": fp})
        # The website raises the brute-force alerts from this fingerprint.
        return ApiError(status, code, message, {"email_fp": fp})

    if user is None or not user.password_hash:
        check_password(body.password, None)  # as long as a wrong password takes
        _note_failure(fp)
        raise refuse("no_password_set" if user else "unknown_account", 401, "invalid_credentials", INVALID_LOGIN)
    if not check_password(body.password, user.password_hash):
        _note_failure(fp)
        raise refuse("bad_password", 401, "invalid_credentials", INVALID_LOGIN)
    if not user.email_verified:
        raise refuse("email_unverified", 403, "email_unverified", "Please verify your email before logging in.")

    security_event(request, "login_succeeded", actor_id=user.id, entity_type="Auth", entity_id=f"user:{user.id}",
           detail={"method": "password", "client": body.client, "role": user.role.value})
    return _signed_in(user, start_session(db, user, _user_agent(request)))


# --- Google -------------------------------------------------------------------


class GoogleIn(BaseModel):
    code: str
    redirect_uri: str


@router.post("/auth/google", response_model=Data[SignedIn], dependencies=[Service])
def google_sign_in(body: GoogleIn, request: Request, db: DbSession, google: Annotated[GoogleClient | None, Depends(google_client)]):
    """Sign-in only: an account must already exist. A linked account is found
    by Google's own id; linking by email needs Google to have verified the
    address, never re-links an account linked to another Google account, and
    drops a password nobody proved they own (#131's rules)."""
    if google is None:
        raise ApiError(503, "google_unavailable", "Google sign-in is not available.")
    try:
        found = google.user_for_code(body.code, body.redirect_uri)
    except GoogleFailed as err:
        log_event(logging.WARNING, "auth.google_exchange_failed", code=str(err))
        raise ApiError(502, str(err), "Google sign-in failed.") from None
    if not found.email:
        raise ApiError(401, "google_no_email", "Google didn't share an email address.")
    fp = email_fingerprint(found.email)

    def refuse(reason: str, user_id: str | None, code: str) -> ApiError:
        security_event(request, "login_failed", actor_id=None, entity_type="Auth", entity_id=f"user:{user_id}" if user_id else "unknown_account",
               detail={"reason": reason, "method": "google", "email_fp": fp})
        return ApiError(401, code, "Google sign-in was refused.", {"email_fp": fp})

    user = db.scalar(select(User).where(User.google_id == found.sub))
    if user is None:
        by_email = db.scalar(select(User).where(User.email == found.email))
        if by_email is None:
            raise refuse("unknown_account", None, "google_no_account")
        if not found.email_verified:
            raise refuse("google_email_unverified", by_email.id, "google_email_unverified")
        if by_email.google_id:
            raise refuse("google_account_mismatch", by_email.id, "google_no_account")
        # Pre-hijack: a password on an account whose email was never
        # verified may not be the owner's. Linking proves the address, so it
        # goes (the trigger moves token_version on, ending its sessions).
        unproven_password = not by_email.email_verified and by_email.password_hash is not None
        set_audit_actor(db, by_email.id)
        by_email.google_id = found.sub
        by_email.email_verified = True
        if unproven_password:
            by_email.password_hash = None
        db.commit()
        db.refresh(by_email)
        if unproven_password:
            log_event(logging.INFO, "auth.google_link_dropped_password", user_id=by_email.id)
        user = by_email

    security_event(request, "login_succeeded", actor_id=user.id, entity_type="Auth", entity_id=f"user:{user.id}",
           detail={"method": "google", "role": user.role.value})
    return _signed_in(user, start_session(db, user, _user_agent(request)))


# --- refresh and sign-out -------------------------------------------------------


class RefreshIn(BaseModel):
    refresh_token: str | None = None


@router.post("/auth/refresh", response_model=Data[SignedIn], dependencies=[Service])
def refresh(body: RefreshIn, request: Request, db: DbSession):
    """refreshSession(): rotation, the race window, and reuse detection. The
    refusal's reason goes back in details: on "superseded" the website keeps
    the cookies the winning request set; on "reused" it raises the alert."""
    outcome = refresh_session(db, body.refresh_token, _user_agent(request))
    if isinstance(outcome, RefreshRefused):
        log_event(logging.INFO, "session.refresh_rejected", reason=outcome.reason, user_id=outcome.user_id, sid=outcome.family_id)
        details: dict[str, Any] = {"reason": outcome.reason}
        if outcome.reason == "reused":
            used_at = outcome.used_at.isoformat(timespec="milliseconds") + "Z" if outcome.used_at else None
            security_event(request, "refresh_token_reused", actor_id=outcome.user_id, entity_type="Session", entity_id=outcome.family_id or "unknown",
                   detail={"used_at": used_at, "device": _user_agent(request)})
            details |= {"session": outcome.family_id, "user_id": outcome.user_id, "used_at": used_at}
        raise ApiError(401, "session_ended", SESSION_ENDED, details)
    log_event(logging.INFO, "session.refreshed", user_id=outcome.user.id, sid=outcome.session.family_id)
    return _signed_in(outcome.user, outcome.session)


class LogoutIn(BaseModel):
    refresh_token: str | None = None
    client: Literal["web", "app"] = "web"


@router.post("/auth/logout", response_model=Data[SignedOut], dependencies=[Service])
def logout(body: LogoutIn, request: Request, db: DbSession, user: OptionalUser):
    """Ends the session server-side, not just its cookies: the refresh token
    names it even when the access token has expired; without one, the
    signed-in user's own session. Always answers the same way."""
    family = family_of(db, body.refresh_token)
    family_id, user_id = family if family else ((user.sid, user.user_id) if user and body.client == "web" else (None, None))
    if family_id and user_id:
        revoke_family(db, family_id, "logout", user_id)
        detail: dict[str, Any] = {"session": family_id} | ({"client": "app"} if body.client == "app" else {})
        security_event(request, "logout", actor_id=user_id, entity_type="Auth", entity_id=f"user:{user_id}", detail=detail)
    return {"data": {"signed_out": True}}


# --- the session lists ------------------------------------------------------------


def _rows(db, user_id: str, current: str | None) -> list[dict[str, Any]]:
    return [asdict(s) for s in list_sessions(db, user_id, current)]


@router.get("/auth/sessions", response_model=Data[list[SessionRow]])
def my_sessions(user: CurrentUser, db: DbSession):
    """The caller's live sessions, for the "Active sessions" panel."""
    return {"data": _rows(db, user.user_id, user.sid)}


@router.delete("/auth/sessions", response_model=Data[Ended])
def sign_out_everywhere(user: CurrentUser, request: Request, db: DbSession):
    ended = revoke_all_for_user(db, user.user_id, "logout_everywhere")
    security_event(request, "sessions_revoked", actor_id=user.user_id, entity_type="User", entity_id=user.user_id,
           detail={"reason": "logout_everywhere", "sessions": ended})
    return {"data": {"ended": ended}}


@router.delete("/auth/sessions/{session_id}", response_model=Data[EndedOne])
def end_my_session(session_id: str, user: CurrentUser, request: Request, db: DbSession):
    """Scoped to the caller: another user's session id matches nothing (404)."""
    if not revoke_family(db, session_id, "revoked_by_user", user.user_id):
        raise ApiError(404, "not_found", "Session not found.")
    security_event(request, "sessions_revoked", actor_id=user.user_id, entity_type="Session", entity_id=session_id,
           detail={"reason": "revoked_by_user", "current": session_id == user.sid})
    return {"data": {"id": session_id}}


@router.get("/users/{user_id}/sessions", response_model=Data[list[SessionRow]])
def user_sessions(user_id: str, _admin: Admin, db: DbSession):
    return {"data": _rows(db, user_id, None)}


@router.delete("/users/{user_id}/sessions", response_model=Data[Ended])
def sign_user_out_everywhere(user_id: str, admin: Admin, request: Request, db: DbSession):
    """For offboarding without deleting the account, or a suspected
    compromise: the user's next request is refused."""
    if db.get(User, user_id) is None:
        raise ApiError(404, "not_found", "User not found.")
    ended = revoke_all_for_user(db, user_id, "revoked_by_admin")
    security_event(request, "sessions_revoked", actor_id=admin.user_id, entity_type="User", entity_id=user_id,
           detail={"reason": "revoked_by_admin", "sessions": ended})
    return {"data": {"ended": ended}}
