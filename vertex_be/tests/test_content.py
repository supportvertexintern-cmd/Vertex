"""Knowledge articles and email templates (step 3.1) answer as Next.js's
/api/admin/knowledge and /api/admin/emails did: admin only, the same 400 for
missing fields, the same JSON."""

import re
import secrets

import pytest
from sqlalchemy import text

from app.db.session import get_db
from app.main import app
from app.models.enums import Role
from app.models.identity import User
from app.models.reference import EmailTemplate, KnowledgeArticle
from tests.test_auth import add_session, bearer, session_token
from tests.test_db_roles import roles_provisioned  # noqa: F401  (vertex_api must exist)

ISO_Z = re.compile(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z")
MISSING = {"code": "validation_error", "message": "Missing required fields"}


@pytest.fixture
def api(db, client):
    app.dependency_overrides[get_db] = lambda: db
    yield client
    app.dependency_overrides.pop(get_db, None)


def as_role(db, role: Role) -> dict[str, str]:
    u = User(full_name="Content Test", email=f"content-{secrets.token_hex(4)}@test.invalid", role=role)
    db.add(u)
    db.flush()
    db.refresh(u)
    s = add_session(db, u.id)
    return bearer(session_token(u.id, s.family_id, u.token_version))


@pytest.fixture
def admin(db):
    return as_role(db, Role.admin)


def unique(prefix: str) -> str:
    return f"{prefix} {secrets.token_hex(4)}"


@pytest.mark.parametrize("role", list(Role))
def test_only_admin_reads_and_writes_content(api, db, role):
    headers = as_role(db, role)
    expected = (200, 201) if role is Role.admin else (403, 403)
    got = (
        api.get("/api/v1/knowledge", headers=headers).status_code,
        api.post("/api/v1/knowledge", headers=headers, json={"title": "T", "content": "C"}).status_code,
    )
    assert got == expected
    assert api.get("/api/v1/email-templates", headers=headers).status_code == expected[0]
    assert api.put("/api/v1/email-templates", headers=headers, json={"event": "ctest", "subject": "S", "body_html": "B"}).status_code == expected[0]
    assert api.delete("/api/v1/knowledge/cnosuchone0000", headers=headers).status_code == (404 if role is Role.admin else 403)


# --- knowledge articles ------------------------------------------------------


def test_an_admin_adds_lists_and_deletes_an_article(api, db, admin):
    title = unique("Visa basics")
    res = api.post("/api/v1/knowledge", headers=admin, json={"title": title, "category": "Visas", "content": "How it works."})
    assert res.status_code == 201
    article = res.json()["data"]
    assert set(article) == {"id", "title", "category", "content", "created_at", "updated_at"}
    assert (article["title"], article["category"]) == (title, "Visas") and ISO_Z.fullmatch(article["updated_at"])

    listed = api.get("/api/v1/knowledge", headers=admin).json()["data"]
    assert article["id"] in [a["id"] for a in listed]
    categories = [a["category"] for a in listed]
    assert categories == sorted(categories)

    assert api.delete(f"/api/v1/knowledge/{article['id']}", headers=admin).json() == {"data": {"id": article["id"]}}
    second = api.delete(f"/api/v1/knowledge/{article['id']}", headers=admin)
    assert (second.status_code, second.json()["error"]["message"]) == (404, "Article not found.")


@pytest.mark.parametrize("category", [None, ""])
def test_an_article_without_a_category_is_general(api, admin, category):
    res = api.post("/api/v1/knowledge", headers=admin, json={"title": unique("T"), "content": "C", "category": category})
    assert res.json()["data"]["category"] == "General"


@pytest.mark.parametrize("body", [{}, {"title": "T"}, {"content": "C"}, {"title": "", "content": "C"}])
def test_an_article_needs_a_title_and_content(api, admin, body):
    res = api.post("/api/v1/knowledge", headers=admin, json=body)
    assert (res.status_code, res.json()["error"]) == (400, MISSING)


def test_article_lengths(api, admin):
    assert api.post("/api/v1/knowledge", headers=admin, json={"title": "x" * 301, "content": "C"}).status_code == 422


# --- email templates ---------------------------------------------------------


def test_an_admin_saves_then_replaces_a_template(api, db, admin):
    event = f"ctest_{secrets.token_hex(3)}"
    first = api.put("/api/v1/email-templates", headers=admin, json={"event": event, "subject": "Hi", "body_html": "<p>1</p>"})
    assert first.status_code == 200
    assert set(first.json()["data"]) == {"event", "subject", "body_html", "updated_at"}
    second = api.put("/api/v1/email-templates", headers=admin, json={"event": event, "subject": "Hello", "body_html": "<p>2</p>"}).json()["data"]
    assert (second["subject"], second["body_html"]) == ("Hello", "<p>2</p>")
    assert db.get(EmailTemplate, event).subject == "Hello"

    events = [t["event"] for t in api.get("/api/v1/email-templates", headers=admin).json()["data"]]
    assert event in events and events == sorted(events)


@pytest.mark.parametrize("body", [{}, {"event": "welcome", "subject": "S"}, {"event": "", "subject": "S", "body_html": "B"}])
def test_a_template_needs_every_field(api, admin, body):
    res = api.put("/api/v1/email-templates", headers=admin, json=body)
    assert (res.status_code, res.json()["error"]) == (400, MISSING)


def test_the_api_database_role_can_write_them(api, db, admin):
    db.execute(text("SET LOCAL ROLE vertex_api"))
    try:
        a = api.post("/api/v1/knowledge", headers=admin, json={"title": unique("As api"), "content": "C"})
        d = api.delete(f"/api/v1/knowledge/{a.json()['data']['id']}", headers=admin)
        t = api.put("/api/v1/email-templates", headers=admin, json={"event": "ctest_as_api", "subject": "S", "body_html": "B"})
    finally:
        db.execute(text("RESET ROLE"))
    assert (a.status_code, d.status_code, t.status_code) == (201, 200, 200)
    assert db.get(KnowledgeArticle, a.json()["data"]["id"]) is None
