"""Employer clients (step 4.1) answer as Next.js's /api/admin/employer-clients
routes did: the same roles, rules, messages, status codes and JSON."""

import re
import secrets

import pytest
from pydantic import TypeAdapter, ValidationError
from sqlalchemy import select, text

from app.api.v1.partners import EMPLOYER_CLIENT_MANAGERS, EMPLOYER_CLIENT_READERS
from app.core.api import Email
from app.core.config import BASE_DIR
from app.db.session import get_db
from app.main import app
from app.models.audit import AuditLog
from app.models.enums import Role
from app.models.identity import User
from app.models.jobs import EmployerClient, Job
from tests.test_auth import add_session, bearer, session_token
from tests.test_db_roles import roles_provisioned  # noqa: F401  (vertex_api must exist)

NEXT_ROUTES = BASE_DIR.parent / "vertex" / "src" / "app" / "api" / "admin" / "employer-clients"
ISO_Z = re.compile(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z")
URL = "/api/v1/employer-clients"


@pytest.fixture
def api(db, client):
    app.dependency_overrides[get_db] = lambda: db
    yield client
    app.dependency_overrides.pop(get_db, None)


def as_role(db, role: Role) -> tuple[str, dict[str, str]]:
    u = User(full_name="Partners Test", email=f"partners-{secrets.token_hex(4)}@test.invalid", role=role)
    db.add(u)
    db.flush()
    db.refresh(u)
    s = add_session(db, u.id)
    return u.id, bearer(session_token(u.id, s.family_id, u.token_version))


@pytest.fixture
def director(db):
    return as_role(db, Role.director)[1]


def new_client(**fields) -> dict:
    return {
        "name": f"Agro Farms {secrets.token_hex(3)}",
        "country": "Poland",
        "contact_name": "Anna Nowak",
        "contact_email": "anna@agro.test",
        "contact_phone": "+48 600 000 000",
    } | fields


def roles_in(src: str, method: str) -> set[str]:
    body = src[src.index(f"export async function {method}"):]
    found = re.search(r"requireRole\(user, \[(.*?)\]\)", body, re.S).group(1)
    if "EMPLOYER_CLIENT_MANAGER_ROLES" in found:
        found = re.search(r"const EMPLOYER_CLIENT_MANAGER_ROLES = \[(.*?)\]", src).group(1)
    return set(re.findall(r'"(\w+)"', found))


def test_the_roles_match_next_js():
    for route, methods in (("route.ts", ("GET", "POST")), ("[id]/route.ts", ("GET", "PATCH"))):
        src = (NEXT_ROUTES / route).read_text(encoding="utf-8")
        assert roles_in(src, "GET") == {r.value for r in EMPLOYER_CLIENT_READERS}, route
        write = methods[1]
        assert roles_in(src, write) == {r.value for r in EMPLOYER_CLIENT_MANAGERS}, route


def test_a_director_creates_a_client_in_prismas_shape(api, director):
    res = api.post(URL, headers=director, json=new_client(industry="Agriculture"))
    assert res.status_code == 201
    data = res.json()["data"]
    assert set(data) == {
        "id", "name", "country", "industry", "contact_name", "contact_email", "contact_phone", "status", "notes", "created_at", "updated_at",
    }
    assert (data["status"], data["industry"], data["notes"]) == ("active", "Agriculture", None)
    assert ISO_Z.fullmatch(data["created_at"])


@pytest.mark.parametrize(
    "fields",
    [{"name": "A"}, {"contact_email": "not-an-email"}, {"contact_phone": "12"}, {"notes": "n" * 2001}, {"country": None}],
)
def test_create_rules(api, director, fields):
    res = api.post(URL, headers=director, json=new_client(**fields))
    assert res.status_code == 422
    assert set(res.json()["error"]["details"]) == set(fields)


def test_the_list_counts_jobs_and_is_by_name(api, db, director):
    client = EmployerClient(**new_client(name=f"Aaa Client {secrets.token_hex(3)}"))
    db.add(client)
    db.flush()
    for i in range(2):
        db.add(Job(title=f"Job {i}", country="Poland", city="Lodz", job_description="d", requirements="r", employer_client_id=client.id))
    db.flush()
    _, marketing = as_role(db, Role.marketing)
    rows = api.get(URL, headers=marketing).json()["data"]
    [mine] = [r for r in rows if r["id"] == client.id]
    assert mine["_count"] == {"jobs": 2}
    names = [r["name"] for r in rows]
    assert names == sorted(names)


def test_the_detail_lists_its_jobs_newest_first(api, db, director):
    client = EmployerClient(**new_client())
    db.add(client)
    db.flush()
    db.add(Job(title="Picker", country="Poland", city="Lodz", job_description="d", requirements="r", employer_client_id=client.id))
    db.flush()
    data = api.get(f"{URL}/{client.id}", headers=director).json()["data"]
    assert [set(j) for j in data["jobs"]] == [{"id", "title", "country", "city", "status", "created_at"}]
    missing = api.get(f"{URL}/cnosuchclient00", headers=director)
    assert (missing.status_code, missing.json()["error"]["message"]) == (404, "Employer/client not found.")


def test_an_edit_changes_only_what_it_sends(api, db, director):
    created = api.post(URL, headers=director, json=new_client(industry="Agri", notes="Met in May")).json()["data"]
    res = api.patch(f"{URL}/{created['id']}", headers=director, json={"status": "inactive", "notes": None})
    data = res.json()["data"]
    assert (data["status"], data["notes"], data["industry"], data["name"]) == ("inactive", None, "Agri", created["name"])


@pytest.mark.parametrize("fields", [{"name": None}, {"status": "archived"}, {"contact_email": "x"}])
def test_edit_rules(api, director, fields):
    created = api.post(URL, headers=director, json=new_client()).json()["data"]
    assert api.patch(f"{URL}/{created['id']}", headers=director, json=fields).status_code == 422


def test_editing_a_missing_client(api, director):
    res = api.patch(f"{URL}/cnosuchclient00", headers=director, json={"status": "inactive"})
    assert (res.status_code, res.json()["error"]["message"]) == (404, "Employer/client not found.")


@pytest.mark.parametrize("role", list(Role))
def test_who_reads_and_who_writes(api, db, role):
    _, headers = as_role(db, role)
    assert api.get(URL, headers=headers).status_code == (200 if role in EMPLOYER_CLIENT_READERS else 403)
    assert api.post(URL, headers=headers, json=new_client()).status_code == (201 if role in EMPLOYER_CLIENT_MANAGERS else 403)


def test_writes_are_on_the_trail_and_work_as_vertex_api(api, db):
    actor, headers = as_role(db, Role.admin)
    db.execute(text("SET LOCAL ROLE vertex_api"))
    try:
        created = api.post(URL, headers=headers, json=new_client())
        edited = api.patch(f"{URL}/{created.json()['data']['id']}", headers=headers, json={"status": "inactive"})
    finally:
        db.execute(text("RESET ROLE"))
    assert (created.status_code, edited.status_code) == (201, 200)
    trail = db.scalars(select(AuditLog).where(AuditLog.entity_id == created.json()["data"]["id"]).order_by(AuditLog.created_at, AuditLog.id))
    assert [(e.action, e.actor_id) for e in trail] == [("create", actor), ("update", actor)]


@pytest.mark.parametrize(
    ("address", "ok"),
    [
        ("anna@agro.test", True),  # EmailStr would refuse a reserved domain; zod doesn't
        ("first.last+tag@example.co.uk", True),
        ("o'brien@example.com", True),
        ("no-at-sign.example.com", False),
        ("a..b@example.com", False),
        ("anna@localhost", False),
        ("anna@example.c", False),
    ],
)
def test_emails_are_checked_as_zod_checks_them(address, ok):
    try:
        TypeAdapter(Email).validate_python(address)
        accepted = True
    except ValidationError as err:
        assert err.errors()[0]["msg"] == "Invalid email address"
        accepted = False
    assert accepted is ok

