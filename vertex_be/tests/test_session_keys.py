"""Session keys (docs/architecture/session-keys-handover.md), which closed E8.

Since K3 only an ES256 session from a listed public key is accepted, and
only an account link keyed from ACCOUNT_LINK_SECRET: never one keyed from
JWT_SECRET, which the website holds. Keys here are made per test, except the
golden vector the website checks too (node_session_vectors.py).
"""

import base64
import hashlib
import hmac
import json
import time

import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from sqlalchemy import update

from app.core import session_keys, tokens
from app.core.config import Settings, settings
from app.core.session_keys import BadKey, key_id
from app.db.session import get_db
from app.main import app
from app.models.enums import Role
from app.models.identity import RefreshToken, User
from tests.test_auth import add_session
from tests.test_sessions import account, api, google, refresh, sign_in  # noqa: F401  (fixtures)
from tests.node_session_vectors import ACCOUNT_LINK_SECRET as LINK_SECRET
from tests.node_session_vectors import ES256_SESSION_TOKEN, SECRET, SESSION_KEY_ID, SESSION_PUBLIC_KEY_B64

OTHER_SECRET = "test-only-some-other-secret-0123456789abcdefgh"  # gitleaks:allow


def new_key(curve: ec.EllipticCurve | None = None) -> ec.EllipticCurvePrivateKey:
    return ec.generate_private_key(curve or ec.SECP256R1())


def b64_public(key: ec.EllipticCurvePrivateKey) -> str:
    pem = key.public_key().public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo)
    return base64.b64encode(pem).decode()


def b64_private(key: ec.EllipticCurvePrivateKey) -> str:
    pem = key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())
    return base64.b64encode(pem).decode()


def claims(**overrides) -> dict:
    now = int(time.time())
    return {
        "userId": "u1", "email": "u1@test.invalid", "role": "admin", "sid": "f1", "ver": 0,
        "iat": now, "exp": now + 900, "iss": "vertex-web", "aud": "vertex:session", **overrides,
    }


def es256(key: ec.EllipticCurvePrivateKey, kid: str | None = None, **overrides) -> str:
    return jwt.encode(claims(**overrides), key, algorithm="ES256", headers={"kid": kid or key_id(key.public_key())})


@pytest.fixture
def keys(monkeypatch):
    """Two listed keys (current and previous), and the shared secret."""
    current, previous = new_key(), new_key()
    monkeypatch.setattr(settings, "SESSION_PUBLIC_KEYS", f"{b64_public(current)}, {b64_public(previous)}")
    monkeypatch.setattr(settings, "JWT_SECRET", SECRET)
    return current, previous


# --- sessions --------------------------------------------------------------------


def test_a_session_signed_by_a_listed_key_verifies(keys):
    current, previous = keys
    assert tokens.verify_session_token(es256(current)).user_id == "u1"
    assert tokens.verify_session_token(es256(previous)).user_id == "u1"  # mid-rotation


def test_a_session_keyed_from_jwt_secret_is_refused(keys):
    # E8: the website holds JWT_SECRET, so it could have minted this one.
    key = tokens.hkdf_sha256(SECRET.encode(), b"vertex-token-keys", b"vertex/jwt/session/v1")
    with pytest.raises(tokens.InvalidToken, match="not ES256"):
        tokens.verify_session_token(jwt.encode(claims(), key, algorithm="HS256"))


def test_the_golden_vector_the_website_also_checks(monkeypatch):
    monkeypatch.setattr(settings, "SESSION_PUBLIC_KEYS", SESSION_PUBLIC_KEY_B64)
    assert list(session_keys.public_keys(SESSION_PUBLIC_KEY_B64)) == [SESSION_KEY_ID]
    got = tokens.verify_session_token(ES256_SESSION_TOKEN)
    assert (got.user_id, got.sid, got.ver) == ("golden-user", "golden-family", 3)


@pytest.mark.parametrize("case", ["unlisted key", "unknown kid", "no kid", "kid of a listed key, signed by another"])
def test_a_session_from_an_unlisted_key_is_refused(keys, case):
    current, _ = keys
    stranger = new_key()
    token = {
        "unlisted key": es256(stranger),
        "unknown kid": es256(current, kid="nope"),
        "no kid": jwt.encode(claims(), current, algorithm="ES256"),
        "kid of a listed key, signed by another": es256(stranger, kid=key_id(current.public_key())),
    }[case]
    with pytest.raises(tokens.InvalidToken):
        tokens.verify_session_token(token)


