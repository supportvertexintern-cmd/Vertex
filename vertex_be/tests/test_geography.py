"""Regions and countries (step 2.1) answer as Next.js's /api/admin/regions
and /api/admin/countries did: the same roles, rules, messages, status codes
and JSON."""

import re
import secrets

import pytest
from sqlalchemy import text

from app.api.v1 import geography
from app.api.v1.geography import COUNTRY_READERS, REGION_READERS
from app.core.config import BASE_DIR
from app.db.session import get_db
from app.main import app
from app.models.cases import FeePolicy
from app.models.enums import Role
from app.models.identity import Country, Region, User
from tests.test_auth import add_session, bearer, session_token
from tests.test_db_roles import roles_provisioned  # noqa: F401  (vertex_api must exist)

NEXT_API = BASE_DIR.parent / "vertex" / "src" / "app" / "api" / "admin"


@pytest.fixture
def api(db, client):
    app.dependency_overrides[get_db] = lambda: db
    yield client
    app.dependency_overrides.pop(get_db, None)


def as_role(db, role: Role) -> dict[str, str]:
    u = User(full_name="Geo Test", email=f"geo-{secrets.token_hex(4)}@test.invalid", role=role)
    db.add(u)
    db.flush()
    db.refresh(u)
    s = add_session(db, u.id)
    return bearer(session_token(u.id, s.family_id, u.token_version))


def unique(prefix: str) -> str:
    return f"{prefix} {secrets.token_hex(4)}"


@pytest.fixture
def admin(db):
    return as_role(db, Role.admin)


@pytest.fixture
def region(db):
    r = Region(name=unique("Region"))
    db.add(r)
    db.flush()
    return r


def add_country(db, region: Region, name: str | None = None) -> Country:
    c = Country(name=name or unique("Country"), region_id=region.id)
    db.add(c)
    db.flush()
    return c


def next_readers(route: str) -> set[str]:
    src = (NEXT_API / route / "route.ts").read_text(encoding="utf-8")
    get = src[src.index("export async function GET"):src.index("export async function POST")]
    return set(re.findall(r'"(\w+)"', re.search(r"requireRole\(user, \[(.*?)\]\)", get, re.S).group(1)))


def test_the_reader_roles_match_next_js():
    assert next_readers("regions") == {r.value for r in REGION_READERS}
    assert next_readers("countries") == {r.value for r in COUNTRY_READERS}


# --- regions -----------------------------------------------------------------


def test_regions_list_with_their_countries_by_name(api, db, region):
    b = add_country(db, region, unique("Zed"))
    a = add_country(db, region, unique("Abc"))
    res = api.get("/api/v1/regions", headers=as_role(db, Role.director))
    assert res.status_code == 200
    [mine] = [r for r in res.json()["data"] if r["id"] == region.id]
    assert mine == {
        "id": region.id,
        "name": region.name,
        "countries": [{"id": a.id, "name": a.name, "region_id": region.id}, {"id": b.id, "name": b.name, "region_id": region.id}],
    }
    names = [r["name"] for r in res.json()["data"]]
    assert names == sorted(names)


@pytest.mark.parametrize("role", list(Role))
def test_regions_are_read_by_the_hierarchy_only(api, db, role):
    assert api.get("/api/v1/regions", headers=as_role(db, role)).status_code == (200 if role in REGION_READERS else 403)


def test_an_admin_creates_a_region(api, db, admin):
    name = unique("New region")
    res = api.post("/api/v1/regions", headers=admin, json={"name": name})
    assert res.status_code == 201
    assert res.json()["data"]["name"] == name
    assert db.get(Region, res.json()["data"]["id"]) is not None


def test_a_region_name_is_unique(api, db, admin, region):
    res = api.post("/api/v1/regions", headers=admin, json={"name": region.name})
    assert res.status_code == 409
    assert res.json()["error"] == {"code": "duplicate", "message": "A region with this name already exists."}


@pytest.mark.parametrize("name", ["x", "y" * 101])
def test_a_region_name_is_2_to_100_characters(api, admin, name):
    res = api.post("/api/v1/regions", headers=admin, json={"name": name})
    assert res.status_code == 422
    assert "name" in res.json()["error"]["details"]


def test_only_admin_writes_regions(api, db, region):
    director = as_role(db, Role.director)
    assert api.post("/api/v1/regions", headers=director, json={"name": unique("R")}).status_code == 403
    assert api.patch(f"/api/v1/regions/{region.id}", headers=director, json={"name": unique("R")}).status_code == 403


def test_an_admin_renames_a_region(api, db, admin, region):
    name = unique("Renamed")
    res = api.patch(f"/api/v1/regions/{region.id}", headers=admin, json={"name": name})
    assert (res.status_code, res.json()["data"]) == (200, {"id": region.id, "name": name})


def test_renaming_keeps_names_unique_but_allows_its_own(api, db, admin, region):
    other = Region(name=unique("Other"))
    db.add(other)
    db.flush()
    assert api.patch(f"/api/v1/regions/{region.id}", headers=admin, json={"name": other.name}).status_code == 409
    assert api.patch(f"/api/v1/regions/{region.id}", headers=admin, json={"name": region.name}).status_code == 200


def test_renaming_an_unknown_region_is_404(api, admin):
    res = api.patch("/api/v1/regions/cnosuchregion000", headers=admin, json={"name": "Whatever"})
    assert res.status_code == 404
    assert res.json()["error"] == {"code": "not_found", "message": "Region not found."}


