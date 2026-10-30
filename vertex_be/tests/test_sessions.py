"""Sessions (users and sessions step 8.2) as Next.js issued them: the same
sign-in checks, messages and status codes, the same rotation, race window
and reuse detection, the same lifetimes and revocation, and #131's Google
rules. Ported from the website's session-revocation and app-auth
integration tests, plus the security review's checks (users-handover.md
§6: #6, #10, #13, #15, #16)."""

import base64
import json
import logging
import secrets
from datetime import timedelta

import bcrypt
import pytest
from sqlalchemy import select

from app.api.v1 import sessions as api_sessions
from app.core.config import settings
from app.core.tokens import sign_session_token, verify_session_token
from app.db.session import get_db
from app.main import app
from app.models.enums import Role
from app.models.identity import RefreshToken, User
from app.services import sessions
from app.services.google_signin import GoogleFailed, GoogleUser, google_client
from tests.node_session_vectors import SESSION_TOKEN
from tests.test_auth import bearer, utcnow
from tests.test_db_roles import roles_provisioned  # noqa: F401  (vertex_api must exist)
from tests.test_service_auth import SERVICE_SECRET, service_token

PASSWORD = "Correct-Horse-9"
IP = "203.0.113.7"
BROWSER = "Mozilla/5.0 (pytest)"


class FakeGoogle:
    def __init__(self):
        self.user: GoogleUser | None = None
        self.fail: str | None = None

    def user_for_code(self, code, redirect_uri):
        if self.fail:
            raise GoogleFailed(self.fail)
        return self.user


@pytest.fixture
def google():
    return FakeGoogle()


@pytest.fixture
def api(db, client, monkeypatch, google):
    monkeypatch.setattr(settings, "SERVICE_AUTH_SECRET", SERVICE_SECRET)
    monkeypatch.setattr(settings, "SERVICE_AUTH_SECRET_PREVIOUS", None)
    monkeypatch.setattr(api_sessions, "_failures", {})
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[google_client] = lambda: google
    yield client
    app.dependency_overrides.pop(get_db, None)
    app.dependency_overrides.pop(google_client, None)


def svc() -> dict[str, str]:
    """What the website sends: its credential, the browser's address and device."""
    return {"X-Vertex-Service": service_token(), "X-Forwarded-For": IP, "User-Agent": BROWSER}


def account(db, *, role=Role.candidate, password=PASSWORD, verified=True, **fields) -> User:
    u = User(
        full_name="Session Test", email=f"s-{secrets.token_hex(4)}@test.invalid", role=role, email_verified=verified,
        password_hash=bcrypt.hashpw(password.encode()[:72], bcrypt.gensalt(4)).decode() if password else None, **fields,
    )
    db.add(u)
    db.flush()
    db.refresh(u)
    return u


def sign_in(api, user, password=PASSWORD, client="web"):
    return api.post("/api/v1/auth/login", headers=svc(), json={"email": user.email, "password": password, "client": client})


def events(caplog, action):
    return [r.fields for r in caplog.records if getattr(r, "event", None) == f"security.{action}"]


def row_for(db, raw: str) -> RefreshToken:
    return db.scalar(select(RefreshToken).where(RefreshToken.token_hash == sessions.hash_refresh_token(raw)))


# --- sign-in ----------------------------------------------------------------------


def test_sign_in_issues_a_session_the_website_and_fastapi_accept(api, db, caplog):
    user = account(db, role=Role.director)
    with caplog.at_level(logging.INFO, logger="vertex"):
        res = sign_in(api, user)
    assert res.status_code == 200
    data = res.json()["data"]
    assert data["user"] == {"id": user.id, "full_name": "Session Test", "email": user.email, "role": "director"}
    s = data["session"]
    claims = verify_session_token(s["access_token"])
    assert (claims.user_id, claims.sid, claims.ver, claims.role) == (user.id, s["family_id"], user.token_version, "director")
    assert api.get("/api/v1/me", headers=bearer(s["access_token"])).status_code == 200
    row = row_for(db, s["refresh_token"])
    assert (row.family_id, row.device_info, row.token_hash != s["refresh_token"]) == (s["family_id"], BROWSER, True)
    [ok] = events(caplog, "login_succeeded")
    assert (ok["method"], ok["client"], ok["role"], ok["ip"]) == ("password", "web", "director", IP)