def hmac_signed(header: dict, secret: bytes) -> str:
    """A token signed with HMAC-SHA256 under any header, by hand."""
    segments = [jwt.utils.base64url_encode(json.dumps(part).encode()) for part in (header, claims())]
    signing_input = b".".join(segments)
    return (signing_input + b"." + jwt.utils.base64url_encode(hmac.new(secret, signing_input, hashlib.sha256).digest())).decode()


@pytest.mark.parametrize("alg", ["HS256", "ES256"])
def test_the_public_key_used_as_an_hmac_secret_is_refused(keys, alg):
    # The classic algorithm-confusion forgery: anyone has the public key.
    current, _ = keys
    pem = base64.b64decode(b64_public(current))
    with pytest.raises(tokens.InvalidToken):
        tokens.verify_session_token(hmac_signed({"alg": alg, "kid": key_id(current.public_key())}, pem))


def test_an_unsigned_session_is_refused(keys):
    with pytest.raises(tokens.InvalidToken):
        tokens.verify_session_token(jwt.encode(claims(), None, algorithm="none"))


@pytest.mark.parametrize("bad", [{"aud": "vertex:password_reset"}, {"iss": "elsewhere"}, {"exp": 1}, {"sid": ""}, {"ver": "3"}])
def test_an_es256_session_keeps_every_other_rule(keys, bad):
    current, _ = keys
    with pytest.raises(tokens.InvalidToken):
        tokens.verify_session_token(es256(current, **bad))


def test_no_listed_keys_means_no_es256_session_verifies(keys, monkeypatch):
    current, _ = keys
    monkeypatch.setattr(settings, "SESSION_PUBLIC_KEYS", None)
    with pytest.raises(tokens.InvalidToken):
        tokens.verify_session_token(es256(current))


# --- startup checks ----------------------------------------------------------------


def make_settings(**env) -> Settings:
    # None unless given: the suite's own keys are in the environment.
    base = {"DATABASE_URL": "postgresql://u:p@localhost/db", "APP_ENV": "development",
            "SESSION_PRIVATE_KEY": None, "SESSION_PUBLIC_KEYS": None, "ACCOUNT_LINK_SECRET": None}
    return Settings(_env_file=None, **{**base, **env})


def test_a_matching_key_pair_starts():
    key = new_key()
    s = make_settings(SESSION_PRIVATE_KEY=b64_private(key), SESSION_PUBLIC_KEYS=f"{b64_public(new_key())},{b64_public(key)}")
    assert s.SESSION_PRIVATE_KEY


def test_blank_keys_are_unset():
    s = make_settings(SESSION_PRIVATE_KEY="", SESSION_PUBLIC_KEYS=" ", ACCOUNT_LINK_SECRET="")
    assert (s.SESSION_PRIVATE_KEY, s.SESSION_PUBLIC_KEYS, s.ACCOUNT_LINK_SECRET) == (None, None, None)


@pytest.mark.parametrize(
    "env, message",
    [
        (lambda k: {"SESSION_PRIVATE_KEY": b64_private(k), "SESSION_PUBLIC_KEYS": b64_public(new_key())}, "not in SESSION_PUBLIC_KEYS"),
        (lambda k: {"SESSION_PRIVATE_KEY": b64_private(k)}, "not in SESSION_PUBLIC_KEYS"),
        (lambda k: {"SESSION_PUBLIC_KEYS": "not base64!"}, "not base64"),
        (lambda k: {"SESSION_PRIVATE_KEY": "not base64!", "SESSION_PUBLIC_KEYS": b64_public(k)}, "SESSION_PRIVATE_KEY is not base64"),
        (lambda k: {"SESSION_PUBLIC_KEYS": base64.b64encode(b"hello").decode()}, "not a PEM public key"),
        (lambda k: {"SESSION_PUBLIC_KEYS": b64_public(new_key(ec.SECP384R1()))}, "not a P-256"),
        (lambda k: {"SESSION_PRIVATE_KEY": "aGVsbG8=", "SESSION_PUBLIC_KEYS": b64_public(k)}, "not an unencrypted PEM private key"),
        (lambda k: {"ACCOUNT_LINK_SECRET": "short"}, "a 32"),
        (lambda k: {"ACCOUNT_LINK_SECRET": SECRET, "JWT_SECRET": SECRET}, "must differ"),
    ],
)
def test_unusable_keys_stop_startup(env, message):
    with pytest.raises(ValueError, match=message):
        make_settings(**env(new_key()))


def test_a_bad_key_never_appears_in_the_error():
    key = new_key()
    with pytest.raises(BadKey) as err:
        session_keys.check(b64_private(key), b64_public(new_key()))
    assert b64_private(key)[:40] not in str(err.value)


