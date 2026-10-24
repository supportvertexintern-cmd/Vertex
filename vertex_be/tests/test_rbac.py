"""Role checks (app/core/rbac.py): the groups match vertex/src/lib/rbac.ts,
and require_role() admits exactly the listed roles, after current_user has
authenticated the session: 401 before 403, never the other way round."""

import logging
import re
import secrets

import pytest
from fastapi import Depends
from fastapi.testclient import TestClient

from app.core import rbac
from app.core.access import is_guarded, iter_api_routes
from app.core.auth import AuthUser
from app.core.config import BASE_DIR
from app.db.session import get_db
from app.main import create_app
from app.models.enums import Role
from app.models.identity import User
from tests.test_auth import add_session, bearer, session_token, utcnow

RBAC_TS = BASE_DIR.parent / "vertex" / "src" / "lib" / "rbac.ts"

PORTED = ["STAFF_ROLES", "OPERATIONS_ROLES", "FINANCE_ROLES", "HR_ROLES", "REFERRAL_AGENT_MANAGER_ROLES"]


def ts_role_groups() -> dict[str, set[str]]:
    source = RBAC_TS.read_text(encoding="utf-8")
    groups = re.findall(r"export const (\w+_ROLES): Role\[\] = \[(.*?)\];", source, re.S)
    return {name: set(re.findall(r'"(\w+)"', body)) for name, body in groups}


def test_every_role_group_in_rbac_ts_is_ported_value_for_value():
    ts = ts_role_groups()
    assert sorted(ts) == sorted(PORTED), "a role group was added to or removed from rbac.ts: port it here"
    for name in PORTED:
        assert {r.value for r in getattr(rbac, name)} == ts[name], f"{name} differs from rbac.ts"


def test_admin_keeps_override_in_every_group():
    for name in PORTED:
        assert Role.admin in getattr(rbac, name), name


@pytest.mark.parametrize("role", list(Role))
def test_is_staff_role(role):
    assert rbac.is_staff_role(role) == (role.value in ts_role_groups()["STAFF_ROLES"])


def test_require_role_needs_at_least_one_role():
    with pytest.raises(ValueError):
        rbac.require_role()


# A probe app with one route per kind of rule, on the real default-deny app.
probe = create_app()


@probe.get("/api/v1/probe/finance")
def finance_only(user: AuthUser = Depends(rbac.require_role(*rbac.FINANCE_ROLES))):
    return {"role": user.role.value}


@probe.get("/api/v1/probe/admin")
def admin_only(user: AuthUser = Depends(rbac.require_role(Role.admin))):
    return {"role": user.role.value}


def test_a_role_checked_route_counts_as_guarded():
    routes = dict(iter_api_routes(probe.routes))
    assert is_guarded(routes["/api/v1/probe/finance"])
    assert is_guarded(routes["/api/v1/probe/admin"])


@pytest.fixture
def api(db):
    probe.dependency_overrides[get_db] = lambda: db
    yield TestClient(probe)
    probe.dependency_overrides.pop(get_db, None)


def signed_in(db, role: Role) -> dict[str, str]:
    u = User(full_name="Role Test", email=f"role-{secrets.token_hex(4)}@test.invalid", role=role)
    db.add(u)
    db.flush()
    db.refresh(u)
    s = add_session(db, u.id)
    return bearer(session_token(u.id, s.family_id, u.token_version))


@pytest.mark.parametrize("role", list(Role))
def test_each_role_is_admitted_or_refused_by_the_group(api, db, role):
    res = api.get("/api/v1/probe/finance", headers=signed_in(db, role))
    if role in rbac.FINANCE_ROLES:
        assert (res.status_code, res.json()) == (200, {"role": role.value})
    else:
        assert res.status_code == 403


@pytest.mark.parametrize("role", list(Role))
def test_admin_only_admits_admin_alone(api, db, role):
    res = api.get("/api/v1/probe/admin", headers=signed_in(db, role))
    assert res.status_code == (200 if role is Role.admin else 403)


def test_the_role_comes_from_the_database_not_the_token(api, db):
    u = User(full_name="Role Test", email=f"role-{secrets.token_hex(4)}@test.invalid", role=Role.candidate)
    db.add(u)
    db.flush()
    db.refresh(u)
    s = add_session(db, u.id)
    forged = session_token(u.id, s.family_id, u.token_version, role="admin")
    assert api.get("/api/v1/probe/admin", headers=bearer(forged)).status_code == 403


@pytest.mark.parametrize(
    "headers",
    [
        pytest.param({}, id="no token"),
        pytest.param({"Authorization": "Bearer not-a-jwt"}, id="invalid token"),
    ],
)
def test_no_session_is_401_not_403(api, headers):
    res = api.get("/api/v1/probe/admin", headers=headers)
    assert res.status_code == 401
    assert res.headers["WWW-Authenticate"] == "Bearer"


def test_an_ended_admin_session_is_401(api, db):
    u = User(full_name="Role Test", email=f"role-{secrets.token_hex(4)}@test.invalid", role=Role.admin)
    db.add(u)
    db.flush()
    db.refresh(u)
    s = add_session(db, u.id, revoked_at=utcnow())
    assert api.get("/api/v1/probe/admin", headers=bearer(session_token(u.id, s.family_id, u.token_version))).status_code == 401


def test_a_refusal_is_logged_like_next_js(api, db, caplog):
    headers = signed_in(db, Role.marketing)
    with caplog.at_level(logging.WARNING, logger="vertex"):
        assert api.get("/api/v1/probe/finance", headers=headers).status_code == 403
    [record] = [r for r in caplog.records if getattr(r, "event", None) == "security.access_denied"]
    assert record.fields["reason"] == "role"
    assert record.fields["role"] == "marketing"
    assert record.fields["allowed"] == ["admin", "director", "finance"]
    assert record.fields["path"] == "/api/v1/probe/finance"
    assert record.fields["actor_id"]
