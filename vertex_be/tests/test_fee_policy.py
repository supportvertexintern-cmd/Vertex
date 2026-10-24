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
