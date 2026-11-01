"""Signs and verifies session tokens and FastAPI's account links, and
verifies the tokens the Next.js app issues (vertex/src/lib/jwt.ts).

FastAPI is the session issuer since users and sessions step 8.2
(docs/architecture/users-handover.md). Since session keys step K3
(docs/architecture/session-keys-handover.md, which closed exception E8):
  - a session is ES256, signed with SESSION_PRIVATE_KEY, which only this
    service holds, and names its key in `kid`; FastAPI and the website
    verify it with SESSION_PUBLIC_KEYS (app/core/session_keys.py). A session
    signed with a key derived from JWT_SECRET is refused, so the website,
    which holds JWT_SECRET, can't mint one;
  - an account link is keyed from ACCOUNT_LINK_SECRET, which the website
    never holds; one keyed from JWT_SECRET is refused.
Every other token follows the same rules:
  - HS256 only (no algorithm from the token is trusted);
  - one key per token purpose, derived with HKDF-SHA256 (gap G17) from
    the purpose's secret, so a password-reset or upload token never passes
    for another purpose;
  - issuer "vertex-web", audience "vertex:<purpose>", an expiry;
  - userId, email, role and sid non-empty strings, ver an integer.

Eight purposes are verified here; FastAPI issues "session" and, since
users step 8.3 (D4 A), the email links (the referral agent's since 8.4).
  - "session": a user's session, ES256 (above). The signature is
    necessary, not sufficient: app/core/auth.py also checks the session is
    still live, as Next.js does on every request.
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
  - "email_verification", "password_reset", "account_setup": the links in
    the verification, reset and setup emails, keyed from
    ACCOUNT_LINK_SECRET, with the claims the website's signEmailToken() and
    signAccountSetupToken() used before step 8.3. A reset link also carries
    "pwd", a keyed fingerprint of the password it was issued for: once that
    password changes (the link used, or changed another way) the link stops
    working (security review #9).
  - "referral_agent_email_verification": the link in a referral agent's
    application email (signReferralAgentEmailVerificationToken). It names
    an application, not an account: the agent has none until approved.
"""

from __future__ import annotations

import hashlib
import hmac
from dataclasses import dataclass, field
from functools import lru_cache

import jwt

from cryptography.hazmat.primitives.asymmetric import ec

from app.core import session_keys
from app.core.clock import epoch_seconds
from app.core.config import settings

ALGORITHM = "HS256"
ISSUER = "vertex-web"
SALT = b"vertex-token-keys"
# Mirrors KEY_VERSION in jwt.ts for the purposes both sign or check (the
# account links are FastAPI's alone since users step 8.5): bumping one there
# invalidates every outstanding token of that purpose, so bump it here too.
KEY_VERSION = {
    "service": 1, "candidate_invite": 1, "cif_upload": 1,
    "email_verification": 1, "password_reset": 1, "account_setup": 1,
    "referral_agent_email_verification": 1,
}
# 24 hours, as the website's jwt.ts signed them before users steps 8.3 and 8.4.
EMAIL_TOKEN_TTL_SECONDS = 24 * 60 * 60
ACCOUNT_SETUP_TTL_SECONDS = 7 * 24 * 60 * 60


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


def _session_key(token: str) -> ec.EllipticCurvePublicKey:
    """The listed public key a session token's `kid` names. Only an ES256
    token gets one: the token's `alg` is never trusted to pick another."""
    try:
        header = jwt.get_unverified_header(token)
    except jwt.PyJWTError as err:
        raise InvalidToken(type(err).__name__) from err
    if header.get("alg") != session_keys.ALGORITHM:
        raise InvalidToken("session token is not ES256")
    public = session_keys.public_keys(settings.SESSION_PUBLIC_KEYS).get(str(header.get("kid")))
    if public is None:
        raise InvalidToken("session token names an unknown key")
    return public


