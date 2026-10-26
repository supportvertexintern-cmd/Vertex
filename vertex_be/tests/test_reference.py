"""Sectors and country document requirements (step 2.2) answer as Next.js's
/api/admin/sectors and /api/admin/countries/[id]/document-requirements did:
the same roles, rules, messages, status codes and JSON."""

import re
import secrets

import pytest
from sqlalchemy import text

from app.api.v1 import reference
from app.api.v1.reference import REQUIREMENT_READERS, SECTOR_READERS
from app.core.config import BASE_DIR
from app.db.session import get_db
from app.main import app
from app.models.enums import Role
from app.models.identity import Country, Region, User
from app.models.reference import DocumentRequirementType, Sector
from tests.test_auth import add_session, bearer, session_token
from tests.test_db_roles import roles_provisioned  # noqa: F401  (vertex_api must exist)

NEXT_API = BASE_DIR.parent / "vertex" / "src" / "app" / "api" / "admin"
ISO_Z = re.compile(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z")


@pytest.fixture
def api(db, client):
    app.dependency_overrides[get_db] = lambda: db
    yield client
    app.dependency_overrides.pop(get_db, None)


def as_role(db, role: Role) -> dict[str, str]:
    u = User(full_name="Ref Test", email=f"ref-{secrets.token_hex(4)}@test.invalid", role=role)
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
def country(db):
    region = Region(name=unique("Ref region"))
    db.add(region)
    db.flush()
    c = Country(name=unique("Ref country"), region_id=region.id)
    db.add(c)
    db.flush()
    return c


@pytest.fixture
def doc_types(db):
    """Two document types, as the website (which still owns them) makes them."""
    types = [DocumentRequirementType(key=f"ref_{secrets.token_hex(3)}", label=unique("Ref doc")) for _ in range(2)]
    db.add_all(types)
    db.flush()
    return [t.key for t in types]


def next_readers(route: str) -> set[str]:
    src = (NEXT_API / route / "route.ts").read_text(encoding="utf-8")
    get = src[src.index("export async function GET"):]
    return set(re.findall(r'"(\w+)"', re.search(r"requireRole\(user, \[(.*?)\]\)", get, re.S).group(1)))


def test_the_reader_roles_match_next_js():
    assert next_readers("sectors") == {r.value for r in SECTOR_READERS}
    assert next_readers("countries/[id]/document-requirements") == {r.value for r in REQUIREMENT_READERS}


# --- sectors -----------------------------------------------------------------


def test_sectors_list_by_name_in_prismas_shape(api, db):
    s = Sector(name=unique("Healthcare"))
    db.add(s)
    db.flush()
    res = api.get("/api/v1/sectors", headers=as_role(db, Role.marketing))
    assert res.status_code == 200
    [mine] = [x for x in res.json()["data"] if x["id"] == s.id]
    assert set(mine) == {"id", "name", "created_at"} and ISO_Z.fullmatch(mine["created_at"])
    names = [x["name"] for x in res.json()["data"]]
    assert names == sorted(names)


@pytest.mark.parametrize("role", list(Role))
def test_sectors_are_read_by_the_form_and_job_roles(api, db, role):
    assert api.get("/api/v1/sectors", headers=as_role(db, role)).status_code == (200 if role in SECTOR_READERS else 403)


def test_an_admin_creates_a_sector(api, admin):
    name = unique("Logistics")
    res = api.post("/api/v1/sectors", headers=admin, json={"name": name})
    assert res.status_code == 201
    assert res.json()["data"]["name"] == name and ISO_Z.fullmatch(res.json()["data"]["created_at"])


def test_a_sector_name_is_unique_and_2_to_100_characters(api, db, admin):
    s = Sector(name=unique("Taken"))
    db.add(s)
    db.flush()
    dup = api.post("/api/v1/sectors", headers=admin, json={"name": s.name})
    assert (dup.status_code, dup.json()["error"]) == (409, {"code": "duplicate", "message": "A sector with this name already exists."})
    assert api.post("/api/v1/sectors", headers=admin, json={"name": "x"}).status_code == 422


def test_a_concurrent_duplicate_sector_is_still_409(api, db, admin, monkeypatch):
    s = Sector(name=unique("Race"))
    db.add(s)
    db.flush()

    class NothingFound:
        def first(self):
            return None

    real_scalars = db.scalars
    monkeypatch.setattr(db, "scalars", lambda stmt, *a, **k: NothingFound() if "Sector" in str(stmt) else real_scalars(stmt, *a, **k))
    assert api.post("/api/v1/sectors", headers=admin, json={"name": s.name}).status_code == 409


def test_an_admin_deletes_a_sector_and_a_second_delete_is_404(api, db, admin):
    s = Sector(name=unique("Going"))
    db.add(s)
    db.flush()
    res = api.delete(f"/api/v1/sectors/{s.id}", headers=admin)
    assert (res.status_code, res.json()) == (200, {"data": {"id": s.id}})
    assert api.delete(f"/api/v1/sectors/{s.id}", headers=admin).json()["error"] == {"code": "not_found", "message": "Sector not found."}


def test_only_admin_writes_sectors(api, db):
    s = Sector(name=unique("Kept"))
    db.add(s)
    db.flush()
    director = as_role(db, Role.director)
    assert api.post("/api/v1/sectors", headers=director, json={"name": unique("S")}).status_code == 403
    assert api.delete(f"/api/v1/sectors/{s.id}", headers=director).status_code == 403


# --- a country's document requirements ---------------------------------------


def url(country_id: str) -> str:
    return f"/api/v1/countries/{country_id}/document-requirements"


def test_an_admin_replaces_a_countrys_list(api, db, admin, country, doc_types):
    first = api.put(url(country.id), headers=admin, json={"document_types": [doc_types[0]]})
    assert first.status_code == 200
    second = api.put(url(country.id), headers=admin, json={"document_types": doc_types})
    data = second.json()["data"]
    assert [r["document_type"] for r in data] == sorted(doc_types)
    assert all(r["country_id"] == country.id and ISO_Z.fullmatch(r["created_at"]) for r in data)
    assert api.put(url(country.id), headers=admin, json={"document_types": []}).json() == {"data": []}


def test_requirements_are_read_by_staff_and_the_candidate(api, db, admin, country, doc_types):
    api.put(url(country.id), headers=admin, json={"document_types": doc_types})
    res = api.get(url(country.id), headers=as_role(db, Role.candidate))
    assert [r["document_type"] for r in res.json()["data"]] == sorted(doc_types)


@pytest.mark.parametrize("role", list(Role))
def test_requirement_readers(api, db, country, role):
    assert api.get(url(country.id), headers=as_role(db, role)).status_code == (200 if role in REQUIREMENT_READERS else 403)


def test_an_unknown_country_has_no_requirements_and_cant_get_any(api, admin, doc_types):
    assert api.get(url("cnosuchcountry00"), headers=admin).json() == {"data": []}
    res = api.put(url("cnosuchcountry00"), headers=admin, json={"document_types": doc_types})
    assert (res.status_code, res.json()["error"]) == (404, {"code": "not_found", "message": "Country not found."})


def test_an_unknown_document_type_changes_nothing(api, db, admin, country, doc_types):
    api.put(url(country.id), headers=admin, json={"document_types": [doc_types[0]]})
    res = api.put(url(country.id), headers=admin, json={"document_types": [doc_types[1], "no_such_type"]})
    assert (res.status_code, res.json()["error"]) == (422, {"code": "unknown_type", "message": "One or more document types don't exist."})
    assert [r["document_type"] for r in api.get(url(country.id), headers=admin).json()["data"]] == [doc_types[0]]


def test_a_type_ticked_twice_is_one_requirement(api, admin, country, doc_types):
    res = api.put(url(country.id), headers=admin, json={"document_types": [doc_types[0], doc_types[0]]})
    assert [r["document_type"] for r in res.json()["data"]] == [doc_types[0]]


@pytest.mark.parametrize("body", [{}, {"document_types": "passport"}, {"document_types": [""]}, {"document_types": ["x" * 61]}])
def test_requirement_input_rules(api, admin, country, body):
    res = api.put(url(country.id), headers=admin, json=body)
    assert res.status_code == 422
    assert {"document_types", "document_types.0"} & set(res.json()["error"]["details"])


def test_only_admin_replaces_requirements(api, db, country, doc_types):
    assert api.put(url(country.id), headers=as_role(db, Role.director), json={"document_types": doc_types}).status_code == 403


def test_the_api_database_role_can_write_them(api, db, admin, country, doc_types):
    db.execute(text("SET LOCAL ROLE vertex_api"))
    try:
        s = api.post("/api/v1/sectors", headers=admin, json={"name": unique("As api")})
        r = api.put(url(country.id), headers=admin, json={"document_types": doc_types})
        d = api.delete(f"/api/v1/sectors/{s.json()['data']['id']}", headers=admin)
    finally:
        db.execute(text("RESET ROLE"))
    assert (s.status_code, r.status_code, d.status_code) == (201, 200, 200)


def test_document_types_stay_with_nextjs_until_jobs_move():
    # A table has one writer: the website's job routes still create receipt
    # types (paymentReceiptTypes.ts), so FastAPI must not write them yet.
    assert not any(route.path.startswith("/document-types") for route in reference.router.routes)
    assert "DocumentRequirementType" not in (BASE_DIR / "deploy" / "db-roles.sql").read_text(encoding="utf-8").split("-- FastAPI-owned tables")[1].split("] LOOP")[0]

