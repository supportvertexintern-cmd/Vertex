"""The landing CMS (app/api/v1/landing.py): marketing and admin edit the
landing pages' blocks; visitors see only what is published, or the built-in
text; drafts stay private; every body is plain text with checked links."""

import copy
import importlib.util

import pytest
from sqlalchemy import select, text

from app.core.config import BASE_DIR, settings
from app.models.audit import AuditLog
from app.models.content import ContentBlock, ContentRevision
from app.models.enums import Role
from app.services.landing_content import BLOCK_VERSION, BLOCKS, ICONS, blocks_for
from tests.test_content import api, as_role  # noqa: F401  (a fixture and a helper)
from tests.test_db_roles import roles_provisioned  # noqa: F401  (vertex_api must exist)
from tests.test_service_auth import SERVICE_SECRET, service_token

URL = "/api/v1/content"
EDITORS = {Role.marketing, Role.admin}


def website(session: dict[str, str] | None = None) -> dict[str, str]:
    return {"X-Vertex-Service": service_token()} | (session or {})


@pytest.fixture(autouse=True)
def service_secret(monkeypatch):
    monkeypatch.setattr(settings, "SERVICE_AUTH_SECRET", SERVICE_SECRET)
    monkeypatch.setattr(settings, "SERVICE_AUTH_SECRET_PREVIOUS", None)


@pytest.fixture
def marketing(db):
    return as_role(db, Role.marketing)


def landing(api, app: str, headers: dict[str, str] | None = None, **params) -> dict:
    res = api.get(f"{URL}/landing", params={"app": app, **params}, headers=headers or website())
    assert res.status_code == 200, res.text
    return {b["key"]: b for b in res.json()["data"]["blocks"]}


def edited(key: str, **changes) -> dict:
    body = copy.deepcopy(BLOCKS[key].default)
    body.update(changes)
    return body


# --- the registry -------------------------------------------------------------


def test_every_block_is_named_for_its_group_and_its_icons_are_known():
    for key, spec in BLOCKS.items():
        assert key.split(".")[0] == spec.group
    def icons(value):
        if isinstance(value, dict):
            yield from ([value["icon"]] if "icon" in value else [])
            for v in value.values():
                yield from icons(v)
        elif isinstance(value, list):
            for v in value:
                yield from icons(v)
    for spec in BLOCKS.values():
        assert set(icons(spec.default)) <= set(ICONS), spec.key


def test_the_apps_fallbacks_are_the_built_in_text():
    # The website and the mobile app show these when FastAPI can't answer.
    spec = importlib.util.spec_from_file_location("export_landing_defaults", BASE_DIR / "scripts" / "export_landing_defaults.py")
    exporter = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(exporter)
    assert exporter._read(exporter.OUT) == exporter.defaults_text(), "run: python scripts/export_landing_defaults.py"
    assert exporter._read(exporter.MOBILE_OUT) == exporter.mobile_defaults_text(), "run: python scripts/export_landing_defaults.py"


def test_each_app_gets_its_own_blocks_and_the_shared_ones():
    web = {s.key for s in blocks_for("web")}
    assert "web.hero" in web and "shared.contact" in web and not any(k.startswith("mobile.") for k in web)
    mobile = {s.key for s in blocks_for("mobile")}
    assert "mobile.hero" in mobile and "shared.why_vertex" in mobile and not any(k.startswith("web.") for k in mobile)


# --- who may do what ---------------------------------------------------------


@pytest.mark.parametrize("role", list(Role))
def test_only_marketing_and_admin_edit(api, db, role):
    h = as_role(db, role)
    ok = role in EDITORS
    assert api.get(f"{URL}/blocks", headers=h).status_code == (200 if ok else 403)
    assert api.get(f"{URL}/blocks/web.jobs", headers=h).status_code == (200 if ok else 403)
    save = api.put(f"{URL}/blocks/web.jobs/draft", headers=h, json={"body": edited("web.jobs", title=f"By {role.value}")})
    assert save.status_code == (200 if ok else 403)
    for path in ("publish", "discard", "revisions/1/restore"):
        code = api.post(f"{URL}/blocks/web.jobs/{path}", headers=h).status_code
        assert (code != 403) if ok else (code == 403), (path, code)
    assert api.get(f"{URL}/blocks/web.jobs/revisions", headers=h).status_code == (200 if ok else 403)


