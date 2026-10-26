"""System settings (step 2.3) answer as Next.js's /api/admin/settings did:
admin only, the same three keys, the same 400 for a bad intake mode."""

import secrets

import pytest
from sqlalchemy import text

from app.db.session import get_db
from app.main import app
from app.models.enums import Role
from app.models.identity import User
from app.models.reference import SystemSetting
from tests.test_auth import add_session, bearer, session_token
from tests.test_db_roles import roles_provisioned  # noqa: F401  (vertex_api must exist)

URL = "/api/v1/settings"


@pytest.fixture
def api(db, client):
    app.dependency_overrides[get_db] = lambda: db
    yield client
    app.dependency_overrides.pop(get_db, None)


def as_role(db, role: Role) -> dict[str, str]:
    u = User(full_name="Settings Test", email=f"set-{secrets.token_hex(4)}@test.invalid", role=role)
    db.add(u)
    db.flush()
    db.refresh(u)
    s = add_session(db, u.id)
    return bearer(session_token(u.id, s.family_id, u.token_version))


@pytest.fixture
def admin(db):
    return as_role(db, Role.admin)


def test_settings_are_a_key_value_map(api, db, admin):
    db.add(SystemSetting(key="ctest_other", value="kept", description="not editable here"))
    db.flush()
    data = api.get(URL, headers=admin).json()["data"]
    assert data["ctest_other"] == "kept" and all(isinstance(v, str) for v in data.values())


@pytest.mark.parametrize("role", list(Role))
def test_only_admin_reads_and_writes_settings(api, db, role):
    headers = as_role(db, role)
    expected = 200 if role is Role.admin else 403
    assert api.get(URL, headers=headers).status_code == expected
    assert api.put(URL, headers=headers, json={"intake_mode": "email"}).status_code == expected


def test_an_admin_sets_and_changes_settings(api, admin):
    first = api.put(URL, headers=admin, json={"ai_enabled": "false", "whatsapp_number": "+251 911 000000", "intake_mode": "crm"})
    assert first.status_code == 200
    assert {k: first.json()["data"][k] for k in ("ai_enabled", "whatsapp_number", "intake_mode")} == {
        "ai_enabled": "false",
        "whatsapp_number": "+251 911 000000",
        "intake_mode": "crm",
    }
    second = api.put(URL, headers=admin, json={"intake_mode": "email"}).json()["data"]
    assert (second["intake_mode"], second["ai_enabled"]) == ("email", "false")  # a key left out is kept


def test_a_boolean_is_stored_as_text(api, admin):
    assert api.put(URL, headers=admin, json={"ai_enabled": True}).json()["data"]["ai_enabled"] == "true"


def test_other_keys_are_ignored(api, admin):
    data = api.put(URL, headers=admin, json={"ctest_unknown": "x", "intake_mode": "email"}).json()["data"]
    assert "ctest_unknown" not in data


def test_a_bad_intake_mode_is_400_and_changes_nothing(api, admin):
    before = api.put(URL, headers=admin, json={"intake_mode": "crm", "ai_enabled": "true"}).json()["data"]
    res = api.put(URL, headers=admin, json={"intake_mode": "fax", "ai_enabled": "false"})
    assert (res.status_code, res.json()["error"]["message"]) == (400, "intake_mode must be 'email' or 'crm'")
    assert api.get(URL, headers=admin).json()["data"] == before


@pytest.mark.parametrize("body", [{"ai_enabled": "maybe"}, {"whatsapp_number": "1" * 31}, {"whatsapp_number": 251911}])
def test_input_rules(api, admin, body):
    assert api.put(URL, headers=admin, json=body).status_code == 422


def test_the_api_database_role_can_write_them(api, db, admin):
    db.execute(text("SET LOCAL ROLE vertex_api"))
    try:
        res = api.put(URL, headers=admin, json={"intake_mode": "email"})
    finally:
        db.execute(text("RESET ROLE"))
    assert res.status_code == 200