def test_an_unknown_account_and_a_wrong_password_get_the_same_answer(api, db, caplog):
    user = account(db)
    with caplog.at_level(logging.INFO, logger="vertex"):
        wrong = sign_in(api, user, "Wrong-Password-1")
        unknown = api.post("/api/v1/auth/login", headers=svc(), json={"email": "nobody-here@test.invalid", "password": PASSWORD})
    for res in (wrong, unknown):
        assert (res.status_code, res.json()["error"]["code"], res.json()["error"]["message"]) == (401, "invalid_credentials", "Invalid email or password.")
    failed = events(caplog, "login_failed")
    assert [f["reason"] for f in failed] == ["bad_password", "unknown_account"]
    assert failed[0]["email_fp"] == sessions.email_fingerprint(user.email) == wrong.json()["error"]["details"]["email_fp"]
    # Never what was typed.
    assert all(PASSWORD not in json.dumps(f) and "Wrong-Password-1" not in json.dumps(f) and user.email not in json.dumps(f) for f in failed)


def test_an_unverified_account_is_refused_with_its_own_message(api, db):
    res = sign_in(api, account(db, verified=False))
    assert (res.status_code, res.json()["error"]["message"]) == (403, "Please verify your email before logging in.")


def test_an_account_without_a_password_is_refused_like_a_wrong_one(api, db):
    res = sign_in(api, account(db, password=None))
    assert res.status_code == 401 and res.json()["error"]["code"] == "invalid_credentials"


def test_a_password_never_comes_back_in_a_validation_error(api, db, caplog):
    with caplog.at_level(logging.DEBUG):
        res = api.post("/api/v1/auth/login", headers=svc(), json={"email": "not-an-email", "password": "Secret-Typed-77"})
    assert res.status_code == 422 and res.json()["error"]["details"]["email"] == ["Invalid email address"]
    assert "Secret-Typed-77" not in res.text
    assert all("Secret-Typed-77" not in r.getMessage() and "Secret-Typed-77" not in json.dumps(getattr(r, "fields", {}), default=str) for r in caplog.records)
    empty = api.post("/api/v1/auth/login", headers=svc(), json={"email": "a@test.invalid", "password": ""})
    assert empty.json()["error"]["details"]["password"] == ["Password is required"]


def test_a_long_password_set_on_the_website_still_works(api, db):
    # bcryptjs hashed only the first 72 bytes; Python's bcrypt refuses more.
    long = "Long-Password-1" + "é" * 60  # 135 bytes in UTF-8
    user = account(db, password=long)
    assert sign_in(api, user, long).status_code == 200
    assert sign_in(api, user, long[:-1] + "x").status_code == 200  # beyond 72 bytes, as bcryptjs
    assert sign_in(api, user, "x" + long[1:]).status_code == 401


def test_an_existing_bcryptjs_hash_verifies(api, db):
    # $2a$, cost 12, as bcryptjs wrote them before it moved to $2b$.
    user = account(db)
    user.password_hash = bcrypt.hashpw(PASSWORD.encode(), bcrypt.gensalt(4, prefix=b"2a")).decode()
    db.flush()
    assert sign_in(api, user).status_code == 200


def test_ten_failures_lock_the_account_for_a_while(api, db, caplog):
    user = account(db)
    for _ in range(api_sessions.ACCOUNT_MAX_FAILURES):
        assert sign_in(api, user, "Wrong-Password-1").status_code == 401
    with caplog.at_level(logging.INFO, logger="vertex"):
        locked = sign_in(api, user)  # even the right password
    assert (locked.status_code, locked.json()["error"]["code"]) == (429, "rate_limited")
    assert events(caplog, "login_rate_limited")[0]["scope"] == "account"
    assert sign_in(api, account(db)).status_code == 200  # another account isn't


