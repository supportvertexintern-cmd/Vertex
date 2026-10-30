"""Sessions (gap G19, exception E6; docs/security/session-management.md),
issued by FastAPI since users and sessions step 8.2
(docs/architecture/users-handover.md). A port of vertex/src/lib/session.ts
and lib/password-login.ts, rule for rule.

A session is a refresh-token *family*: the RefreshToken rows sharing one
family_id. The access token is a 15-minute JWT carrying the user, the family
(sid) and the user's token_version (ver); the refresh token is an opaque
random value, stored only as its SHA-256, and rotated on every use. The
website keeps both in HttpOnly cookies (or hands them to the mobile app) and
still checks every request against the database itself.

RefreshToken isn't row-audited (exception E9): a rotation every 15 minutes
per signed-in user would put a token hash in the append-only log each time.
Every decision about a session is a security event instead.
"""

from __future__ import annotations

import hashlib
import secrets
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta
from functools import lru_cache
from typing import Literal

import bcrypt
from sqlalchemy import delete, func, select, update
from sqlalchemy.orm import Session

from app.core.clock import utc_now_ms
from app.core.tokens import sign_session_token
from app.models.enums import Role
from app.models.identity import RefreshToken, User

# Absolute session lifetime (rotation doesn't extend it). Staff and admins
# can reach many candidates' personal data, so theirs is a working day.
STAFF_SESSION_SECONDS = 12 * 60 * 60
SESSION_SECONDS = 14 * 24 * 60 * 60
# Two tabs refreshing at once both present the same token: the loser's is
# already used. Within this window that is a race, not theft, so it is
# refused without revoking the family.
REUSE_GRACE = timedelta(seconds=30)
DEVICE_MAX = 200

RevokeReason = Literal[
    "logout", "logout_everywhere", "revoked_by_user", "revoked_by_admin", "reuse_detected", "token_version_changed", "kill_switch"
]
RefreshFailure = Literal["missing", "unknown", "revoked", "expired", "superseded", "reused", "version_changed"]


def _now() -> datetime:
    # As Prisma stores it: a value kept finer would answer differently from
    # the row once read back.
    return utc_now_ms()


def session_lifetime_seconds(role: Role) -> int:
    """Candidates and partners hold only their own data; every other role is
    internal staff."""
    return SESSION_SECONDS if role in (Role.candidate, Role.partner) else STAFF_SESSION_SECONDS


