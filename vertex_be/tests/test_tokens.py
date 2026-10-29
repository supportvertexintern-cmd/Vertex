"""app/core/tokens.py verifies exactly the session tokens Next.js signs
(vertex/src/lib/jwt.ts) and nothing else. The golden vectors come from the
Node code path itself (tests/node_session_vectors.py)."""

import re
import time

import jwt
import pytest

from app.core import tokens
from app.core.config import BASE_DIR
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


def mint(claims=None, *, key=None, alg="HS256", iss="vertex-web", aud="vertex:session", exp_in=900, **extra):
    payload = {**(CLAIMS if claims is None else claims), "iat": int(time.time()), **extra}
    if exp_in is not None:
        payload["exp"] = int(time.time()) + exp_in
    if iss is not None:
        payload["iss"] = iss
    if aud is not None:
        payload["aud"] = aud
    return jwt.encode(payload, key if key is not None else key_for("session", SECRET), algorithm=alg)


def test_key_derivation_matches_node_hkdf():
    assert key_for("session", SECRET).hex() == SESSION_KEY_HEX
    info = b"vertex/jwt/password_reset/v1"
    assert hkdf_sha256(SECRET.encode(), b"vertex-token-keys", info).hex() == PASSWORD_RESET_KEY_HEX


def test_hkdf_matches_rfc5869_test_case_1():
    ikm = bytes.fromhex("0b" * 22)
    salt = bytes.fromhex("000102030405060708090a0b0c")
    info = bytes.fromhex("f0f1f2f3f4f5f6f7f8f9")
    okm = "3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf34007208d5b887185865"
    assert hkdf_sha256(ikm, salt, info, 42).hex() == okm


def test_a_token_signed_by_nextjs_verifies():
    assert verify_session_token(SESSION_TOKEN) == SessionClaims(
        user_id="golden-user", email="golden@test.invalid", role="admin", sid="golden-family", ver=3
    )


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
        pytest.param(lambda: mint(key=b"x" * 32), id="wrong key"),
        pytest.param(lambda: mint(key=SECRET.encode()), id="signed with JWT_SECRET itself (pre-G17)"),
        pytest.param(lambda: mint(alg="HS512"), id="other algorithm"),
        pytest.param(lambda: mint(alg="none", key=""), id="alg none"),
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


@pytest.mark.parametrize("secret", [None, "too-short"])
def test_nothing_verifies_without_a_proper_secret(monkeypatch, secret):
    monkeypatch.setattr(tokens.settings, "JWT_SECRET", secret)
    with pytest.raises(InvalidToken):
        verify_session_token(SESSION_TOKEN)


# --- screening invites (pipeline handover step 6.2) ---------------------------


def test_the_key_versions_match_jwt_ts():
    src = (BASE_DIR.parent / "vertex" / "src" / "lib" / "jwt.ts").read_text(encoding="utf-8")
    versions = dict(re.findall(r"^  (\w+): (\d+),$", re.search(r"const KEY_VERSION[^{]*\{(.*?)\};", src, re.S).group(1), re.M))
    assert {purpose: int(versions[purpose]) for purpose in tokens.KEY_VERSION} == tokens.KEY_VERSION


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