def test_sign_in_answers_only_the_website(api, db):
    user = account(db)
    res = api.post("/api/v1/auth/login", json={"email": user.email, "password": PASSWORD})
    assert res.status_code == 401


def test_a_forwarded_address_is_ignored_without_the_websites_credential(db):
    from starlette.requests import Request

    scope = {"type": "http", "headers": [(b"x-forwarded-for", b"198.51.100.9")], "path": "/", "method": "POST"}
    assert api_sessions._client_ip(Request(scope)) is None


def test_lifetimes_staff_twelve_hours_candidates_and_partners_fourteen_days(api, db):
    for role, hours in ((Role.admin, 12), (Role.finance, 12), (Role.candidate, 336), (Role.partner, 336)):
        expires = sessions.start_session(db, account(db, role=role), None).refresh_expires_at
        assert abs((expires - utcnow()) - timedelta(hours=hours)) < timedelta(minutes=1), role


# --- refresh ----------------------------------------------------------------------


def refresh(api, raw):
    return api.post("/api/v1/auth/refresh", headers=svc(), json={"refresh_token": raw})


def test_a_refresh_rotates_and_spends_the_old_token(api, db):
    s = sign_in(api, account(db)).json()["data"]["session"]
    res = refresh(api, s["refresh_token"])
    new = res.json()["data"]["session"]
    assert res.status_code == 200 and new["family_id"] == s["family_id"] and new["refresh_token"] != s["refresh_token"]
    assert new["refresh_expires_at"] == s["refresh_expires_at"]  # rotation doesn't extend a session
    assert row_for(db, s["refresh_token"]).used_at is not None
    assert row_for(db, new["refresh_token"]).used_at is None


def test_reusing_a_spent_token_revokes_the_whole_session_and_reports_it(api, db, caplog):
    s = sign_in(api, account(db)).json()["data"]["session"]
    new = refresh(api, s["refresh_token"]).json()["data"]["session"]
    row_for(db, s["refresh_token"]).used_at = utcnow() - timedelta(minutes=1)  # outside the race window
    db.flush()
    with caplog.at_level(logging.INFO, logger="vertex"):
        res = refresh(api, s["refresh_token"])
    error = res.json()["error"]
    assert (res.status_code, error["code"], error["details"]["reason"], error["details"]["session"]) == (401, "session_ended", "reused", s["family_id"])
    [reused] = events(caplog, "refresh_token_reused")
    assert (reused["entity_id"], reused["actor_id"], reused["ip"]) == (s["family_id"], error["details"]["user_id"], IP)
    assert row_for(db, new["refresh_token"]).revoke_reason == "reuse_detected"
    assert refresh(api, new["refresh_token"]).json()["error"]["details"]["reason"] == "revoked"


def test_two_tabs_refreshing_at_once_is_a_race_not_theft(api, db):
    s = sign_in(api, account(db)).json()["data"]["session"]
    winner = refresh(api, s["refresh_token"]).json()["data"]["session"]
    loser = refresh(api, s["refresh_token"])
    assert loser.json()["error"]["details"] == {"reason": "superseded"}
    assert refresh(api, winner["refresh_token"]).status_code == 200  # the family survives


@pytest.mark.parametrize("raw", [None, "", "never-issued"])
def test_a_missing_or_unknown_token_is_refused(api, raw):
    res = refresh(api, raw)
    assert (res.status_code, res.json()["error"]["details"]["reason"]) == (401, "missing" if not raw else "unknown")


