"""Admin → Monitoring, phases 4 and 5 (owner's requirements 2026-11-07,
migration 0015): the read-only Audit Trail, whose every read is recorded;
the Security Overview; and the account checks: many accounts from one
address and a sign-in from a new address after a password reset (on each
sign-in), partner logins never activated and inactive logins (scheduled).
Admins only."""

from __future__ import annotations

import secrets
from datetime import timedelta

import pytest

from app.core.clock import utc_now_ms
from app.core.config import settings
from app.models.enums import Role
from app.services import security_monitor
from tests.mail import of, token as mailed_token
from tests.test_account_monitoring import admin, signed_in, trail  # noqa: F401  (fixtures)
from tests.test_auth import bearer
from tests.test_partner_activation import partner_login
from tests.test_sessions import IP, PASSWORD, account, api, google, svc  # noqa: F401  (fixtures)
from tests.test_suspicious_activity import committed

AUDIT = "/api/v1/monitoring/audit"


@pytest.fixture(autouse=True)
def quiet(monkeypatch):
    monkeypatch.setattr(settings, "SMTP_HOST", None)
    monkeypatch.setattr(security_monitor, "dispatch", lambda send: send())
    security_monitor.reset_dedupe()


def sign_in_from(api, user, ip, password=PASSWORD):
    return api.post("/api/v1/auth/login", headers={**svc(), "X-Forwarded-For": ip}, json={"email": user.email, "password": password})


def fresh_ip() -> str:
    return f"198.51.{secrets.randbelow(250)}.{secrets.randbelow(250)}-{secrets.token_hex(3)}"


@pytest.mark.parametrize("role", [Role.director, Role.hr, Role.partner])
def test_only_admins(api, db, role):
    headers = bearer(signed_in(api, account(db, role=role))[0])
    assert api.get(AUDIT, headers=headers).status_code == 403
    assert api.get("/api/v1/monitoring/overview", headers=headers).status_code == 403
    assert api.post("/api/v1/monitoring/checks/run", headers=headers).status_code == 403


# --- Audit Trail ---------------------------------------------------------------------------


def test_who_did_what_with_the_fields_that_changed(api, db, admin):
    me, headers = admin
    res = api.post("/api/v1/partners", headers=headers, json={
        "name": f"Trail {secrets.token_hex(3)}", "partner_type": "travel_agency", "country_of_operation": "Ghana",
        "contact_name": "Contact Person", "contact_email": f"t-{secrets.token_hex(4)}@test.invalid", "contact_phone": "N/A",
    })
    partner = res.json()["data"]
    assert api.patch(f"/api/v1/partners/{partner['id']}", headers=headers, json={"status": "active"}).status_code == 200
    rows = api.get(AUDIT, headers=headers, params={"entity_type": "Partner", "entity_id": partner["id"]}).json()["data"]
    update, create = rows[0], rows[-1]
    assert (update["action"], update["actor"]["full_name"], update["record"]) == ("update", "Monitoring Admin", partner["name"])
    assert update["changes"] == [{"field": "status", "before": "pending", "after": "active"}]
    assert create["action"] == "create" and {"field": "name", "before": None, "after": partner["name"]} in create["changes"]


def test_an_accounts_security_events_are_its_history_with_the_address(api, db, admin):
    _, headers = admin
    user = account(db, role=Role.hr)
    ip = fresh_ip()
    assert sign_in_from(api, user, ip).status_code == 200
    data = api.get(AUDIT, headers=headers, params={"entity_id": user.id, "action": "login_succeeded"}).json()["data"]
    [row] = data
    assert (row["entity_id"], row["ip"], row["record"]) == (f"user:{user.id}", ip, user.full_name)
    assert row["changes"] == [] and row["detail"]["method"] == "password"


def test_every_read_is_recorded_with_its_filters(api, db, admin):
    me, headers = admin
    marker = f"c{secrets.token_hex(12)}"
    assert api.get(AUDIT, headers=headers, params={"entity_id": marker, "action": "update"}).status_code == 200
    [viewed] = trail("action = 'audit_trail_viewed' AND entity_id = :e", e=marker)
    assert viewed["actor_id"] == me.id and viewed["after"]["filters"] == {"entity_id": marker, "action": "update"}


def test_paged_with_the_total(api, db, admin):
    _, headers = admin
    user = account(db, role=Role.hr)
    for _ in range(3):
        assert sign_in_from(api, user, fresh_ip()).status_code == 200
    page = api.get(AUDIT, headers=headers, params={"entity_id": user.id, "action": "login_succeeded", "pageSize": 2}).json()
    assert (page["total"], len(page["data"])) == (3, 2)
    rest = api.get(AUDIT, headers=headers, params={"entity_id": user.id, "action": "login_succeeded", "pageSize": 2, "page": 2}).json()
    assert len(rest["data"]) == 1


def test_nothing_on_the_page_changes_the_trail(api, db, admin):
    _, headers = admin
    for method in ("post", "patch", "put", "delete"):
        assert getattr(api, method)(AUDIT, headers=headers).status_code == 405


# --- account checks on each sign-in --------------------------------------------------------


