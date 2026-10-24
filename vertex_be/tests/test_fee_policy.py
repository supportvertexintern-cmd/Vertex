"""GET /api/v1/fee-policy (step 1.1) answers as GET /api/fee-policy in
Next.js: the same roles, the same order and the same JSON per policy."""

import re
import secrets
from datetime import datetime, timedelta

import pytest
from sqlalchemy import text

from app.api.v1.fee_policy import FEE_POLICY_READERS
from app.core.config import BASE_DIR
from app.db.session import get_db
from app.main import app
from app.models.cases import FeePolicy
from app.models.enums import Role
from app.models.identity import Country, Region, User
from tests.test_auth import add_session, bearer, session_token
from tests.test_db_roles import roles_provisioned  # noqa: F401  (vertex_api must exist)

NEXT_ROUTE = BASE_DIR.parent / "vertex" / "src" / "app" / "api" / "fee-policy" / "route.ts"


@pytest.fixture
def api(db, client):
    app.dependency_overrides[get_db] = lambda: db
    yield client
    app.dependency_overrides.pop(get_db, None)


def new_user(db, role: Role) -> User:
    u = User(full_name="Fee Test", email=f"fee-{secrets.token_hex(4)}@test.invalid", role=role)
    db.add(u)
    db.flush()
    db.refresh(u)
    return u


def as_role(db, role: Role) -> dict[str, str]:
    u = new_user(db, role)
    s = add_session(db, u.id)
    return bearer(session_token(u.id, s.family_id, u.token_version))


@pytest.fixture
def policies(db):
    """A global default and a country policy, the country one changed last."""
    director = new_user(db, Role.director)
    region = Region(name=f"Fee region {secrets.token_hex(3)}")
    db.add(region)
    db.flush()
    country = Country(name=f"Feeland {secrets.token_hex(3)}", region_id=region.id)
    db.add(country)
    db.flush()
    t = datetime(2026, 10, 1, 9, 30, 15, 123000)
    default = FeePolicy(country_id=None, enabled=False, currency="USD", updated_by=director.id, updated_at=t)
    local = FeePolicy(
        country_id=country.id, enabled=True, documentation_amount=150.5, permit_amount=300.0, visa_amount=600.0,
        currency="GBP", updated_by=director.id, updated_at=t + timedelta(days=1),
    )
    db.add_all([default, local])
    db.flush()
    return {"default": default, "local": local, "country": country, "director": director}


def ours(body, policies) -> list[dict]:
    ids = {policies["default"].id, policies["local"].id}
    return [p for p in body["data"] if p["id"] in ids]


def test_the_reader_roles_match_next_js():
    src = NEXT_ROUTE.read_text(encoding="utf-8")
    get = src[src.index("export async function GET"):src.index("export async function POST")]
    roles = re.search(r"requireRole\(user, \[(.*?)\]\)", get, re.S)
    assert set(re.findall(r'"(\w+)"', roles.group(1))) == {r.value for r in FEE_POLICY_READERS}


def test_policies_in_prismas_shape_newest_first(api, db, policies):
    res = api.get("/api/v1/fee-policy", headers=as_role(db, Role.finance))
    assert res.status_code == 200
    local, default = ours(res.json(), policies)
    assert local == {
        "id": policies["local"].id,
        "country_id": policies["country"].id,
        "enabled": True,
        "documentation_amount": 150.5,
        "permit_amount": 300.0,
        "visa_amount": 600.0,
        "currency": "GBP",
        "updated_by": policies["director"].id,
        "updated_at": "2026-10-02T09:30:15.123Z",
        "country": {"name": policies["country"].name},
    }
    assert default["country"] is None and default["country_id"] is None
    assert default["documentation_amount"] is None
    assert default["updated_at"] == "2026-10-01T09:30:15.123Z"


@pytest.mark.parametrize("role", list(Role))
def test_every_reader_role_and_no_other(api, db, policies, role):
    res = api.get("/api/v1/fee-policy", headers=as_role(db, role))
    if role in FEE_POLICY_READERS:
        assert res.status_code == 200
    else:
        assert res.status_code == 403
        assert res.json()["error"]["code"] == "forbidden"


def test_no_session_is_401(api):
    res = api.get("/api/v1/fee-policy")
    assert res.status_code == 401
    assert res.json()["error"]["code"] == "unauthorized"


def test_the_api_database_role_can_read_it(api, db, policies):
    # FastAPI connects as vertex_api (deploy/db-roles.sql). The session is
    # set up first: vertex_api can't touch RefreshToken, by design.
    headers = as_role(db, Role.admin)
    db.execute(text("SET LOCAL ROLE vertex_api"))
    try:
        res = api.get("/api/v1/fee-policy", headers=headers)
    finally:
        db.execute(text("RESET ROLE"))
    assert res.status_code == 200
    assert len(ours(res.json(), policies)) == 2


