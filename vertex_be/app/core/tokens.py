"""Signs and verifies session tokens, and verifies the other tokens the
Next.js app issues (vertex/src/lib/jwt.ts).

FastAPI is the session issuer since users and sessions step 8.2
(docs/architecture/users-handover.md, D1 A): it signs access tokens exactly
as jwt.ts did, so the website (which still verifies them on every request)
and tokens issued before the switch are unaffected. Exception E8 records the
shared key until the move to asymmetric keys after step 8.5. Every token
follows the same rules:
  - HS256 only (no algorithm from the token is trusted);
  - one key per token purpose, derived from JWT_SECRET with HKDF-SHA256
    (gap G17), so a password-reset or upload token never passes as a session;
  - issuer "vertex-web", audience "vertex:<purpose>", an expiry;
  - userId, email, role and sid non-empty strings, ver an integer.

Four purposes are verified here; FastAPI issues "session" only.
  - "session": a user's session. The signature is necessary, not
    sufficient: app/core/auth.py also checks the session is still live, as
    Next.js does on every request.
  - "service": Next.js's own credential when it calls FastAPI
    (callBackend() in vertex/src/lib/backend.ts; gap G18, zero-trust §6).
    Keyed from SERVICE_AUTH_SECRET, never JWT_SECRET, so one leaking
    doesn't give away the other; SERVICE_AUTH_SECRET_PREVIOUS is also
    accepted while a rotation is under way. At most a few minutes long.
  - "candidate_invite": the link a screened candidate is emailed to create
    their account (signCandidateInviteToken). Registration passes it on so
    FastAPI checks for itself which candidate the new account claims
    (pipeline handover step 6.2).
  - "cif_upload": lets an anonymous self-applicant attach documents to the
    Candidate Information Form they have just submitted (signCifUploadToken;
    step 6.3).
"""

from __future__ import annotations

import hashlib
import hmac
import time
from dataclasses import dataclass
from functools import lru_cache

import jwt

from app.core.config import settings

ALGORITHM = "HS256"
ISSUER = "vertex-web"
SALT = b"vertex-token-keys"
# Mirrors KEY_VERSION in jwt.ts: bumping it there invalidates every
# outstanding token of that purpose, so it must be bumped here too.
KEY_VERSION = {"session": 1, "service": 1, "candidate_invite": 1, "cif_upload": 1}


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


ACCESS_TOKEN_TTL_SECONDS = 15 * 60  # ACCESS_TOKEN_EXPIRES_IN in jwt.ts


def sign_session_token(*, user_id: str, email: str, role: str, sid: str, ver: int) -> str:
    """A 15-minute access token, as signToken() in jwt.ts signed it."""
    secret = settings.JWT_SECRET
    if not secret or len(secret) < 32:
        raise InvalidToken("JWT_SECRET is not configured")
    now = int(time.time())
    payload = {
        "userId": user_id, "email": email, "role": role, "sid": sid, "ver": ver,
        "iat": now, "exp": now + ACCESS_TOKEN_TTL_SECONDS, "iss": ISSUER, "aud": "vertex:session",
    }
    return jwt.encode(payload, key_for("session", secret), algorithm=ALGORITHM)


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


def _verify_candidate_token(purpose: str, token: str) -> str:
    """A token Next.js signs for one candidate: its candidateId."""
    secret = settings.JWT_SECRET
    if not secret or len(secret) < 32:
        raise InvalidToken("JWT_SECRET is not configured")
    try:
        payload = jwt.decode(
            token,
            key_for(purpose, secret),
            algorithms=[ALGORITHM],
            issuer=ISSUER,
            audience=f"vertex:{purpose}",
            options={"require": ["exp", "iss", "aud"]},
        )
    except jwt.PyJWTError as err:
        raise InvalidToken(type(err).__name__) from err
    candidate_id = payload.get("candidateId")
    if not isinstance(candidate_id, str) or not candidate_id:
        raise InvalidToken(f"{purpose} token is missing candidateId")
    return candidate_id


def verify_candidate_invite_token(token: str) -> str:
    """The candidate id a screening invite was signed for."""
    return _verify_candidate_token("candidate_invite", token)


def verify_cif_upload_token(token: str) -> str:
    """The candidate id an upload token from the Candidate Information Form
    was signed for (signCifUploadToken)."""
    return _verify_candidate_token("cif_upload", token)