def verify_session_token(token: str) -> SessionClaims:
    key = _session_key(token)
    try:
        payload = jwt.decode(
            token,
            key,
            algorithms=[session_keys.ALGORITHM],
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


def sign_session_token(*, user_id: str, email: str, role: str, sid: str, ver: int, ttl_seconds: int = ACCESS_TOKEN_TTL_SECONDS) -> str:
    """A 15-minute access token, ES256 with this service's private key,
    named by its `kid`. Only the security tools (deploy/zap) ask for another
    lifetime."""
    if not settings.SESSION_PRIVATE_KEY:
        raise InvalidToken("SESSION_PRIVATE_KEY is not configured")
    now = epoch_seconds()
    payload = {
        "userId": user_id, "email": email, "role": role, "sid": sid, "ver": ver,
        "iat": now, "exp": now + ttl_seconds, "iss": ISSUER, "aud": "vertex:session",
    }
    kid, private = session_keys.private_key(settings.SESSION_PRIVATE_KEY)
    return jwt.encode(payload, private, algorithm=session_keys.ALGORITHM, headers={"kid": kid})

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


# --- email links (users step 8.3) ----------------------------------------------


def _secret() -> str:
    """The secret account links are keyed from (session-keys-handover.md D4):
    the website never holds it."""
    secret = settings.ACCOUNT_LINK_SECRET
    if not secret or len(secret) < 32:
        raise InvalidToken("ACCOUNT_LINK_SECRET is not configured")
    return secret

def _sign(purpose: str, claims: dict, ttl_seconds: int) -> str:
    now = epoch_seconds()
    payload = {**claims, "iat": now, "exp": now + ttl_seconds, "iss": ISSUER, "aud": f"vertex:{purpose}"}
    return jwt.encode(payload, key_for(purpose, _secret()), algorithm=ALGORITHM)


def _decode_with_secret(purpose: str, token: str) -> tuple[dict, str]:
    """The link's claims and the secret its key came from."""
    secret = _secret()
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
    return payload, secret

def _decode(purpose: str, token: str) -> dict:
    return _decode_with_secret(purpose, token)[0]


def _text(payload: dict, field: str, purpose: str) -> str:
    value = payload.get(field)
    if not isinstance(value, str) or not value:
        raise InvalidToken(f"{purpose} token is missing {field}")
    return value


def password_fingerprint(password_hash: str | None, secret: str | None = None) -> str:
    """Names the password a reset link was issued for without revealing
    anything about it: keyed with the reset purpose's key (from the secret
    the link is signed with), and a link's claims are readable by whoever
    holds it."""
    key = key_for("password_reset", secret or _secret())
    return hmac.new(key, (password_hash or "").encode(), hashlib.sha256).hexdigest()[:32]


@dataclass(frozen=True)
class EmailLink:
    user_id: str
    email: str
    # The reset link's password fingerprint; None on a verification link and
    # on a reset link the website signed before 8.3 (valid for 24 hours).
    pwd: str | None
    # The secret the link's key came from, for its fingerprint.
    secret: str = field(default="", repr=False, compare=False)

    def issued_for(self, password_hash: str | None) -> bool:
        """Whether a reset link still names the account's password."""
        return self.pwd is None or hmac.compare_digest(self.pwd, password_fingerprint(password_hash, self.secret))


def sign_verification_token(user_id: str, email: str) -> str:
    return _sign("email_verification", {"userId": user_id, "email": email, "type": "email_verification"}, EMAIL_TOKEN_TTL_SECONDS)


def sign_reset_token(user_id: str, email: str, password_hash: str | None) -> str:
    claims = {"userId": user_id, "email": email, "type": "password_reset", "pwd": password_fingerprint(password_hash)}
    return _sign("password_reset", claims, EMAIL_TOKEN_TTL_SECONDS)


def verify_email_token(token: str, kind: str) -> EmailLink:
    """verifyEmailToken(token, kind): kind is "email_verification" or
    "password_reset", each with its own key."""
    if kind not in ("email_verification", "password_reset"):
        raise ValueError(kind)
    payload, secret = _decode_with_secret(kind, token)
    user_id, email = _text(payload, "userId", kind), _text(payload, "email", kind)
    if payload.get("type") != kind:
        raise InvalidToken(f"{kind} token has the wrong type")
    pwd = payload.get("pwd")
    return EmailLink(user_id, email, pwd if isinstance(pwd, str) and pwd else None, secret)


def sign_account_setup_token(user_id: str) -> str:
    return _sign("account_setup", {"userId": user_id, "type": "account_setup"}, ACCOUNT_SETUP_TTL_SECONDS)


def verify_account_setup_token(token: str) -> str:
    """The user id a setup link (staff or partner account) was signed for."""
    return _text(_decode("account_setup", token), "userId", "account_setup")


def sign_referral_agent_verification_token(agent_id: str) -> str:
    claims = {"referralAgentId": agent_id, "type": "referral_agent_email_verification"}
    return _sign("referral_agent_email_verification", claims, EMAIL_TOKEN_TTL_SECONDS)


def verify_referral_agent_verification_token(token: str) -> str:
    """The referral agent application a verification link was signed for."""
    purpose = "referral_agent_email_verification"
    payload = _decode(purpose, token)
    agent_id = _text(payload, "referralAgentId", purpose)
    if payload.get("type") != purpose:
        raise InvalidToken(f"{purpose} token has the wrong type")
    return agent_id