def test_an_expired_or_revoked_token_is_refused(api, db):
    user = account(db)
    expired = sessions.start_session(db, user, None)
    row_for(db, expired.refresh_token).expires_at = utcnow() - timedelta(seconds=1)
    revoked = sessions.start_session(db, user, None)
    sessions.revoke_family(db, revoked.family_id, "logout")
    assert refresh(api, expired.refresh_token).json()["error"]["details"]["reason"] == "expired"
    assert refresh(api, revoked.refresh_token).json()["error"]["details"]["reason"] == "revoked"


def test_a_password_change_ends_the_session_at_its_next_refresh(api, db):
    user = account(db)
    s = sessions.start_session(db, user, None)
    user.password_hash = bcrypt.hashpw(b"Another-Pass-2", bcrypt.gensalt(4)).decode()  # the trigger bumps token_version
    db.flush()
    assert refresh(api, s.refresh_token).json()["error"]["details"]["reason"] == "version_changed"
    assert row_for(db, s.refresh_token).revoke_reason == "token_version_changed"


# --- sign-out and the session lists ---------------------------------------------------


def test_sign_out_by_refresh_token_ends_the_session(api, db):
    s = sessions.start_session(db, account(db), None)
    res = api.post("/api/v1/auth/logout", headers=svc(), json={"refresh_token": s.refresh_token, "client": "app"})
    assert res.json() == {"data": {"signed_out": True}}
    assert row_for(db, s.refresh_token).revoke_reason == "logout"
    assert api.get("/api/v1/me", headers=bearer(s.access_token)).status_code == 401


def test_the_browser_signs_out_its_own_session_without_a_refresh_token(api, db):
    s = sessions.start_session(db, account(db), None)
    res = api.post("/api/v1/auth/logout", headers=svc() | bearer(s.access_token), json={})
    assert res.status_code == 200 and row_for(db, s.refresh_token).revoke_reason == "logout"


def test_sign_out_answers_the_same_for_a_token_it_doesnt_know(api):
    res = api.post("/api/v1/auth/logout", headers=svc(), json={"refresh_token": "never-issued", "client": "app"})
    assert res.json() == {"data": {"signed_out": True}}


def test_a_user_lists_and_ends_their_own_sessions_only(api, db):
    me, other = account(db), account(db)
    a = sessions.start_session(db, me, "Laptop")
    b = sessions.start_session(db, me, "Phone")
    theirs = sessions.start_session(db, other, None)
    listed = api.get("/api/v1/auth/sessions", headers=bearer(a.access_token)).json()["data"]
    assert {(r["id"], r["device"], r["current"]) for r in listed} == {(a.family_id, "Laptop", True), (b.family_id, "Phone", False)}
    assert set(listed[0]) == {"id", "device", "started_at", "last_active_at", "expires_at", "current"}
    assert api.delete(f"/api/v1/auth/sessions/{theirs.family_id}", headers=bearer(a.access_token)).status_code == 404
    assert api.delete(f"/api/v1/auth/sessions/{b.family_id}", headers=bearer(a.access_token)).json() == {"data": {"id": b.family_id}}
    assert api.delete("/api/v1/auth/sessions", headers=bearer(a.access_token)).json() == {"data": {"ended": 1}}
    assert api.get("/api/v1/me", headers=bearer(a.access_token)).status_code == 401
    assert api.get("/api/v1/me", headers=bearer(theirs.access_token)).status_code == 200


def test_an_admin_signs_a_user_out_everywhere(api, db):
    admin, target = account(db, role=Role.admin), account(db)
    mine = sessions.start_session(db, admin, None)
    theirs = sessions.start_session(db, target, None)
    h = bearer(mine.access_token)
    assert len(api.get(f"/api/v1/users/{target.id}/sessions", headers=h).json()["data"]) == 1
    assert api.delete(f"/api/v1/users/{target.id}/sessions", headers=h).json() == {"data": {"ended": 1}}
    assert api.get("/api/v1/me", headers=bearer(theirs.access_token)).status_code == 401
    assert api.delete("/api/v1/users/cnosuchuser000/sessions", headers=h).status_code == 404


