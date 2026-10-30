"""Every write FastAPI makes is on the audit trail: each FastAPI-owned table
is audited, and each write route records who changed what, with the
before/after snapshots, in the same transaction."""

import secrets

import pytest
from sqlalchemy import select

from app.core.audit import AUDITED_MODELS
from app.db.session import get_db
from app.main import app
from app.models.audit import AuditLog
from app.models.enums import Role
from app.models.identity import Country, Region, User
from app.models.reference import DocumentRequirementType
from tests.test_auth import add_session, bearer, session_token
from tests.test_db_roles import fastapi_owned_tables


@pytest.fixture
def api(db, client):
    app.dependency_overrides[get_db] = lambda: db
    yield client
    app.dependency_overrides.pop(get_db, None)


@pytest.fixture
def admin(db) -> tuple[str, dict[str, str]]:
    u = User(full_name="Audit Cover", email=f"cover-{secrets.token_hex(4)}@test.invalid", role=Role.admin)
    db.add(u)
    db.flush()
    db.refresh(u)
    s = add_session(db, u.id)
    return u.id, bearer(session_token(u.id, s.family_id, u.token_version))


def entries(db, entity_type: str, entity_id: str) -> list[AuditLog]:
    rows = select(AuditLog).where(AuditLog.entity_type == entity_type, AuditLog.entity_id == entity_id)
    return list(db.scalars(rows.order_by(AuditLog.created_at, AuditLog.id)))


def actions(db, entity_type: str, entity_id: str) -> list[str]:
    return [e.action for e in entries(db, entity_type, entity_id)]


def unique(prefix: str) -> str:
    return f"{prefix} {secrets.token_hex(4)}"


# Exception E9 (docs/security/exceptions.md, users-handover.md D5): sessions
# rotate every 15 minutes per signed-in user, so they're recorded as security
# events, not row by row. Nothing else may join this list quietly.
NOT_ROW_AUDITED = {"RefreshToken"}


@pytest.mark.parametrize("table", sorted(set(fastapi_owned_tables()) - NOT_ROW_AUDITED))
def test_every_fastapi_owned_table_is_audited(table):
    assert table in AUDITED_MODELS


def test_only_sessions_are_excused():
    assert NOT_ROW_AUDITED == {"RefreshToken"}
    assert NOT_ROW_AUDITED <= set(fastapi_owned_tables())
    assert not NOT_ROW_AUDITED & set(AUDITED_MODELS)


def test_regions_and_countries(api, db, admin):
    actor, h = admin
    region = api.post("/api/v1/regions", headers=h, json={"name": unique("Audited region")}).json()["data"]
    new_name = unique("Renamed region")
    api.patch(f"/api/v1/regions/{region['id']}", headers=h, json={"name": new_name})
    country = api.post("/api/v1/countries", headers=h, json={"name": unique("Audited land"), "region_id": region["id"]}).json()["data"]
    api.patch(f"/api/v1/countries/{country['id']}", headers=h, json={"name": unique("Renamed land")})
    api.delete(f"/api/v1/countries/{country['id']}", headers=h)

    assert actions(db, "Region", region["id"]) == ["create", "update"]
    assert actions(db, "Country", country["id"]) == ["create", "update", "delete"]
    rename = entries(db, "Region", region["id"])[1]
    assert (rename.actor_id, rename.before["name"], rename.after["name"]) == (actor, region["name"], new_name)
    assert entries(db, "Country", country["id"])[-1].after is None


def test_sectors(api, db, admin):
    actor, h = admin
    sector = api.post("/api/v1/sectors", headers=h, json={"name": unique("Audited sector")}).json()["data"]
    api.delete(f"/api/v1/sectors/{sector['id']}", headers=h)
    logged = entries(db, "Sector", sector["id"])
    assert [(e.action, e.actor_id) for e in logged] == [("create", actor), ("delete", actor)]
    assert logged[1].before["name"] == sector["name"]


def test_a_requirements_replace_logs_only_what_changed(api, db, admin):
    _, h = admin
    region = Region(name=unique("Req region"))
    db.add(region)
    db.flush()
    country = Country(name=unique("Req land"), region_id=region.id)
    types = [DocumentRequirementType(key=f"cov_{secrets.token_hex(3)}", label=unique("Doc")) for _ in range(3)]
    db.add_all([country, *types])
    db.flush()
    a, b, c = (t.key for t in types)
    url = f"/api/v1/countries/{country.id}/document-requirements"

    first = {r["document_type"]: r["id"] for r in api.put(url, headers=h, json={"document_types": [a, b]}).json()["data"]}
    second = {r["document_type"]: r["id"] for r in api.put(url, headers=h, json={"document_types": [b, c]}).json()["data"]}

    assert second[b] == first[b]  # kept, not rewritten
    assert actions(db, "CountryDocumentRequirement", first[a]) == ["create", "delete"]
    assert actions(db, "CountryDocumentRequirement", first[b]) == ["create"]
    assert actions(db, "CountryDocumentRequirement", second[c]) == ["create"]


def test_settings_are_logged_by_their_key(api, db, admin):
    actor, h = admin
    api.put("/api/v1/settings", headers=h, json={"whatsapp_number": "+251900000001"})
    api.put("/api/v1/settings", headers=h, json={"whatsapp_number": "+251900000002"})
    last = entries(db, "SystemSetting", "whatsapp_number")[-1]
    assert (last.action, last.actor_id, last.after["value"]) == ("update", actor, "+251900000002")
    assert last.before["value"] == "+251900000001"


def test_an_unchanged_setting_logs_nothing(api, db, admin):
    _, h = admin
    api.put("/api/v1/settings", headers=h, json={"intake_mode": "email"})
    before = len(entries(db, "SystemSetting", "intake_mode"))
    api.put("/api/v1/settings", headers=h, json={"intake_mode": "email"})
    assert len(entries(db, "SystemSetting", "intake_mode")) == before


def test_articles_and_templates(api, db, admin):
    actor, h = admin
    article = api.post("/api/v1/knowledge", headers=h, json={"title": unique("Audited"), "content": "C"}).json()["data"]
    api.delete(f"/api/v1/knowledge/{article['id']}", headers=h)
    assert actions(db, "KnowledgeArticle", article["id"]) == ["create", "delete"]

    event = f"cov_{secrets.token_hex(3)}"
    api.put("/api/v1/email-templates", headers=h, json={"event": event, "subject": "One", "body_html": "B"})
    api.put("/api/v1/email-templates", headers=h, json={"event": event, "subject": "Two", "body_html": "B"})
    logged = entries(db, "EmailTemplate", event)
    assert [(e.action, e.actor_id) for e in logged] == [("create", actor), ("update", actor)]
    assert (logged[1].before["subject"], logged[1].after["subject"]) == ("One", "Two")


def test_a_refused_write_leaves_no_change_record(api, db, admin):
    _, h = admin
    name = unique("Taken sector")
    sector = api.post("/api/v1/sectors", headers=h, json={"name": name}).json()["data"]
    assert api.post("/api/v1/sectors", headers=h, json={"name": name}).status_code == 409
    assert actions(db, "Sector", sector["id"]) == ["create"]
