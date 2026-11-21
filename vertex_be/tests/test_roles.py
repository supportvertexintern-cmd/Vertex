"""Role management (app/api/v1/roles.py, app/core/permissions.py): the admin
assigns permissions to internal roles; admin holds them all, always;
external roles never get one; a change applies on the next request."""

import pytest
from sqlalchemy import select, text

from app.db.session import engine
from app.core.permissions import ASSIGNABLE_ROLES, EXTERNAL_ROLES, PERMISSIONS, Permission
from app.models.audit import AuditLog
from app.models.enums import Role
from app.models.permissions import RolePermission
from app.services import security_monitor
from app.services.landing_content import BLOCKS
from tests.test_content import api, as_role  # noqa: F401  (a fixture and a helper)
from tests.test_db_roles import roles_provisioned  # noqa: F401  (vertex_api must exist)

URL = "/api/v1/admin/roles"
EDIT, PUBLISH = Permission.landing_edit.value, Permission.landing_publish.value


@pytest.fixture
def admin(db):
    return as_role(db, Role.admin)


@pytest.fixture
def alerts(monkeypatch):
    raised: list[tuple] = []
    monkeypatch.setattr(security_monitor, "on_permissions_granted", lambda *args: raised.append(args))
    return raised


def grid(api, admin) -> dict[str, dict]:
    res = api.get(URL, headers=admin)
    assert res.status_code == 200, res.text
    return {r["role"]: r for r in res.json()["data"]["roles"]}


def set_permissions(api, admin, role: str, permissions: list[str]):
    return api.put(f"{URL}/{role}/permissions", headers=admin, json={"permissions": permissions})


def save_draft(api, headers):
    return api.put("/api/v1/content/blocks/web.jobs/draft", headers=headers, json={"body": BLOCKS["web.jobs"].default})


# --- the grid -----------------------------------------------------------------


def test_the_grid_lists_every_permission_and_the_internal_roles(api, admin):
    data = api.get(URL, headers=admin).json()["data"]
    assert [p["key"] for p in data["permissions"]] == [p.value for p in PERMISSIONS]
    assert all(p["label"] and p["group"] and p["description"] for p in data["permissions"])
    roles = [r["role"] for r in data["roles"]]
    assert roles == ["admin", *(r.value for r in ASSIGNABLE_ROLES)]
    assert not {r.value for r in EXTERNAL_ROLES} & set(roles)


def test_admin_holds_everything_and_cant_be_changed(api, admin):
    row = grid(api, admin)["admin"]
    assert row == {"role": "admin", "editable": False, "permissions": [p.value for p in Permission]}
    res = set_permissions(api, admin, "admin", [])
    assert (res.status_code, res.json()["error"]["code"]) == (400, "role_not_editable")


def test_the_defaults_are_who_could_do_it_before(api, db, admin):
    # The migration's ticks: each permission's DEFAULT_ROLES, nothing else.
    rows = grid(api, admin)
    for spec in PERMISSIONS.values():
        holders = {role for role, row in rows.items() if spec.permission.value in row["permissions"]} - {"admin"}
        assert holders == {r.value for r in spec.default_roles}, spec.permission
    stored = {(r.role, r.permission) for r in db.scalars(select(RolePermission))}
    assert stored == {(role, spec.permission.value) for spec in PERMISSIONS.values() for role in spec.default_roles}


@pytest.mark.parametrize("role", sorted(EXTERNAL_ROLES, key=lambda r: r.value))
def test_an_external_role_is_never_given_one(api, admin, role):
    res = set_permissions(api, admin, role.value, [EDIT])
    assert (res.status_code, res.json()["error"]["code"]) == (400, "role_not_assignable")


def test_an_unknown_permission_or_role_is_refused(api, admin):
    assert set_permissions(api, admin, "hr", ["landing.everything"]).status_code == 422
    assert set_permissions(api, admin, "superuser", [EDIT]).status_code == 422


@pytest.mark.parametrize("role", [r for r in Role if r is not Role.admin])
def test_only_admin_manages_roles(api, db, role):
    h = as_role(db, role)
    assert api.get(URL, headers=h).status_code == 403
    assert set_permissions(api, h, "hr", [EDIT]).status_code == 403


# --- a change applies at once --------------------------------------------------


