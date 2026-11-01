"""app/core/tokens.py verifies exactly the session tokens FastAPI signs (ES256
with its private key, since session keys K3) and nothing else; in particular
not the shared-key sessions the website's code signed (exception E8, closed
by K3). The golden vectors come from the Node code path itself
(tests/node_session_vectors.py)."""

import re
import time

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import ec

from app.core import session_keys, tokens
from app.core.config import BASE_DIR, settings
from app.core.tokens import InvalidToken, SessionClaims, hkdf_sha256, key_for, verify_candidate_invite_token, verify_session_token
from tests.node_session_vectors import (
    INVITE_CANDIDATE_ID,
    INVITE_KEY_HEX,
    INVITE_TOKEN,
    PASSWORD_RESET_KEY_HEX,
    RESET_KEY_TOKEN,
    SECRET,
    SESSION_KEY_HEX,
    SESSION_TOKEN,
)

CLAIMS = {"userId": "u1", "email": "u1@test.invalid", "role": "admin", "sid": "fam1", "ver": 0}


def stack_key():
    """The suite's session key (tests/conftest.py) and its id."""
    kid, private = session_keys.private_key(settings.SESSION_PRIVATE_KEY)
    return private, kid


def mint(claims=None, *, key=None, alg="ES256", kid=None, iss="vertex-web", aud="vertex:session", exp_in=900, **extra):
    payload = {**(CLAIMS if claims is None else claims), "iat": int(time.time()), **extra}
    if exp_in is not None:
        payload["exp"] = int(time.time()) + exp_in
    if iss is not None:
        payload["iss"] = iss
    if aud is not None:
        payload["aud"] = aud
    private, stack_kid = stack_key()
    return jwt.encode(payload, private if key is None else key, algorithm=alg, headers={"kid": kid or stack_kid})


def node_session_key() -> bytes:
    """The session key the website's code derived from JWT_SECRET."""
    return hkdf_sha256(SECRET.encode(), b"vertex-token-keys", b"vertex/jwt/session/v1")


def test_key_derivation_matches_node_hkdf():
    assert node_session_key().hex() == SESSION_KEY_HEX
    info = b"vertex/jwt/password_reset/v1"
    assert hkdf_sha256(SECRET.encode(), b"vertex-token-keys", info).hex() == PASSWORD_RESET_KEY_HEX


def test_hkdf_matches_rfc5869_test_case_1():
    ikm = bytes.fromhex("0b" * 22)
    salt = bytes.fromhex("000102030405060708090a0b0c")
    info = bytes.fromhex("f0f1f2f3f4f5f6f7f8f9")
    okm = "3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf34007208d5b887185865"
    assert hkdf_sha256(ikm, salt, info, 42).hex() == okm


def test_a_session_fastapi_signs_verifies():
    token = tokens.sign_session_token(user_id="u1", email="u1@test.invalid", role="admin", sid="fam1", ver=2)
    assert verify_session_token(token) == SessionClaims(user_id="u1", email="u1@test.invalid", role="admin", sid="fam1", ver=2)


def test_a_session_the_websites_code_signed_is_refused():
    # E8, closed by K3: the website holds JWT_SECRET, so a session keyed from
    # it would be one the website could mint.
    with pytest.raises(InvalidToken, match="not ES256"):
        verify_session_token(SESSION_TOKEN)
    with pytest.raises(InvalidToken, match="not ES256"):
        verify_session_token(mint(key=node_session_key(), alg="HS256"))


def test_a_token_signed_with_another_purposes_key_is_refused():
    with pytest.raises(InvalidToken):
        verify_session_token(RESET_KEY_TOKEN)