# --- account links (D4) ------------------------------------------------------------


@pytest.fixture
def link_secrets(monkeypatch):
    monkeypatch.setattr(settings, "JWT_SECRET", SECRET)
    monkeypatch.setattr(settings, "ACCOUNT_LINK_SECRET", LINK_SECRET)


def link(purpose: str, secret: str, **payload) -> str:
    now = int(time.time())
    body = {**payload, "iat": now, "exp": now + 600, "iss": "vertex-web", "aud": f"vertex:{purpose}"}
    return jwt.encode(body, tokens.key_for(purpose, secret), algorithm="HS256")


def test_a_link_keyed_from_fastapis_secret_verifies(link_secrets):
    secret = LINK_SECRET
    assert tokens.verify_account_setup_token(link("account_setup", secret, userId="u1", type="account_setup")) == "u1"
    got = tokens.verify_email_token(link("email_verification", secret, userId="u1", email="e@test.invalid", type="email_verification"), "email_verification")
    assert got.user_id == "u1"
    agent = link("referral_agent_email_verification", secret, referralAgentId="a1", type="referral_agent_email_verification")
    assert tokens.verify_referral_agent_verification_token(agent) == "a1"


@pytest.mark.parametrize("purpose", ["account_setup", "email_verification", "password_reset", "referral_agent_email_verification"])
def test_a_link_keyed_from_jwt_secret_is_refused(link_secrets, purpose):
    # E8: the website holds JWT_SECRET, so it could forge one.
    token = link(purpose, SECRET, userId="u1", email="e@test.invalid", referralAgentId="a1", type=purpose)
    verify = {
        "account_setup": tokens.verify_account_setup_token,
        "email_verification": lambda t: tokens.verify_email_token(t, "email_verification"),
        "password_reset": lambda t: tokens.verify_email_token(t, "password_reset"),
        "referral_agent_email_verification": tokens.verify_referral_agent_verification_token,
    }[purpose]
    with pytest.raises(tokens.InvalidToken):
        verify(token)


def test_a_link_keyed_from_any_other_secret_is_refused(link_secrets):
    with pytest.raises(tokens.InvalidToken):
        tokens.verify_account_setup_token(link("account_setup", OTHER_SECRET, userId="u1", type="account_setup"))


def test_an_expired_link_is_refused_without_trying_the_next_secret(link_secrets):
    now = int(time.time())
    expired = jwt.encode({"userId": "u1", "type": "account_setup", "iat": now - 900, "exp": now - 60, "iss": "vertex-web", "aud": "vertex:account_setup"},
                         tokens.key_for("account_setup", LINK_SECRET), algorithm="HS256")
    with pytest.raises(tokens.InvalidToken, match="ExpiredSignatureError"):
        tokens.verify_account_setup_token(expired)


def test_a_reset_link_names_its_password_under_its_own_secret(link_secrets):
    secret = LINK_SECRET
    hashed = "$2b$12$abcdefghijklmnopqrstuv"
    pwd = tokens.password_fingerprint(hashed, secret)
    got = tokens.verify_email_token(link("password_reset", secret, userId="u1", email="e@test.invalid", type="password_reset", pwd=pwd), "password_reset")
    assert got.issued_for(hashed)
    assert not got.issued_for("$2b$12$another")


def test_a_fingerprint_from_the_other_secret_does_not_pass(link_secrets):
    hashed = "$2b$12$abcdefghijklmnopqrstuv"
    pwd = tokens.password_fingerprint(hashed, SECRET)  # signed with the new secret, fingerprinted with the old
    got = tokens.verify_email_token(link("password_reset", LINK_SECRET, userId="u1", email="e@test.invalid", type="password_reset", pwd=pwd), "password_reset")
    assert not got.issued_for(hashed)


def test_links_are_keyed_from_the_new_secret_when_the_stack_has_it(link_secrets):
    # K2: a link the website could forge is never issued once the stack has
    # ACCOUNT_LINK_SECRET.
    token = tokens.sign_account_setup_token("u1")
    jwt.decode(token, tokens.key_for("account_setup", LINK_SECRET), algorithms=["HS256"], audience="vertex:account_setup")
    with pytest.raises(jwt.InvalidSignatureError):
        jwt.decode(token, tokens.key_for("account_setup", SECRET), algorithms=["HS256"], audience="vertex:account_setup")
    hashed = "$2b$12$abcdefghijklmnopqrstuv"
    reset = tokens.verify_email_token(tokens.sign_reset_token("u1", "e@test.invalid", hashed), "password_reset")
    assert reset.issued_for(hashed) and reset.pwd == tokens.password_fingerprint(hashed, LINK_SECRET)


