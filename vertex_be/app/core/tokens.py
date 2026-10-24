"""Verifies the session tokens the Next.js app issues (vertex/src/lib/jwt.ts).

Next.js stays the session issuer until users and sessions move to FastAPI
(docs/architecture/data-ownership.md §5), so FastAPI accepts exactly the
tokens it signs, by the same rules:
  - HS256 only (no algorithm from the token is trusted);
  - one key per token purpose, derived from JWT_SECRET with HKDF-SHA256
    (gap G17), so a password-reset or upload token never passes as a session;
  - issuer "vertex-web", audience "vertex:<purpose>", an expiry;
  - userId, email, role and sid non-empty strings, ver an integer.

Two purposes are verified here; FastAPI issues nothing.
  - "session": a user's session. The signature is necessary, not
    sufficient: app/core/auth.py also checks the session is still live, as
    Next.js does on every request.
  - "service": Next.js's own credential when it calls FastAPI
    (callBackend() in vertex/src/lib/backend.ts; gap G18, zero-trust §6).
    Keyed from SERVICE_AUTH_SECRET, never JWT_SECRET, so one leaking
    doesn't give away the other; SERVICE_AUTH_SECRET_PREVIOUS is also
    accepted while a rotation is under way. At most a few minutes long.
"""

from __future__ import annotations

import hashlib
import hmac
from dataclasses import dataclass
from functools import lru_cache

import jwt

from app.core.config import settings

ALGORITHM = "HS256"
ISSUER = "vertex-web"
SALT = b"vertex-token-keys"
# Mirrors KEY_VERSION in jwt.ts: bumping it there invalidates every
# outstanding token of that purpose, so it must be bumped here too.
KEY_VERSION = {"session": 1, "service": 1}


class InvalidToken(Exception):
    """Bad signature, wrong purpose, expired or malformed. The message is for
    logs only, never for the caller."""


@dataclass(frozen=True)
class SessionClaims:
    user_id: str
    email: str
    role: str
    sid: str
    ver: int


def hkdf_sha256(secret: bytes, salt: bytes, info: bytes, length: int = 32) -> bytes:
    """RFC 5869 HKDF with SHA-256, as node:crypto's hkdfSync("sha256", ...)."""
    prk = hmac.new(salt, secret, hashlib.sha256).digest()
    out, block, counter = b"", b"", 1
    while len(out) < length:
        block = hmac.new(prk, block + info + bytes([counter]), hashlib.sha256).digest()
        out += block
        counter += 1
    return out[:length]


@lru_cache
def key_for(purpose: str, secret: str) -> bytes:
    info = f"vertex/jwt/{purpose}/v{KEY_VERSION[purpose]}".encode()
    return hkdf_sha256(secret.encode(), SALT, info)


def verify_session_token(token: str) -> SessionClaims:
    secret = settings.JWT_SECRET
    if not secret or len(secret) < 32:
        raise InvalidToken("JWT_SECRET is not configured")
    try:
        payload = jwt.decode(
            token,
            key_for("session", secret),
            algorithms=[ALGORITHM],
            issuer=ISSUER,
            audience="vertex:session",
            options={"require": ["exp", "iss", "aud"]},
        )
    except jwt.PyJWTError as err:
        raise InvalidToken(type(err).__name__) from err

    for field in ("userId", "email", "role", "sid"):
        value = payload.get(field)
        if not isinstance(value, str) or not value:
            raise InvalidToken(f"session token is missing {field}")
    ver = payload.get("ver")
    # Number.isInteger in jwt.ts; bool is an int subclass in Python.
    if isinstance(ver, bool) or not isinstance(ver, int):
        raise InvalidToken("session token is missing ver")

    return SessionClaims(
        user_id=payload["userId"],
        email=payload["email"],
        role=payload["role"],
        sid=payload["sid"],
        ver=ver,
    )


# Next.js signs one per call, valid for a minute; anything longer-lived is
# refused, so a leaked token is of little use.
SERVICE_TOKEN_MAX_LIFETIME = 300
SERVICE_SCOPES = frozenset({"backend"})


@dataclass(frozen=True)
class ServiceClaims:
    service: str
    scope: str


def verify_service_token(token: str) -> ServiceClaims:
    candidates = [s for s in (settings.SERVICE_AUTH_SECRET, settings.SERVICE_AUTH_SECRET_PREVIOUS) if s and len(s) >= 32]
    if not candidates:
        raise InvalidToken("SERVICE_AUTH_SECRET is not configured")
    payload = None
    for secret in candidates:
        try:
            payload = jwt.decode(
                token,
                key_for("service", secret),
                algorithms=[ALGORITHM],
                issuer=ISSUER,
                audience="vertex:service",
                options={"require": ["exp", "iat", "iss", "aud", "sub"]},
            )
            break
        except jwt.InvalidSignatureError:
            continue
        except jwt.PyJWTError as err:
            raise InvalidToken(type(err).__name__) from err
    if payload is None:
        raise InvalidToken("InvalidSignatureError")

    if payload["sub"] != ISSUER:
        raise InvalidToken("service token is for another service")
    if payload.get("scope") not in SERVICE_SCOPES:
        raise InvalidToken("service token has no allowed scope")
    iat, exp = payload["iat"], payload["exp"]
    if not all(isinstance(v, int) and not isinstance(v, bool) for v in (iat, exp)) or exp - iat > SERVICE_TOKEN_MAX_LIFETIME:
        raise InvalidToken("service token lives too long")
    return ServiceClaims(service=payload["sub"], scope=payload["scope"])