def test_only_admins_revoke_another_users_sessions(api, db):
    director, target = account(db, role=Role.director), account(db)
    h = bearer(sessions.start_session(db, director, None).access_token)
    assert api.delete(f"/api/v1/users/{target.id}/sessions", headers=h).status_code == 403
    assert api.get(f"/api/v1/users/{target.id}/sessions", headers=h).status_code == 403


# --- Google ---------------------------------------------------------------------------


def with_google(api, google, **user):
    google.user = GoogleUser(**{"sub": f"g-{secrets.token_hex(4)}", "email_verified": True, **user})
    return api.post("/api/v1/auth/google", headers=svc(), json={"code": "abc", "redirect_uri": "http://localhost:3001/api/auth/google/callback"})


def test_google_links_a_verified_address_and_keeps_a_proven_password(api, db, google):
    user = account(db)
    res = with_google(api, google, email=user.email)
    assert res.status_code == 200 and res.json()["data"]["user"]["id"] == user.id
    db.refresh(user)
    assert (user.google_id, user.password_hash is not None) == (google.user.sub, True)
    # Found by Google's id from then on, whatever email it reports.
    again = with_google(api, google, sub=google.user.sub, email="renamed@test.invalid", email_verified=False)
    assert again.json()["data"]["user"]["id"] == user.id


def test_google_refuses_an_unverified_address_another_google_account_and_strangers(api, db, google):
    user = account(db)
    assert with_google(api, google, email=user.email, email_verified=False).json()["error"]["code"] == "google_email_unverified"
    linked = account(db, google_id=f"g-owner-{secrets.token_hex(3)}")
    assert with_google(api, google, email=linked.email).json()["error"]["code"] == "google_no_account"
    assert with_google(api, google, email="stranger@test.invalid").json()["error"]["code"] == "google_no_account"
    db.refresh(user)
    assert user.google_id is None


def test_google_drops_a_password_nobody_proved_and_ends_its_sessions(api, db, google):
    planted = account(db, verified=False)
    attacker = sessions.start_session(db, planted, None)
    res = with_google(api, google, email=planted.email)
    assert res.status_code == 200
    db.refresh(planted)
    assert (planted.password_hash, planted.email_verified) == (None, True)
    assert api.get("/api/v1/me", headers=bearer(attacker.access_token)).status_code == 401
    assert api.get("/api/v1/me", headers=bearer(res.json()["data"]["session"]["access_token"])).status_code == 200


def test_google_failures_and_no_email(api, db, google):
    google.fail = "google_token_failed"
    assert with_google(api, google, email="x@test.invalid").json()["error"]["code"] == "google_token_failed"
    google.fail = None
    assert with_google(api, google, email=None).json()["error"]["code"] == "google_no_email"


def test_google_unconfigured_is_unavailable(api):
    app.dependency_overrides[google_client] = lambda: None
    res = api.post("/api/v1/auth/google", headers=svc(), json={"code": "abc", "redirect_uri": "x"})
    assert (res.status_code, res.json()["error"]["code"]) == (503, "google_unavailable")


# --- the token itself -------------------------------------------------------------------


def _part(token: str, i: int) -> dict:
    seg = token.split(".")[i]
    return json.loads(base64.urlsafe_b64decode(seg + "=" * (-len(seg) % 4)))


def test_tokens_are_signed_as_the_website_signed_them():
    mine = sign_session_token(user_id="u", email="e@test.invalid", role="admin", sid="f", ver=3)
    assert _part(mine, 0) == _part(SESSION_TOKEN, 0)  # {"alg": "HS256", "typ": "JWT"}
    assert set(_part(mine, 1)) == set(_part(SESSION_TOKEN, 1))
    claims = _part(mine, 1)
    assert (claims["iss"], claims["aud"], claims["exp"] - claims["iat"]) == ("vertex-web", "vertex:session", 15 * 60)
    assert verify_session_token(mine).ver == 3