def test_many_accounts_from_one_address(api, db):
    ip = fresh_ip()
    users = [account(db, role=Role.partner) for _ in range(security_monitor.SHARED_ADDRESS.threshold)]
    for u in users[:-1]:
        assert sign_in_from(api, u, ip).status_code == 200
    assert committed("alert_key = :k", k=f"shared_ip_sign_ins:ip:{ip}") == []
    assert sign_in_from(api, users[-1], ip).status_code == 200
    [row] = committed("alert_key = :k", k=f"shared_ip_sign_ins:ip:{ip}")
    assert (row["severity"], row["ip"], row["detail"]["accounts"]) == ("medium", ip, 5)


def test_a_sign_in_from_a_new_address_after_a_password_reset(api, db, sent_mail):
    user = account(db, role=Role.hr)
    known, other = fresh_ip(), fresh_ip()
    assert sign_in_from(api, user, known).status_code == 200
    assert api.post("/api/v1/accounts/forgot-password", headers=svc(), json={"email": user.email}).status_code == 200
    reset = mailed_token(of(sent_mail, "password_reset"))
    assert api.post("/api/v1/accounts/reset-password", headers=svc(), json={"token": reset, "password": "Brand-New-Pass1"}).status_code == 200
    key = f"sign_in_after_reset_new_ip:user:{user.id}"
    assert sign_in_from(api, user, known, "Brand-New-Pass1").status_code == 200  # an address it used before: fine
    assert committed("alert_key = :k", k=key) == []
    assert sign_in_from(api, user, other, "Brand-New-Pass1").status_code == 200
    [row] = committed("alert_key = :k", k=key)
    assert (row["severity"], row["ip"]) == ("high", other)


def test_no_reset_no_alert(api, db):
    user = account(db, role=Role.hr)
    assert sign_in_from(api, user, fresh_ip()).status_code == 200
    assert committed("alert_key = :k", k=f"sign_in_after_reset_new_ip:user:{user.id}") == []


# --- scheduled account checks ----------------------------------------------------------------


def test_scheduled_checks_raise_stale_partner_logins_and_inactive_accounts_once(db):
    now = utc_now_ms()
    stale = account(db, role=Role.partner, password=None)
    stale.created_at = now - timedelta(days=8)
    recent = account(db, role=Role.partner, password=None)  # created now: not yet
    idle = account(db, role=Role.hr)
    idle.activated_at = now - timedelta(days=90)
    idle.created_at = now - timedelta(days=90)
    db.flush()
    security_monitor.run_account_checks(db.connection())
    [waiting] = committed("alert_key = :k", k=f"partner_login_not_activated:user:{stale.id}")
    assert waiting["severity"] == "medium" and waiting["detail"]["days"] == 8
    assert committed("alert_key = :k", k=f"partner_login_not_activated:user:{recent.id}") == []
    [inactive] = committed("alert_key = :k", k=f"inactive_account:user:{idle.id}")
    assert inactive["detail"]["days"] >= 60
    # a second run (another worker, a restart) raises nothing new
    security_monitor.reset_dedupe()
    security_monitor.run_account_checks(db.connection())
    assert len(committed("alert_key = :k", k=f"inactive_account:user:{idle.id}")) == 1


def test_medium_alerts_are_rows_not_emails(monkeypatch):
    sent = []
    monkeypatch.setattr(settings, "SMTP_HOST", "smtp.test.invalid")
    monkeypatch.setattr(settings, "SECURITY_ALERT_EMAILS", "security@test.invalid")
    monkeypatch.setattr(security_monitor, "send_mail", lambda *a: sent.append(a) or True)
    key = f"x-{secrets.token_hex(4)}"
    assert security_monitor.raise_alert(security_monitor.INACTIVE_ACCOUNT, key, "idle", {}) is True
    assert sent == [] and len(committed("alert_key = :k", k=f"inactive_account:{key}")) == 1
    assert security_monitor.raise_alert(security_monitor.REFRESH_TOKEN_REUSED, key, "reused", {}) is True
    assert len(sent) == 1  # high and critical are emailed as before


# --- Security Overview -------------------------------------------------------------------------


def test_the_overview(api, db, admin):
    _, headers = admin
    before = api.get("/api/v1/monitoring/overview", headers=headers).json()["data"]
    login, _ = partner_login(db)
    login.password_hash = None
    login.created_at = utc_now_ms() - timedelta(days=10)
    db.flush()
    after = api.get("/api/v1/monitoring/overview", headers=headers).json()["data"]
    assert after["partner_logins_not_activated"] == before["partner_logins_not_activated"] + 1
    assert after["new_partners"]["last_24h"] == before["new_partners"]["last_24h"] + 1
    assert set(after["open_alerts"]) == {"critical", "high", "medium"}
    assert after["active_sessions"] >= 1 and after["sign_ins"]["last_7d"] >= after["sign_ins"]["last_24h"] >= 1
    assert len(after["recent_alerts"]) <= 10


def test_run_the_checks_now(api, db, admin):
    _, headers = admin
    res = api.post("/api/v1/monitoring/checks/run", headers=headers)
    assert res.status_code == 200 and isinstance(res.json()["data"]["raised"], int)