@pytest.mark.parametrize(
    "token",
    [
        pytest.param(lambda: mint(exp_in=-1), id="expired"),
        pytest.param(lambda: mint(exp_in=None), id="no expiry"),
        pytest.param(lambda: mint(aud="vertex:password_reset"), id="other purpose's audience"),
        pytest.param(lambda: mint(aud=None), id="no audience"),
        pytest.param(lambda: mint(iss="someone-else"), id="wrong issuer"),
        pytest.param(lambda: mint(iss=None), id="no issuer"),
        pytest.param(lambda: mint(key=ec.generate_private_key(ec.SECP256R1())), id="another key under the stack's key id"),
        pytest.param(lambda: mint(kid="unknown"), id="unknown key id"),
        pytest.param(lambda: mint(key=SECRET.encode(), alg="HS256"), id="signed with JWT_SECRET itself (pre-G17)"),
        pytest.param(lambda: mint(key=ec.generate_private_key(ec.SECP384R1()), alg="ES384"), id="other algorithm"),
        pytest.param(lambda: jwt.encode({**CLAIMS, "exp": int(time.time()) + 60, "iss": "vertex-web", "aud": "vertex:session"}, None, algorithm="none"), id="alg none"),
        pytest.param(lambda: "not-a-token", id="garbage"),
    ],
)
def test_bad_tokens_are_refused(token):
    with pytest.raises(InvalidToken):
        verify_session_token(token())


@pytest.mark.parametrize("field", ["userId", "email", "role", "sid"])
@pytest.mark.parametrize("value", [None, "", 7])
def test_string_claims_must_be_non_empty_strings(field, value):
    claims = {**CLAIMS}
    if value is None:
        del claims[field]
    else:
        claims[field] = value
    with pytest.raises(InvalidToken):
        verify_session_token(mint(claims))


@pytest.mark.parametrize("ver", [None, "0", 1.5, True])
def test_ver_must_be_an_integer(ver):
    claims = {**CLAIMS}
    if ver is None:
        del claims["ver"]
    else:
        claims["ver"] = ver
    with pytest.raises(InvalidToken):
        verify_session_token(mint(claims))


def test_nothing_verifies_without_listed_keys_or_signs_without_the_private_key(monkeypatch):
    token = mint()
    monkeypatch.setattr(tokens.settings, "SESSION_PUBLIC_KEYS", None)
    with pytest.raises(InvalidToken):
        verify_session_token(token)
    monkeypatch.setattr(tokens.settings, "SESSION_PRIVATE_KEY", None)
    with pytest.raises(InvalidToken, match="SESSION_PRIVATE_KEY"):
        tokens.sign_session_token(user_id="u1", email="e", role="admin", sid="f", ver=0)


# --- screening invites (pipeline handover step 6.2) ---------------------------


def test_the_key_versions_match_jwt_ts():
    src = (BASE_DIR.parent / "vertex" / "src" / "lib" / "jwt.ts").read_text(encoding="utf-8")
    versions = dict(re.findall(r"^  (\w+): (\d+),$", re.search(r"const KEY_VERSION[^{]*\{(.*?)\};", src, re.S).group(1), re.M))
    # The account links are FastAPI's alone since users step 8.5; every
    # purpose the website still has must keep the same version.
    # Sessions are ES256 and the account links FastAPI's alone since session
    # keys K3; every purpose both sides still key from a shared secret must
    # keep the same version.
    shared = {"service", "candidate_invite", "cif_upload"}
    assert set(versions) == shared | {"document"}  # documents are the website's alone
    assert {purpose: int(versions[purpose]) for purpose in shared} == {purpose: tokens.KEY_VERSION[purpose] for purpose in shared}


def test_an_invite_signed_by_nextjs_verifies():
    assert key_for("candidate_invite", SECRET).hex() == INVITE_KEY_HEX
    assert verify_candidate_invite_token(INVITE_TOKEN) == INVITE_CANDIDATE_ID


def invite(**claims):
    payload = {"candidateId": "c1", "type": "candidate_invite", "exp": int(time.time()) + 60, "iss": "vertex-web", "aud": "vertex:candidate_invite"}
    return jwt.encode({k: v for k, v in (payload | claims).items() if v is not None}, key_for("candidate_invite", SECRET), algorithm="HS256")


@pytest.mark.parametrize(
    "token",
    [
        pytest.param(lambda: SESSION_TOKEN, id="a session"),
        pytest.param(lambda: invite(exp=int(time.time()) - 1), id="expired"),
        pytest.param(lambda: invite(exp=None), id="no expiry"),
        pytest.param(lambda: invite(aud="vertex:session"), id="another audience"),
        pytest.param(lambda: invite(candidateId=None), id="no candidate"),
        pytest.param(lambda: invite(candidateId=""), id="empty candidate"),
        pytest.param(lambda: invite(candidateId=7), id="candidate not a string"),
    ],
)
def test_bad_invites_are_refused(token):
    with pytest.raises(InvalidToken):
        verify_candidate_invite_token(token())
