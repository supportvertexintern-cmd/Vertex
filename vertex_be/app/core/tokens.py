"""Verifies the session tokens the Next.js app issues (vertex/src/lib/jwt.ts).

Next.js stays the session issuer until users and sessions move to FastAPI
(docs/architecture/data-ownership.md §5), so FastAPI accepts exactly the
tokens it signs, by the same rules:
  - HS256 only (no algorithm from the token is trusted);
  - one key per token purpose, derived from JWT_SECRET with HKDF-SHA256
    (gap G17), so a password-reset or upload token never passes as a session;
  - issuer "vertex-web", audience "vertex:<purpose>", an expiry;
  - userId, email, role and sid non-empty strings, ver an integer.

Only the "session" purpose is verified here; FastAPI issues nothing.
The signature is necessary, not sufficient: app/core/auth.py also checks
the session is still live, as Next.js does on every request.
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
KEY_VERSION = {"session": 1}


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
