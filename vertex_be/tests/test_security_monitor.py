"""Reads handover R7a: the alert monitor (app/services/security_monitor.py,
from the website's lib/security-monitor.ts) and the audit events the
website records through POST /audit-events. The checks moved from the
website's security-events and audit-access integration tests: events are
recorded with the request's ID and without credentials, the agreed alerts
fire once per window with one email, and a failing audit trail never turns
a denial into access or lets an export out unrecorded."""

import logging
import secrets

import pytest
from sqlalchemy import text

from app.core import audit
from app.core.audit import record_security_event
from app.core.config import settings
from app.db.session import engine, get_db
from app.main import app
from app.models.enums import Role
from app.services import security_monitor
from tests.test_case_reads import add_user, h
from tests.test_service_auth import SERVICE_SECRET, service_token

SENT: list[tuple[list[str], str, str]] = []


@pytest.fixture(autouse=True)
def mail(monkeypatch):
    """Alerts mailed in line to a list, to security@test.invalid."""
    monkeypatch.setattr(settings, "SERVICE_AUTH_SECRET", SERVICE_SECRET)
    monkeypatch.setattr(settings, "SERVICE_AUTH_SECRET_PREVIOUS", None)
    monkeypatch.setattr(settings, "SMTP_HOST", "smtp.test.invalid")
    monkeypatch.setattr(settings, "SECURITY_ALERT_EMAILS", "security@test.invalid")
    monkeypatch.setattr(security_monitor, "dispatch", lambda send: send())
    monkeypatch.setattr(security_monitor, "send_mail", lambda to, subject, body: SENT.append((to, subject, body)) or True)
    security_monitor.reset_dedupe()
    SENT.clear()


@pytest.fixture
def api(db, client):
    app.dependency_overrides[get_db] = lambda: db
    yield client
    app.dependency_overrides.pop(get_db, None)


def tag() -> str:
    return secrets.token_hex(4)


def rows(where: str, **params) -> list[dict]:
    # The trail is read here as the test database's owner; vertex_api can't.
    with engine.connect() as conn:
        return [dict(r._mapping) for r in conn.execute(text(f'SELECT * FROM "AuditLog" WHERE {where} ORDER BY created_at'), params)]


def alerts(entity_id: str) -> list[dict]:
    return rows("action = 'alert_raised' AND entity_id = :e", e=entity_id)


# --- alerts --------------------------------------------------------------------------


def test_brute_force_on_one_account_one_alert_and_one_email(caplog):
    fp = f"fp{tag()}"
    with caplog.at_level(logging.INFO, logger="vertex"):
        for i in range(12):
            record_security_event("login_failed", actor_id=None, entity_type="Auth", entity_id="unknown_account",
                                  detail={"reason": "bad_password", "email_fp": fp, "ip": f"198.51.100.{i}"})
    [alert] = alerts(f"brute_force_account:account:{fp}")
    assert (alert["after"]["failures"], alert["after"]["severity"]) == (10, "high")
    assert [(to, "failed sign-ins for one account" in subject) for to, subject, _ in SENT] == [(["security@test.invalid"], True)]
    assert any(getattr(r, "event", None) == "alert.raised" and r.levelno == logging.CRITICAL for r in caplog.records)


def test_brute_force_from_one_address():
    ip = f"203.0.113.{secrets.randbelow(250)}-{tag()}"
    for i in range(20):
        record_security_event("login_failed", actor_id=None, entity_type="Auth", entity_id="x", detail={"email_fp": f"fp{i}{tag()}", "ip": ip})
    assert len(alerts(f"brute_force_ip:ip:{ip}")) == 1


def test_authorization_probing_by_one_user():
    prober = f"prober-{tag()}"
    for i in range(20):
        record_security_event("access_denied", actor_id=prober, entity_type="Route", entity_id=f"/api/admin/thing-{i}", detail={"reason": "role"})
    assert len(alerts(f"authorization_probing:user:{prober}")) == 1
    record_security_event("access_denied", actor_id=prober, entity_type="Route", entity_id="/again", detail={})
    assert len(alerts(f"authorization_probing:user:{prober}")) == 1  # once per window


def test_another_process_already_raised_it():
    prober = f"prober-{tag()}"
    for _ in range(20):
        record_security_event("access_denied", actor_id=prober, entity_type="Route", entity_id="/x", detail={})
    security_monitor.reset_dedupe()  # as a second worker: only the trail knows
    record_security_event("access_denied", actor_id=prober, entity_type="Route", entity_id="/x", detail={})
    assert len(alerts(f"authorization_probing:user:{prober}")) == 1
    assert len(SENT) == 1


def test_malware_and_a_reused_refresh_token_are_alerted_at_once():
    cand = f"cand-{tag()}"
    record_security_event("malware_rejected", actor_id="u1", entity_type="Candidate", entity_id=cand, detail={"signature": "Eicar-Test-Signature"})
    [alert] = alerts(f"malware_detected:malware_rejected:{cand}")
    assert (alert["after"]["signature"], alert["after"]["severity"]) == ("Eicar-Test-Signature", "critical")
    family = f"fam-{tag()}"
    record_security_event("refresh_token_reused", actor_id="u1", entity_type="Session", entity_id=family, detail={"used_at": "then"})
    assert len(alerts(f"refresh_token_reused:session:{family}")) == 1
    assert len(SENT) == 2


def test_a_user_made_admin(api, db):
    admin = add_user(db, Role.admin)
    promoted = add_user(db, Role.candidate)
    res = api.patch(f"/api/v1/users/{promoted.id}", headers=h(db, admin), json={"role": "admin"})
    assert res.status_code == 200, res.text
    assert res.json()["privilege_granted"] == {"from": "candidate", "to": "admin"}
    [alert] = alerts(f"privilege_granted:user:{promoted.id}")
    assert {k: alert["after"][k] for k in ("from", "to", "actor_id", "severity")} == {"from": "candidate", "to": "admin", "actor_id": admin.id, "severity": "critical"}