def test_no_link_is_signed_or_checked_without_fastapis_secret(link_secrets, monkeypatch):
    token = tokens.sign_account_setup_token("u1")
    monkeypatch.setattr(settings, "ACCOUNT_LINK_SECRET", None)
    with pytest.raises(tokens.InvalidToken, match="ACCOUNT_LINK_SECRET"):
        tokens.sign_verification_token("u1", "e@test.invalid")
    with pytest.raises(tokens.InvalidToken, match="ACCOUNT_LINK_SECRET"):
        tokens.verify_account_setup_token(token)


# --- signing sessions (K2) ---------------------------------------------------------------


def test_sessions_are_signed_with_the_private_key_when_the_stack_has_it(keys, monkeypatch):
    current, previous = keys
    monkeypatch.setattr(settings, "SESSION_PRIVATE_KEY", b64_private(current))
    token = tokens.sign_session_token(user_id="u1", email="u1@test.invalid", role="admin", sid="f1", ver=2)
    assert jwt.get_unverified_header(token) == {"alg": "ES256", "kid": key_id(current.public_key()), "typ": "JWT"}
    assert tokens.verify_session_token(token).ver == 2
    body = jwt.decode(token, options={"verify_signature": False})
    assert body["exp"] - body["iat"] == 900
    # Only the listed keys verify it: not the shared key, not another listed key.
    with pytest.raises(jwt.InvalidSignatureError):
        jwt.decode(token, previous.public_key(), algorithms=["ES256"], audience="vertex:session")


def test_no_session_is_signed_without_the_private_key(keys, monkeypatch):
    monkeypatch.setattr(settings, "SESSION_PRIVATE_KEY", None)
    with pytest.raises(tokens.InvalidToken, match="SESSION_PRIVATE_KEY"):
        tokens.sign_session_token(user_id="u1", email="u1@test.invalid", role="admin", sid="f1", ver=0)


@pytest.mark.parametrize("missing", ["SESSION_PRIVATE_KEY", "SESSION_PUBLIC_KEYS", "ACCOUNT_LINK_SECRET"])
def test_a_deployed_stack_wont_start_without_its_keys(missing):
    key = new_key()
    env = {
        "APP_ENV": "staging", "SECRET_KEY": "s" * 40, "JWT_SECRET": SECRET, "SERVICE_AUTH_SECRET": "v" * 40,
        "SESSION_PRIVATE_KEY": b64_private(key), "SESSION_PUBLIC_KEYS": b64_public(key), "ACCOUNT_LINK_SECRET": LINK_SECRET,
    }
    assert make_settings(**env).APP_ENV == "staging"
    with pytest.raises(ValueError, match=missing):
        make_settings(**{**env, missing: None})


def test_a_sign_in_and_a_refresh_issue_es256_sessions_the_api_accepts(keys, api, db, monkeypatch):
    current, _ = keys
    monkeypatch.setattr(settings, "SESSION_PRIVATE_KEY", b64_private(current))
    session = sign_in(api, account(db, role=Role.director)).json()["data"]["session"]
    assert jwt.get_unverified_header(session["access_token"])["alg"] == "ES256"
    assert api.get("/api/v1/me", headers={"Authorization": f"Bearer {session['access_token']}"}).status_code == 200
    renewed = refresh(api, session["refresh_token"]).json()["data"]["session"]
    assert jwt.get_unverified_header(renewed["access_token"])["alg"] == "ES256"


# --- through current_user (app/core/auth.py) ------------------------------------------


def test_a_live_session_signed_by_a_listed_key_is_let_in(keys, db, client):
    current, _ = keys
    u = User(full_name="Keys Test", email=f"keys-{time.time_ns()}@test.invalid", role=Role.director)
    db.add(u)
    db.flush()
    db.refresh(u)
    s = add_session(db, u.id)
    app.dependency_overrides[get_db] = lambda: db
    try:
        headers = {"Authorization": f"Bearer {es256(current, userId=u.id, sid=s.family_id, ver=u.token_version)}"}
        assert client.get("/api/v1/me", headers=headers).json()["data"]["id"] == u.id
        # The signature is necessary, not sufficient: an ended session is refused.
        db.execute(update(RefreshToken).where(RefreshToken.id == s.id).values(revoked_at=s.created_at))
        db.flush()
        assert client.get("/api/v1/me", headers=headers).status_code == 401
    finally:
        app.dependency_overrides.pop(get_db, None)