def test_the_landing_read_needs_the_website_or_a_session(api, db):
    assert api.get(f"{URL}/landing", params={"app": "web"}).status_code == 401
    assert api.get(f"{URL}/landing", params={"app": "web"}, headers=as_role(db, Role.partner)).status_code == 200


def test_drafts_are_previewed_by_editors_only(api, db, marketing):
    assert api.put(f"{URL}/blocks/web.jobs/draft", headers=marketing, json={"body": edited("web.jobs", title="Draft title")}).status_code == 200
    assert landing(api, "web")["web.jobs"]["body"]["title"] == "Live opportunities."  # visitors: still the built-in text
    assert landing(api, "web", website(marketing), preview="true")["web.jobs"]["body"]["title"] == "Draft title"
    for caller in (website(), website(as_role(db, Role.hr)), as_role(db, Role.virtual_assistant)):
        res = api.get(f"{URL}/landing", params={"app": "web", "preview": "true"}, headers=caller)
        assert res.status_code == 403


# --- the lifecycle ------------------------------------------------------------


def test_before_anything_is_published_the_built_in_text_shows(api, db):
    blocks = landing(api, "mobile")
    assert list(blocks) == [s.key for s in blocks_for("mobile")]
    assert all(b["revision"] == 0 and b["visible"] for b in blocks.values())
    assert blocks["shared.contact"]["body"] == BLOCKS["shared.contact"].default
    res = api.get(f"{URL}/landing", params={"app": "web"}, headers=website()).json()["data"]
    assert (res["app"], res["version"]) == ("web", BLOCK_VERSION)


def test_publish_shows_it_keeps_a_revision_and_an_old_one_can_come_back(api, db, marketing):
    def publish(title: str) -> dict:
        assert api.put(f"{URL}/blocks/web.jobs/draft", headers=marketing, json={"body": edited("web.jobs", title=title)}).status_code == 200
        res = api.post(f"{URL}/blocks/web.jobs/publish", headers=marketing)
        assert res.status_code == 200, res.text
        return res.json()["data"]

    first = publish("First published")
    assert first["draft"] is None and first["published"]["revision"] == 1
    assert first["published"]["published_by"] == "Content Test"
    assert landing(api, "web")["web.jobs"] | {} == {"key": "web.jobs", "visible": True, "body": edited("web.jobs", title="First published"), "revision": 1}
    publish("Second published")
    history = api.get(f"{URL}/blocks/web.jobs/revisions", headers=marketing).json()["data"]
    assert [(r["number"], r["body"]["title"]) for r in history] == [(2, "Second published"), (1, "First published")]

    restored = api.post(f"{URL}/blocks/web.jobs/revisions/1/restore", headers=marketing).json()["data"]
    assert restored["draft"]["body"]["title"] == "First published"
    assert landing(api, "web")["web.jobs"]["body"]["title"] == "Second published"  # until it is published again
    discarded = api.post(f"{URL}/blocks/web.jobs/discard", headers=marketing).json()["data"]
    assert discarded["draft"] is None and discarded["published"]["body"]["title"] == "Second published"


def test_a_hidden_block_sends_no_body(api, marketing):
    api.put(f"{URL}/blocks/web.referral/draft", headers=marketing, json={"body": BLOCKS["web.referral"].default, "visible": False})
    api.post(f"{URL}/blocks/web.referral/publish", headers=marketing)
    assert landing(api, "web")["web.referral"] == {"key": "web.referral", "visible": False, "body": None, "revision": 1}


def test_a_shared_block_changes_both_apps(api, marketing):
    api.put(f"{URL}/blocks/shared.contact/draft", headers=marketing, json={"body": edited("shared.contact", email="hello@example.org")})
    api.post(f"{URL}/blocks/shared.contact/publish", headers=marketing)
    assert landing(api, "web")["shared.contact"]["body"]["email"] == "hello@example.org"
    assert landing(api, "mobile")["shared.contact"]["body"]["email"] == "hello@example.org"


def test_nothing_to_publish_and_unknown_blocks(api, marketing):
    res = api.post(f"{URL}/blocks/web.faq/publish", headers=marketing)
    assert (res.status_code, res.json()["error"]["code"]) == (409, "no_draft")
    assert api.get(f"{URL}/blocks/web.nosuch", headers=marketing).status_code == 404
    assert api.put(f"{URL}/blocks/web.nosuch/draft", headers=marketing, json={"body": {}}).status_code == 404
    assert api.post(f"{URL}/blocks/web.jobs/revisions/99/restore", headers=marketing).status_code == 404