def test_an_unreachable_scanner(monkeypatch):
    from app.services.malware_scan import scan_bytes

    monkeypatch.setattr(settings, "CLAMD_HOST", "127.0.0.1")
    monkeypatch.setattr(settings, "CLAMD_PORT", 9)  # nothing listens
    monkeypatch.setattr(settings, "CLAMD_TIMEOUT_MS", 500)
    # Other tests leave this alert on the trail within the hour, and the
    # cross-process dedupe rightly holds it back; ask as a fresh stack.
    monkeypatch.setattr(security_monitor, "_count", lambda *_args: 0)
    assert scan_bytes(b"file").status == "unavailable"
    assert any("scanner is unreachable" in subject for _, subject, _ in SENT)


def test_no_email_without_a_mail_server(monkeypatch, caplog):
    monkeypatch.setattr(settings, "SMTP_HOST", None)
    with caplog.at_level(logging.WARNING, logger="vertex"):
        record_security_event("malware_rejected", actor_id=None, entity_type="Candidate", entity_id=f"c-{tag()}", detail={})
    assert SENT == []
    assert any(getattr(r, "event", None) == "alert.email_skipped" for r in caplog.records)


# --- a failing trail never grants access ------------------------------------------------


def test_a_denial_stays_a_denial_when_the_trail_fails(monkeypatch, caplog):
    def broken(*_args, **_kwargs):
        raise RuntimeError("audit store unavailable")

    monkeypatch.setattr(audit, "append_event", broken)
    with caplog.at_level(logging.WARNING, logger="vertex"):
        assert record_security_event("access_denied", actor_id="u1", entity_type="Route", entity_id="/x") is None
    events = {getattr(r, "event", None) for r in caplog.records}
    assert {"audit.write_failed", "alert.raised"} <= events
    assert any("Writing to the audit trail failed" in subject for _, subject, _ in SENT)


# --- POST /audit-events: the website's own records ---------------------------------------------


def website(session: dict[str, str] | None = None, request_id: str | None = None) -> dict[str, str]:
    return {"X-Vertex-Service": service_token()} | (session or {}) | ({"X-Request-ID": request_id} if request_id else {})


def test_only_the_website_records_events(api, db):
    user = add_user(db, Role.candidate)
    body = {"action": "access_denied", "entity_type": "Route", "entity_id": "/api/admin/users"}
    assert api.post("/api/v1/audit-events", json=body).status_code == 401
    assert api.post("/api/v1/audit-events", json=body, headers=h(db, user)).status_code == 401


def test_a_denial_recorded_for_the_website(api, db):
    user = add_user(db, Role.candidate)
    rid = f"r7a-{tag()}"
    body = {"action": "access_denied", "entity_type": "Route", "entity_id": "/api/admin/users",
            "detail": {"reason": "role", "ip": "203.0.113.7", "path": "/api/admin/users", "actor_id": "someone-else"}}
    res = api.post("/api/v1/audit-events", json=body, headers=website(h(db, user), rid))
    assert res.status_code == 201, res.text
    [row] = rows("request_id = :r", r=rid)
    # The actor is the session's user, whatever the body says.
    assert (row["action"], row["entity_id"], row["actor_id"], row["after"]["ip"]) == ("access_denied", "/api/admin/users", user.id, "203.0.113.7")


def test_events_without_a_user_and_what_the_website_may_record(api):
    rid = f"r7a-{tag()}"
    assert api.post("/api/v1/audit-events", headers=website(request_id=rid),
                    json={"action": "document_link_rejected", "entity_type": "Document", "entity_id": "invalid_link"}).status_code == 201
    assert rows("request_id = :r", r=rid)[0]["actor_id"] is None
    for action in ("login_succeeded", "alert_raised", "malware_rejected", "update"):
        assert api.post("/api/v1/audit-events", headers=website(), json={"action": action, "entity_type": "X"}).status_code == 422, action


def test_an_export_is_recorded_without_credentials_and_fails_closed(api, db, monkeypatch):
    user = add_user(db, Role.admin)
    rid = f"r7a-{tag()}"
    detail = {
        "rows": 1, "api_key": "k-123", "note": "postgresql://vertex_web:<DB_PASSWORD>@db:5432/vertex",
        "link": "/api/documents/file?token=" + ".".join(["eyJhbGciOiJIUzI1NiJ9", "eyJhIjoiYiJ9", "c2lnbmF0dXJl"]),
    }
    res = api.post("/api/v1/audit-events", headers=website(h(db, user), rid), json={"action": "export", "entity_type": "CandidateExport", "detail": detail})
    assert res.status_code == 201, res.text
    [row] = rows("request_id = :r", r=rid)
    assert (row["action"], row["entity_id"], row["actor_id"], row["after"]["rows"]) == ("export", "bulk", user.id, 1)
    for secret in ("k-123", "<DB_PASSWORD>", "eyJhbGciOiJIUzI1NiJ9"):
        assert secret not in str(row["after"])
    # Signed in or nothing; and unrecorded means not exported.
    assert api.post("/api/v1/audit-events", headers=website(), json={"action": "export", "entity_type": "X"}).status_code == 401

    def broken(*_args, **_kwargs):
        raise RuntimeError("audit store unavailable")

    monkeypatch.setattr("app.api.v1.audit_events.append_event", broken)
    failed = api.post("/api/v1/audit-events", headers=website(h(db, user)), json={"action": "export", "entity_type": "CandidateExport"})
    assert (failed.status_code, failed.json()["error"]["code"]) == (503, "audit_unavailable")
