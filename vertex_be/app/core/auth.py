"""The signed-in caller (gap G9): verifies a Next.js session token and checks
the session is still live, as getAuthUser() in vertex/src/lib/api-auth.ts
does. Zero trust (G19): the signature is not enough. The user must still
exist, their token_version must match the token's, and the token's session
must still be live, so revocation, deletion, the kill switch and password
or role changes take effect on the next request. Role and email come from
the database, not the token. Any failure, including the database being
unreachable, means 401.

The token is accepted from `Authorization: Bearer` only, never from the
browser's session cookie: honouring the cookie would let any site make the
browser send authenticated requests here (CSRF). The Flutter app and
Next.js's server-side calls send the header.

Registered as a guard in app/core/access.py, so a route that depends on
current_user passes the default-deny check.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Annotated

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.logging import log_event
from app.core.tokens import InvalidToken, verify_session_token
from app.db.session import get_db
from app.models.enums import Role
from app.models.identity import User


@dataclass(frozen=True)
class AuthUser:
    user_id: str
    email: str
    role: Role
    sid: str
    ver: int


def _unauthenticated() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Not authenticated",
        headers={"WWW-Authenticate": "Bearer"},
    )


def _bearer_token(request: Request) -> str | None:
    scheme, _, token = request.headers.get("Authorization", "").partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        return None
    return token.strip()


def current_user(request: Request, db: Annotated[Session, Depends(get_db)]) -> AuthUser:
    token = _bearer_token(request)
    if token is None:
        raise _unauthenticated()

    try:
        claims = verify_session_token(token)
    except InvalidToken as err:
        # Expired sessions land here routinely; a run of bad signatures is
        # what to look for.
        log_event(logging.INFO, "auth.invalid_token", reason=str(err))
        raise _unauthenticated() from None

    try:
        user = db.get(User, claims.user_id)
        if user is None:
            reason = "user_gone"
        elif user.token_version != claims.ver:
            reason = "version_changed"
        elif not db.scalar(
            text("SELECT public.vertex_session_is_live(:user_id, :family_id)"),
            {"user_id": claims.user_id, "family_id": claims.sid},
        ):
            reason = "session_ended"
        else:
            reason = None
    except Exception as err:  # the database being unreachable included
        log_event(logging.WARNING, "auth.session_check_failed", error=type(err).__name__)
        raise _unauthenticated() from None

    if reason is not None:
        log_event(logging.INFO, "auth.session_rejected", reason=reason, user_id=claims.user_id, sid=claims.sid)
        raise _unauthenticated()

    return AuthUser(user_id=user.id, email=user.email, role=user.role, sid=claims.sid, ver=user.token_version)


CurrentUser = Annotated[AuthUser, Depends(current_user)]