# --- what a body may hold ----------------------------------------------------


BAD = {
    "html in text": edited("web.jobs", title="<script>alert(1)</script>"),
    "an html tag": edited("web.jobs", empty_text="Hello <img src=x onerror=alert(1)>"),
    "a script link": edited("web.jobs", view_all={"label": "Jobs", "href": "javascript:alert(1)"}),
    "a data link": edited("web.jobs", view_all={"label": "Jobs", "href": "data:text/html,hi"}),
    "an off-site plain-http link": edited("web.jobs", view_all={"label": "Jobs", "href": "http://evil.example"}),
    "a protocol-relative link": edited("web.jobs", view_all={"label": "Jobs", "href": "//evil.example"}),
    "an unknown field": edited("web.jobs", colour="red"),
    "a missing field": {k: v for k, v in BLOCKS["web.jobs"].default.items() if k != "title"},
    "an empty title": edited("web.jobs", title="   "),
    "a control character": edited("web.jobs", title="Bell\x07"),
    "too long": edited("web.jobs", title="x" * 161),
    "an unknown icon": edited("web.process", cards=[{"icon": "skull", "title": "T", "text": "X"}]),
    "too many items": edited("web.process", cards=[{"title": f"T{i}", "text": "X"} for i in range(13)]),
    "no items": edited("web.process", cards=[]),
    "a bad email": edited("shared.contact", email="not-an-email"),
    "a bad phone": edited("shared.contact", office="call us"),
}


@pytest.mark.parametrize("case", sorted(BAD))
def test_a_body_that_does_not_fit_is_refused(api, marketing, case):
    key = "shared.contact" if "email" in case or "phone" in case else "web.process" if "icon" in case or "items" in case else "web.jobs"
    res = api.put(f"{URL}/blocks/{key}/draft", headers=marketing, json={"body": BAD[case]})
    assert res.status_code == 400, res.text
    error = res.json()["error"]
    assert error["code"] == "validation_error" and error["details"]["issues"]
    assert "alert" not in res.text  # where and why, never the value back


@pytest.mark.parametrize("href", ["/apply", "#partner-form", "https://wa.me/447438613251", "mailto:a@b.co", "tel:+44 20 3026 3403"])
def test_the_links_a_page_uses_are_accepted(api, marketing, href):
    res = api.put(f"{URL}/blocks/web.jobs/draft", headers=marketing, json={"body": edited("web.jobs", view_all={"label": "Go", "href": href})})
    assert res.status_code == 200, res.text


def test_text_is_trimmed_and_line_breaks_kept(api, marketing):
    res = api.put(f"{URL}/blocks/web.ending/draft", headers=marketing, json={"body": edited("web.ending", title="  One.\r\nTwo.  ")})
    assert res.json()["data"]["draft"]["body"]["title"] == "One.\nTwo."


# --- the trail and the database role ------------------------------------------


def test_every_change_is_on_the_audit_trail(api, db, marketing):
    api.put(f"{URL}/blocks/web.workforce/draft", headers=marketing, json={"body": BLOCKS["web.workforce"].default})
    api.post(f"{URL}/blocks/web.workforce/publish", headers=marketing)
    rows = db.scalars(select(AuditLog).where(AuditLog.entity_type.in_(["ContentBlock", "ContentRevision"])))
    seen = {(r.entity_type, r.action) for r in rows if r.entity_type == "ContentRevision" or r.entity_id == "web.workforce"}
    assert {("ContentBlock", "create"), ("ContentBlock", "update"), ("ContentRevision", "create")} <= seen
    revision = db.scalar(select(ContentRevision).where(ContentRevision.block_key == "web.workforce"))
    assert revision is not None and revision.published_by is not None


def test_the_api_database_role_can_write_them(api, db, marketing):
    db.execute(text("SET LOCAL ROLE vertex_api"))
    try:
        d = api.put(f"{URL}/blocks/web.hero/draft", headers=marketing, json={"body": BLOCKS["web.hero"].default})
        p = api.post(f"{URL}/blocks/web.hero/publish", headers=marketing)
    finally:
        db.execute(text("RESET ROLE"))
    assert (d.status_code, p.status_code) == (200, 200)
    assert db.get(ContentBlock, "web.hero").revision == 1