def test_a_name_taken_by_a_concurrent_request_is_still_409(api, db, admin, region, monkeypatch):
    # The check passes, then the unique index refuses at commit.
    monkeypatch.setattr(geography, "_name_taken", lambda *a, **k: False)
    res = api.post("/api/v1/regions", headers=admin, json={"name": region.name})
    assert res.status_code == 409
    assert res.json()["error"]["code"] == "duplicate"


# --- countries ---------------------------------------------------------------


def test_countries_list_with_their_region_by_name(api, db, region):
    c = add_country(db, region)
    res = api.get("/api/v1/countries", headers=as_role(db, Role.finance))
    assert res.status_code == 200
    [mine] = [x for x in res.json()["data"] if x["id"] == c.id]
    assert mine == {"id": c.id, "name": c.name, "region_id": region.id, "region": {"id": region.id, "name": region.name}}
    names = [x["name"] for x in res.json()["data"]]
    assert names == sorted(names)


@pytest.mark.parametrize("role", list(Role))
def test_countries_are_read_by_staff_and_case_directorates(api, db, role):
    assert api.get("/api/v1/countries", headers=as_role(db, role)).status_code == (200 if role in COUNTRY_READERS else 403)


def test_an_admin_creates_a_country(api, db, admin, region):
    name = unique("Newland")
    res = api.post("/api/v1/countries", headers=admin, json={"name": name, "region_id": region.id})
    assert res.status_code == 201
    data = res.json()["data"]
    assert (data["name"], data["region_id"]) == (name, region.id)
    assert "region" not in data  # as Prisma's create returned it


def test_a_country_needs_a_real_region(api, admin):
    res = api.post("/api/v1/countries", headers=admin, json={"name": "Nowhere", "region_id": "cnosuchregion000"})
    assert res.status_code == 404
    assert res.json()["error"] == {"code": "not_found", "message": "Region not found."}


@pytest.mark.parametrize(
    ("body", "field"),
    [({"name": "Ok name", "region_id": "not-a-cuid"}, "region_id"), ({"name": "x", "region_id": "cabcdefgh123"}, "name"), ({"name": "No region"}, "region_id")],
)
def test_country_input_rules(api, admin, body, field):
    res = api.post("/api/v1/countries", headers=admin, json=body)
    assert res.status_code == 422
    assert field in res.json()["error"]["details"]


def test_a_country_name_is_unique(api, db, admin, region):
    c = add_country(db, region)
    res = api.post("/api/v1/countries", headers=admin, json={"name": c.name, "region_id": region.id})
    assert res.status_code == 409
    assert res.json()["error"] == {"code": "duplicate", "message": "A country with this name already exists."}


def test_an_admin_renames_and_moves_a_country(api, db, admin, region):
    c = add_country(db, region)
    other = Region(name=unique("Elsewhere"))
    db.add(other)
    db.flush()
    name = unique("Moved")
    res = api.patch(f"/api/v1/countries/{c.id}", headers=admin, json={"name": name, "region_id": other.id})
    assert (res.status_code, res.json()["data"]) == (200, {"id": c.id, "name": name, "region_id": other.id})


def test_updating_a_country_checks_everything(api, db, admin, region):
    c = add_country(db, region)
    taken = add_country(db, region)
    assert api.patch("/api/v1/countries/cnosuchcountry00", headers=admin, json={"name": "X y"}).status_code == 404
    assert api.patch(f"/api/v1/countries/{c.id}", headers=admin, json={"region_id": "cnosuchregion000"}).json()["error"]["message"] == "Region not found."
    assert api.patch(f"/api/v1/countries/{c.id}", headers=admin, json={"name": taken.name}).status_code == 409
    assert api.patch(f"/api/v1/countries/{c.id}", headers=admin, json={}).status_code == 200


def test_an_admin_deletes_a_country_and_its_fee_policy_lets_go(api, db, admin, region):
    c = add_country(db, region)
    director = User(full_name="D", email=f"geo-{secrets.token_hex(4)}@test.invalid", role=Role.director)
    db.add(director)
    db.flush()
    policy = FeePolicy(country_id=c.id, enabled=True, currency="USD", updated_by=director.id)
    db.add(policy)
    db.flush()

    res = api.delete(f"/api/v1/countries/{c.id}", headers=admin)
    assert (res.status_code, res.json()) == (200, {"data": {"id": c.id}})
    db.expire_all()
    assert db.get(Country, c.id) is None
    assert db.get(FeePolicy, policy.id).country_id is None


def test_deleting_an_unknown_country_is_404(api, admin):
    res = api.delete("/api/v1/countries/cnosuchcountry00", headers=admin)
    assert res.status_code == 404
    assert res.json()["error"]["message"] == "Country not found."


def test_only_admin_writes_countries(api, db, region):
    c = add_country(db, region)
    director = as_role(db, Role.director)
    assert api.post("/api/v1/countries", headers=director, json={"name": unique("C"), "region_id": region.id}).status_code == 403
    assert api.patch(f"/api/v1/countries/{c.id}", headers=director, json={"name": unique("C")}).status_code == 403
    assert api.delete(f"/api/v1/countries/{c.id}", headers=director).status_code == 403


def test_the_api_database_role_can_write_them(api, db, admin, region):
    db.execute(text("SET LOCAL ROLE vertex_api"))
    try:
        r = api.post("/api/v1/regions", headers=admin, json={"name": unique("As api")})
        c = api.post("/api/v1/countries", headers=admin, json={"name": unique("As api"), "region_id": region.id})
        d = api.delete(f"/api/v1/countries/{c.json()['data']['id']}", headers=admin)
    finally:
        db.execute(text("RESET ROLE"))
    assert (r.status_code, c.status_code, d.status_code) == (201, 201, 200)
