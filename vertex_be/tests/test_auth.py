"""current_user (app/core/auth.py) accepts a live Next.js session and nothing
else, with the same checks as getAuthUser() in vertex/src/lib/api-auth.ts:
signature, then user, token_version and a live session in the database."""

import secrets
import time
from datetime import UTC, datetime, timedelta

import jwt
import pytest
from sqlalchemy import delete, text, update

from app.core.tokens import key_for
from app.db.session import get_db
from app.main import app
from app.models.enums import Role
from app.models.identity import RefreshToken, User
from tests.node_session_vectors import SECRET


def utcnow() -> datetime:
    # Prisma stores timestamps as UTC without a time zone.
    return datetime.now(UTC).replace(tzinfo=None)


def session_token(user_id: str, sid: str, ver: int, *, role: str = "candidate", email: str = "token@test.invalid") -> str:
    now = int(time.time())
    payload = {
        "userId": user_id, "email": email, "role": role, "sid": sid, "ver": ver,
        "iat": now, "exp": now + 900, "iss": "vertex-web", "aud": "vertex:session",
    }
    return jwt.encode(payload, key_for("session", SECRET), algorithm="HS256")


@pytest.fixture
def api(db, client):
    """The app's requests use the test's rolled-back session."""
    app.dependency_overrides[get_db] = lambda: db
    yield client
    app.dependency_overrides.pop(get_db, None)


@pytest.fixture
def user(db):
    u = User(full_name="Auth Test", email=f"auth-{secrets.token_hex(4)}@test.invalid", role=Role.director)
    db.add(u)
    db.flush()
    db.refresh(u)
    return u


def add_session(db, user_id: str, **overrides) -> RefreshToken:
    fields = {
        "family_id": secrets.token_hex(8),
        "token_hash": secrets.token_hex(32),
        "token_version": 0,
        "expires_at": utcnow() + timedelta(days=1),
        **overrides,
    }
    row = RefreshToken(user_id=user_id, **fields)
    db.add(row)
    db.flush()
    return row


def bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def test_a_live_session_is_accepted_with_role_and_email_from_the_database(api, db, user):
    s = add_session(db, user.id)
    # The token claims another role and email; the database wins, as in Next.js.
    res = api.get("/api/v1/me", headers=bearer(session_token(user.id, s.family_id, user.token_version)))
    assert res.status_code == 200
    assert res.json() == {"data": {"id": user.id, "email": user.email, "role": "director"}}


def test_no_token_is_401_with_a_bearer_challenge(api):
    res = api.get("/api/v1/me")
    assert res.status_code == 401
    assert res.headers["WWW-Authenticate"] == "Bearer"


def test_the_browser_session_cookie_is_not_accepted(api, db, user):
    s = add_session(db, user.id)
    api.cookies.set("auth_token", session_token(user.id, s.family_id, user.token_version))
    try:
        assert api.get("/api/v1/me").status_code == 401
    finally:
        api.cookies.clear()


@pytest.mark.parametrize("header", ["Basic abc", "Bearer", "Bearer   ", "Token x"])
def test_other_authorization_schemes_are_refused(api, header):
    assert api.get("/api/v1/me", headers={"Authorization": header}).status_code == 401


def test_a_password_change_ends_the_session(api, db, user):
    s = add_session(db, user.id)
    token = session_token(user.id, s.family_id, user.token_version)
    assert api.get("/api/v1/me", headers=bearer(token)).status_code == 200
    # The database trigger bumps token_version, whatever code changes it.
    # Straight to the connection: the ORM refuses bulk writes to audited tables.
    db.connection().execute(update(User.__table__).where(User.id == user.id).values(password_hash="changed"))
    db.flush()
    db.expire_all()
    assert api.get("/api/v1/me", headers=bearer(token)).status_code == 401


@pytest.mark.parametrize(
    "change",
    [
        pytest.param({"revoked_at": "now"}, id="revoked (logout, kill switch)"),
        pytest.param({"used_at": "now"}, id="rotated away"),
        pytest.param({"expires_at": "past"}, id="expired"),
    ],
)
def test_an_ended_session_is_refused(api, db, user, change):
    values = {k: (utcnow() if v == "now" else utcnow() - timedelta(seconds=1)) for k, v in change.items()}
    s = add_session(db, user.id, **values)
    assert api.get("/api/v1/me", headers=bearer(session_token(user.id, s.family_id, user.token_version))).status_code == 401


def test_another_users_session_is_refused(api, db, user):
    other = User(full_name="Other", email=f"other-{secrets.token_hex(4)}@test.invalid")
    db.add(other)
    db.flush()
    theirs = add_session(db, other.id)
    assert api.get("/api/v1/me", headers=bearer(session_token(user.id, theirs.family_id, user.token_version))).status_code == 401


def test_a_deleted_user_is_refused(api, db, user):
    s = add_session(db, user.id)
    token = session_token(user.id, s.family_id, user.token_version)
    db.connection().execute(delete(User.__table__).where(User.id == user.id))
    db.flush()
    db.expire_all()
    assert api.get("/api/v1/me", headers=bearer(token)).status_code == 401


def test_a_stale_token_version_is_refused(api, db, user):
    s = add_session(db, user.id)
    assert api.get("/api/v1/me", headers=bearer(session_token(user.id, s.family_id, user.token_version + 1))).status_code == 401


def test_the_liveness_check_is_the_same_query_nextjs_runs(db, user):
    live = add_session(db, user.id)
    ended = add_session(db, user.id, revoked_at=utcnow())
    ask = text("SELECT public.vertex_session_is_live(:u, :f)")
    assert db.scalar(ask, {"u": user.id, "f": live.family_id}) is True
    assert db.scalar(ask, {"u": user.id, "f": ended.family_id}) is False
    assert db.scalar(ask, {"u": user.id, "f": "no-such-family"}) is False