def hash_refresh_token(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


def email_fingerprint(email: str) -> str:
    """emailFingerprint() in lib/audit.ts: correlates failed sign-ins on one
    address without storing what was typed."""
    return hashlib.sha256(email.strip().lower().encode()).hexdigest()[:16]


def _device(user_agent: str | None) -> str | None:
    return user_agent[:DEVICE_MAX] if user_agent else None


@dataclass(frozen=True)
class IssuedSession:
    family_id: str
    access_token: str
    refresh_token: str
    refresh_expires_at: datetime


def _access_token(user: User, family_id: str) -> str:
    return sign_session_token(user_id=user.id, email=user.email, role=user.role.value, sid=family_id, ver=user.token_version)


def start_session(db: Session, user: User, user_agent: str | None) -> IssuedSession:
    """Starts a new session (sign-in) and commits it."""
    family_id = str(uuid.uuid4())
    raw = secrets.token_urlsafe(32)
    expires_at = _now() + timedelta(seconds=session_lifetime_seconds(user.role))
    db.add(RefreshToken(
        user_id=user.id, family_id=family_id, token_hash=hash_refresh_token(raw),
        token_version=user.token_version, device_info=_device(user_agent), expires_at=expires_at,
    ))
    # Housekeeping: this user's long-dead rows.
    db.execute(delete(RefreshToken).where(RefreshToken.user_id == user.id, RefreshToken.expires_at < _now() - timedelta(days=1)))
    db.commit()
    return IssuedSession(family_id, _access_token(user, family_id), raw, expires_at)


@dataclass(frozen=True)
class Refreshed:
    user: User
    session: IssuedSession


@dataclass(frozen=True)
class RefreshRefused:
    reason: RefreshFailure
    user_id: str | None = None
    family_id: str | None = None
    used_at: datetime | None = None


def refresh_session(db: Session, raw: str | None, user_agent: str | None) -> Refreshed | RefreshRefused:
    """Exchanges a refresh token for a new access token and a new refresh
    token. The presented token is spent. Presenting a spent token again
    (outside the race window) is treated as theft: the caller revokes the
    whole family and raises the alert."""
    if not raw:
        return RefreshRefused("missing")
    row = db.scalar(select(RefreshToken).where(RefreshToken.token_hash == hash_refresh_token(raw)))
    if row is None:
        return RefreshRefused("unknown")
    refused = lambda reason: RefreshRefused(reason, row.user_id, row.family_id, row.used_at)  # noqa: E731

    if row.revoked_at is not None:
        return refused("revoked")
    if row.used_at is not None:
        if _now() - row.used_at < REUSE_GRACE:
            return refused("superseded")
        revoke_family(db, row.family_id, "reuse_detected")
        return refused("reused")
    if row.expires_at <= _now():
        return refused("expired")
    # As the database has it now: a trigger moves token_version on.
    user = db.get(User, row.user_id, populate_existing=True)
    if user is None or row.token_version != user.token_version:
        revoke_family(db, row.family_id, "token_version_changed")
        return refused("version_changed")

    # Only one caller can spend a token: the conditional update is the lock.
    spent = db.execute(
        update(RefreshToken)
        .where(RefreshToken.id == row.id, RefreshToken.used_at.is_(None), RefreshToken.revoked_at.is_(None))
        .values(used_at=_now())
    )
    if spent.rowcount != 1:
        db.rollback()
        return refused("superseded")
    new_raw = secrets.token_urlsafe(32)
    db.add(RefreshToken(
        user_id=row.user_id, family_id=row.family_id, token_hash=hash_refresh_token(new_raw),
        token_version=row.token_version, device_info=_device(user_agent) or row.device_info, expires_at=row.expires_at,
    ))
    db.commit()
    return Refreshed(user, IssuedSession(row.family_id, _access_token(user, row.family_id), new_raw, row.expires_at))


def family_of(db: Session, raw: str | None) -> tuple[str, str] | None:
    """(family_id, user_id) of a refresh token, if the token is known."""
    if not raw:
        return None
    row = db.execute(
        select(RefreshToken.family_id, RefreshToken.user_id).where(RefreshToken.token_hash == hash_refresh_token(raw))
    ).first()
    return (row.family_id, row.user_id) if row else None


def revoke_family(db: Session, family_id: str, reason: RevokeReason, user_id: str | None = None) -> int:
    """Ends one session and commits. Returns how many live tokens were revoked."""
    query = update(RefreshToken).where(RefreshToken.family_id == family_id, RefreshToken.revoked_at.is_(None))
    if user_id is not None:
        query = query.where(RefreshToken.user_id == user_id)
    count = db.execute(query.values(revoked_at=_now(), revoke_reason=reason)).rowcount
    db.commit()
    return count


def _live(user_id: str):
    return select(RefreshToken).where(
        RefreshToken.user_id == user_id, RefreshToken.revoked_at.is_(None), RefreshToken.used_at.is_(None), RefreshToken.expires_at > _now()
    )


def revoke_all_for_user(db: Session, user_id: str, reason: RevokeReason) -> int:
    """Ends every session of a user and commits. Returns the number of sessions ended."""
    live = len(db.scalars(_live(user_id)).all())
    db.execute(
        update(RefreshToken).where(RefreshToken.user_id == user_id, RefreshToken.revoked_at.is_(None)).values(revoked_at=_now(), revoke_reason=reason)
    )
    db.commit()
    return live


@dataclass(frozen=True)
class SessionSummary:
    id: str
    device: str | None
    started_at: datetime
    last_active_at: datetime
    expires_at: datetime
    current: bool


def list_sessions(db: Session, user_id: str, current_family_id: str | None) -> list[SessionSummary]:
    """A user's live sessions, newest activity first."""
    live = db.scalars(_live(user_id).order_by(RefreshToken.created_at.desc())).all()
    if not live:
        return []
    starts = dict(
        db.execute(
            select(RefreshToken.family_id, func.min(RefreshToken.created_at))
            .where(RefreshToken.family_id.in_([r.family_id for r in live]))
            .group_by(RefreshToken.family_id)
        ).all()
    )
    return [
        SessionSummary(r.family_id, r.device_info, starts.get(r.family_id, r.created_at), r.created_at, r.expires_at, r.family_id == current_family_id)
        for r in live
    ]


# --- passwords ---------------------------------------------------------------

# bcryptjs, which hashed every password, reads only the first 72 bytes of
# one; Python's bcrypt refuses longer input. Cutting it the same way keeps
# every long password that works on the website working here.
BCRYPT_MAX_BYTES = 72


def _secret(password: str) -> bytes:
    return password.encode()[:BCRYPT_MAX_BYTES]


@lru_cache
def _dummy_hash() -> bytes:
    return bcrypt.hashpw(b"not-a-real-password", bcrypt.gensalt(12))


def check_password(password: str, password_hash: str | None) -> bool:
    """bcrypt.compare() as bcryptjs did it. With no hash to check against, a
    dummy one is checked anyway, so an unknown account takes as long to
    refuse as a wrong password (no user enumeration by timing)."""
    if not password_hash:
        bcrypt.checkpw(_secret(password), _dummy_hash())
        return False
    try:
        return bcrypt.checkpw(_secret(password), password_hash.encode())
    except ValueError:  # not a bcrypt hash
        return False


# hashPassword() in lib/auth.ts: cost 12. Python's bcrypt writes $2b$, which
# bcryptjs reads, so a password set here still works if the website takes
# the writes back (tested in vertex/src/lib/auth.test.ts).
BCRYPT_COST = 12


def hash_password(password: str) -> str:
    return bcrypt.hashpw(_secret(password), bcrypt.gensalt(BCRYPT_COST)).decode()