# --- writes (step 1.2) -------------------------------------------------------

from sqlalchemy import select  # noqa: E402

from app.api.v1.fee_policy import FEE_POLICY_MANAGERS  # noqa: E402
from app.models.audit import AuditLog  # noqa: E402


def test_the_manager_roles_match_next_js():
    src = NEXT_ROUTE.read_text(encoding="utf-8")
    managers = re.search(r"FEE_POLICY_MANAGER_ROLES = \[(.*?)\]", src, re.S)
    assert set(re.findall(r'"(\w+)"', managers.group(1))) == {r.value for r in FEE_POLICY_MANAGERS}


def save(api, headers, **body):
    return api.post("/api/v1/fee-policy", headers=headers, json={"enabled": True, **body})


def test_a_save_updates_the_countrys_policy_and_is_audited(api, db, policies):
    director = policies["director"]
    s = add_session(db, director.id)
    headers = bearer(session_token(director.id, s.family_id, director.token_version))
    res = save(api, headers, country_id=policies["country"].id, enabled=False, documentation_amount=99.5, currency="EUR")
    assert res.status_code == 200
    data = res.json()["data"]
    assert data["id"] == policies["local"].id  # updated in place, not duplicated
    assert (data["enabled"], data["documentation_amount"], data["permit_amount"], data["currency"]) == (False, 99.5, None, "EUR")
    assert data["country"] == {"name": policies["country"].name}
    assert db.scalars(select(FeePolicy).where(FeePolicy.country_id == policies["country"].id)).all() == [policies["local"]]

    [row] = db.scalars(select(AuditLog).where(AuditLog.entity_id == policies["local"].id, AuditLog.action == "update")).all()
    assert row.actor_id == director.id
    assert (row.before["currency"], row.after["currency"]) == ("GBP", "EUR")


def test_a_save_for_a_new_country_creates_its_policy(api, db, policies):
    region = Region(name=f"Fee region {secrets.token_hex(3)}")
    db.add(region)
    db.flush()
    country = Country(name=f"Newland {secrets.token_hex(3)}", region_id=region.id)
    db.add(country)
    db.flush()
    headers = as_role(db, Role.admin)
    res = save(api, headers, country_id=country.id, visa_amount=500)
    assert res.status_code == 200
    data = res.json()["data"]
    assert (data["country_id"], data["visa_amount"], data["currency"]) == (country.id, 500.0, "USD")
    assert db.scalars(select(AuditLog).where(AuditLog.entity_id == data["id"])).one().action == "create"


def test_a_save_without_a_country_updates_the_global_default(api, db, policies):
    res = save(api, as_role(db, Role.director), country_id=None, permit_amount=10)
    assert res.json()["data"]["id"] == policies["default"].id


@pytest.mark.parametrize(
    ("body", "field"),
    [
        ({"documentation_amount": 0}, "documentation_amount"),
        ({"permit_amount": -5}, "permit_amount"),
        ({"currency": "EURO"}, "currency"),
        ({"currency": "EU"}, "currency"),
        ({"country_id": "not-a-cuid"}, "country_id"),
        ({"enabled": "maybe"}, "enabled"),
    ],
)
def test_invalid_input_is_refused_field_by_field(api, db, body, field):
    res = save(api, as_role(db, Role.admin), **body)
    assert res.status_code == 422
    assert field in res.json()["error"]["details"]


def test_enabled_is_required(api, db):
    res = api.post("/api/v1/fee-policy", headers=as_role(db, Role.admin), json={"currency": "USD"})
    assert res.status_code == 422
    assert "enabled" in res.json()["error"]["details"]


def test_an_unknown_country_is_refused(api, db):
    res = save(api, as_role(db, Role.admin), country_id="cnotarealcountry0000")
    assert res.status_code == 422
    assert res.json()["error"]["details"] == {"country_id": ["Unknown country"]}


@pytest.mark.parametrize("role", list(Role))
def test_only_director_and_admin_may_save(api, db, role):
    res = save(api, as_role(db, role), country_id=None)
    assert res.status_code == (200 if role in FEE_POLICY_MANAGERS else 403)


def test_saving_needs_a_session(api):
    assert api.post("/api/v1/fee-policy", json={"enabled": True}).status_code == 401


def test_the_api_database_role_can_save_it(api, db, policies):
    headers = as_role(db, Role.admin)
    db.execute(text("SET LOCAL ROLE vertex_api"))
    try:
        res = save(api, headers, country_id=policies["country"].id, enabled=False)
    finally:
        db.execute(text("RESET ROLE"))
    assert res.status_code == 200