def test_a_tick_gives_the_role_access_and_an_untick_takes_it_away(api, db, admin, alerts):
    hr = as_role(db, Role.hr)
    assert save_draft(api, hr).status_code == 403
    assert api.get("/api/v1/me", headers=hr).json()["data"]["permissions"] == []

    res = set_permissions(api, admin, "hr", [EDIT])
    assert res.status_code == 200, res.text
    assert res.json()["data"] == {"role": "hr", "editable": True, "permissions": [EDIT]}
    assert alerts == [(db.scalar(select(RolePermission.granted_by).where(RolePermission.role == Role.hr)), "hr", [EDIT])]

    # The same session, no new sign-in: edit yes, publish no.
    assert save_draft(api, hr).status_code == 200
    assert api.post("/api/v1/content/blocks/web.jobs/publish", headers=hr).status_code == 403
    assert api.get("/api/v1/me", headers=hr).json()["data"]["permissions"] == [EDIT]
    assert api.get("/api/v1/content/landing", params={"app": "web", "preview": "true"}, headers=hr).status_code == 200

    assert set_permissions(api, admin, "hr", []).status_code == 200
    assert save_draft(api, hr).status_code == 403
    assert len(alerts) == 1  # taking away raises nothing


def test_a_publish_only_role_reads_and_publishes_but_cant_edit(api, db, admin, alerts):
    marketing, finance = as_role(db, Role.marketing), as_role(db, Role.finance)
    assert save_draft(api, marketing).status_code == 200
    set_permissions(api, admin, "finance", [PUBLISH])
    assert api.get("/api/v1/content/blocks", headers=finance).status_code == 200
    assert save_draft(api, finance).status_code == 403
    assert api.post("/api/v1/content/blocks/web.jobs/publish", headers=finance).status_code == 200


def test_unticking_marketing_ends_its_access(api, db, admin):
    marketing = as_role(db, Role.marketing)
    assert set_permissions(api, admin, "marketing", [PUBLISH]).status_code == 200
    assert save_draft(api, marketing).status_code == 403
    assert grid(api, admin)["marketing"]["permissions"] == [PUBLISH]


def test_a_permission_can_be_ticked_again(api, db, admin, alerts):
    for permissions in ([EDIT], [], [EDIT], [EDIT, PUBLISH], [EDIT, PUBLISH]):
        assert set_permissions(api, admin, "director", permissions).status_code == 200
    assert grid(api, admin)["director"]["permissions"] == [EDIT, PUBLISH]
    live = db.scalars(select(RolePermission).where(RolePermission.role == Role.director)).all()
    assert sorted(r.permission for r in live) == [EDIT, PUBLISH]
    assert [a[2] for a in alerts] == [[EDIT], [EDIT], [PUBLISH]]  # a repeat grants nothing new


# --- the trail and the database role ------------------------------------------


def test_every_tick_and_untick_is_on_the_trail(api, db, admin, alerts):
    set_permissions(api, admin, "operations_team", [EDIT])
    set_permissions(api, admin, "operations_team", [])
    rows = db.scalars(select(AuditLog).where(AuditLog.entity_type == "RolePermission")).all()
    actions = [r.action for r in rows]
    assert "create" in actions and "delete" in actions
    assert all(r.actor_id is not None for r in rows)


def test_a_refusal_for_want_of_a_permission_is_recorded(api, db):
    hr = as_role(db, Role.hr)
    assert save_draft(api, hr).status_code == 403
    # Committed on its own connection, as every security event (tests/test_audit.py).
    with engine.connect() as other:
        rows = other.execute(
            select(AuditLog.after).where(AuditLog.action == "access_denied", AuditLog.entity_id == "/api/v1/content/blocks/web.jobs/draft")
        ).all()
    assert any(r.after.get("reason") == "permission" and r.after.get("permissions") == [EDIT] and r.after.get("role") == "hr" for r in rows)


def test_the_api_database_role_can_write_them(api, db, admin, alerts):
    db.execute(text("SET LOCAL ROLE vertex_api"))
    try:
        res = set_permissions(api, admin, "virtual_assistant", [EDIT])
        cleared = set_permissions(api, admin, "virtual_assistant", [])
    finally:
        db.execute(text("RESET ROLE"))
    assert (res.status_code, cleared.status_code) == (200, 200)
