"""Admin → Monitoring, phase 2 (owner's requirements 2026-11-07, migration
0013): Suspicious Activity. Every alert the monitor raises is a row as well
as an email; admins review it (open → reviewing → resolved or dismissed,
with a note), each change audited; an account's unreviewed alerts are its
flags in User Accounts. Admins only."""

from __future__ import annotations

import importlib.util
import secrets
from pathlib import Path

import pytest
from sqlalchemy import insert, select, text

from app.core.audit import record_security_event, set_audit_actor
from app.core.config import settings
from app.db.session import engine
from app.models.audit import AuditLog
from app.models.enums import Role, SecurityAlertSeverity, SecurityAlertStatus
from app.models.security import SecurityAlert
from app.services import security_monitor
from tests.test_account_monitoring import ACCOUNTS, admin, deactivate, signed_in  # noqa: F401  (fixtures)
from tests.test_auth import bearer
from tests.test_sessions import account, api, google  # noqa: F401  (fixtures)

ALERTS = "/api/v1/monitoring/alerts"


@pytest.fixture(autouse=True)
def quiet(monkeypatch):
    monkeypatch.setattr(settings, "SMTP_HOST", None)  # no email for these
    monkeypatch.setattr(security_monitor, "dispatch", lambda send: send())
    security_monitor.reset_dedupe()


def committed(where: str, **params) -> list[dict]:
    with engine.connect() as conn:
        return [dict(r._mapping) for r in conn.execute(text(f'SELECT * FROM "SecurityAlert" WHERE {where}'), params)]


def alert(db, user=None, *, severity=SecurityAlertSeverity.high, rule="brute_force_account", status=SecurityAlertStatus.open) -> SecurityAlert:
    """An alert as the monitor would have written it, in the test's transaction."""
    row = SecurityAlert(
        rule=rule, alert_key=f"{rule}:{secrets.token_hex(4)}", severity=severity, summary="10 failed sign-ins for one account in 15 minutes",
        user_id=user.id if user else None, ip="198.51.100.4", detail={"failures": 10}, status=status,
    )
    set_audit_actor(db, None)
    db.add(row)
    db.flush()
    return row


# --- the monitor writes rows --------------------------------------------------------


def test_every_raised_alert_is_a_row_too():
    prober = f"prober-{secrets.token_hex(4)}"
    for _ in range(20):
        record_security_event("access_denied", actor_id=prober, entity_type="Route", entity_id="/x", detail={})
    [row] = committed("alert_key = :k", k=f"authorization_probing:user:{prober}")
    assert (row["rule"], row["severity"], row["status"]) == ("authorization_probing", "high", "open")
    assert row["summary"] == "20 denied requests by one user in 10 minutes"
    assert row["user_id"] is None  # "prober-…" is no account
    # once per window, as the email
    record_security_event("access_denied", actor_id=prober, entity_type="Route", entity_id="/x", detail={})
    assert len(committed("alert_key = :k", k=f"authorization_probing:user:{prober}")) == 1


def test_a_brute_force_alert_names_the_account_and_the_address(db):
    user = account(db, role=Role.hr)
    row = security_monitor._alert_row(
        security_monitor.BRUTE_FORCE_ACCOUNT, "brute_force_account:account:fp", "10 failed sign-ins",
        {"email_fp": "fp", "failures": 10, "last_ip": "198.51.100.7", "user_id": user.id},
    )
    db.execute(insert(SecurityAlert.__table__).values(row))
    saved = db.get(SecurityAlert, row["id"])
    assert (saved.user_id, saved.ip, saved.severity) == (user.id, "198.51.100.7", SecurityAlertSeverity.high)


def test_an_account_that_is_gone_is_left_out_not_a_failed_alert(db):
    row = security_monitor._alert_row(security_monitor.REFRESH_TOKEN_REUSED, "refresh_token_reused:session:x", "reused", {"actor_id": "c-gone"})
    db.execute(insert(SecurityAlert.__table__).values(row))
    assert db.get(SecurityAlert, row["id"]).user_id is None


# --- who may ---------------------------------------------------------------------------


@pytest.mark.parametrize("role", [Role.director, Role.hr, Role.partner])
def test_only_admins(api, db, role):
    headers = bearer(signed_in(api, account(db, role=role))[0])
    item = alert(db)
    assert api.get(ALERTS, headers=headers).status_code == 403
    assert api.get(f"{ALERTS}/summary", headers=headers).status_code == 403
    assert api.get(f"{ALERTS}/rules", headers=headers).status_code == 403
    assert api.patch(f"{ALERTS}/{item.id}", headers=headers, json={"status": "reviewing"}).status_code == 403


# --- the list --------------------------------------------------------------------------


def test_the_list_filters_and_names_the_account(api, db, admin):
    _, headers = admin
    user = account(db, role=Role.partner)
    rule = f"test_rule_{secrets.token_hex(3)}"
    critical = alert(db, user, severity=SecurityAlertSeverity.critical, rule=rule)
    reviewing = alert(db, user, rule=rule, status=SecurityAlertStatus.reviewing)
    closed = alert(db, rule=rule, status=SecurityAlertStatus.dismissed)

    def ids(**params):
        res = api.get(ALERTS, headers=headers, params={"rule": rule, "pageSize": 100, **params})
        assert res.status_code == 200, res.text
        return {r["id"]: r for r in res.json()["data"]}

    everything = ids()
    assert set(everything) == {critical.id, reviewing.id, closed.id}
    assert everything[critical.id]["account"] == {"id": user.id, "full_name": user.full_name, "email": user.email, "role": "partner", "deactivated": False}
    assert everything[closed.id]["account"] is None
    assert set(ids(status=["open", "reviewing"])) == {critical.id, reviewing.id}
    assert set(ids(severity="critical")) == {critical.id}
    assert set(ids(user_id=user.id)) == {critical.id, reviewing.id}
    assert rule in api.get(f"{ALERTS}/rules", headers=headers).json()["data"]


def test_the_summary_counts_what_is_unreviewed(api, db, admin):
    _, headers = admin
    before = api.get(f"{ALERTS}/summary", headers=headers).json()["data"]
    alert(db, severity=SecurityAlertSeverity.critical)
    alert(db)
    alert(db, status=SecurityAlertStatus.reviewing)
    alert(db, status=SecurityAlertStatus.resolved)
    after = api.get(f"{ALERTS}/summary", headers=headers).json()["data"]
    assert after["open"] - before["open"] == 2 and after["reviewing"] - before["reviewing"] == 1
    assert after["open_by_severity"]["critical"] - before["open_by_severity"]["critical"] == 1


# --- review --------------------------------------------------------------------------------


def test_review_open_reviewing_resolved_with_who_when_and_the_note_on_the_trail(api, db, admin):
    me, headers = admin
    item = alert(db)
    res = api.patch(f"{ALERTS}/{item.id}", headers=headers, json={"status": "reviewing"})
    assert res.status_code == 200, res.text
    assert res.json()["data"]["reviewed_by"] == {"id": me.id, "full_name": "Monitoring Admin"}
    res = api.patch(f"{ALERTS}/{item.id}", headers=headers, json={"status": "resolved", "note": "Password reset with the user; it was them."})
    data = res.json()["data"]
    assert (data["status"], data["note"]) == ("resolved", "Password reset with the user; it was them.") and data["reviewed_at"]
    changes = db.scalars(select(AuditLog).where(AuditLog.entity_type == "SecurityAlert", AuditLog.entity_id == item.id, AuditLog.action == "update")
                         .order_by(AuditLog.created_at, AuditLog.id)).all()
    assert [(c.actor_id, c.after["status"]) for c in changes] == [(me.id, "reviewing"), (me.id, "resolved")]
    assert changes[-1].after["note"] == "Password reset with the user; it was them."


def test_closing_needs_a_note_and_open_is_never_a_target(api, db, admin):
    _, headers = admin
    item = alert(db)
    for body in ({"status": "dismissed"}, {"status": "resolved", "note": "  "}, {"status": "dismissed", "note": "ok"}):
        res = api.patch(f"{ALERTS}/{item.id}", headers=headers, json=body)
        assert (res.status_code, res.json()["error"]["code"]) == (422, "note_required"), body
    assert api.patch(f"{ALERTS}/{item.id}", headers=headers, json={"status": "open"}).status_code == 409  # already open
    assert api.patch(f"{ALERTS}/{item.id}", headers=headers, json={"status": "dismissed", "note": "A test login, not an attack."}).status_code == 200
    assert api.patch(f"{ALERTS}/{item.id}", headers=headers, json={"status": "open"}).json()["error"]["code"] == "invalid_transition"
    # reopening a closed one: back to reviewing, with a note
    assert api.patch(f"{ALERTS}/{item.id}", headers=headers, json={"status": "reviewing"}).json()["error"]["code"] == "note_required"
    assert api.patch(f"{ALERTS}/{item.id}", headers=headers, json={"status": "reviewing", "note": "Seen again from the same address."}).status_code == 200
    assert api.patch(f"{ALERTS}/c{'0' * 24}", headers=headers, json={"status": "reviewing"}).status_code == 404


# --- flags in User Accounts ------------------------------------------------------------------


def test_an_accounts_unreviewed_alerts_are_its_flags(api, db, admin):
    _, headers = admin
    stamp = secrets.token_hex(3)
    flagged = account(db, role=Role.partner)
    flagged.full_name = f"Flag {stamp} yes"
    clean = account(db, role=Role.partner)
    clean.full_name = f"Flag {stamp} no"
    db.flush()
    alert(db, flagged)
    alert(db, flagged, status=SecurityAlertStatus.reviewing)
    alert(db, flagged, status=SecurityAlertStatus.dismissed)
    alert(db, clean, status=SecurityAlertStatus.resolved)
    rows = {r["id"]: r for r in api.get(ACCOUNTS, headers=headers, params={"q": f"Flag {stamp}"}).json()["data"]}
    assert (rows[flagged.id]["open_alerts"], rows[clean.id]["open_alerts"]) == (2, 0)
    only = api.get(ACCOUNTS, headers=headers, params={"q": f"Flag {stamp}", "flagged": "true"}).json()["data"]
    assert [r["id"] for r in only] == [flagged.id]


def test_the_account_can_be_deactivated_from_its_alert(api, db, admin):
    # The page's "Deactivate account" calls the phase 1 route with the alert's account.
    _, headers = admin
    user = account(db, role=Role.hr)
    item = alert(db, user)
    assert deactivate(api, headers, user.id, "Brute force from an unknown address").status_code == 200
    row = api.get(ALERTS, headers=headers, params={"user_id": user.id}).json()["data"][0]
    assert row["id"] == item.id and row["account"]["deactivated"] is True


# --- the migration ------------------------------------------------------------------------------


def test_the_migration_copies_the_trails_alerts_in(db):
    spec = importlib.util.spec_from_file_location("m0013", Path(__file__).parents[1] / "alembic/versions/20261107_0013_security_alerts.py")
    m0013 = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m0013)
    user = account(db, role=Role.hr)
    key = f"refresh_token_reused:session:{secrets.token_hex(4)}"
    db.add(AuditLog(entity_type="SecurityAlert", entity_id=key, action="alert_raised", actor_id=None,
                    after={"rule": "refresh_token_reused", "severity": "high", "summary": "A spent refresh token was used again", "actor_id": user.id}))
    db.flush()
    db.execute(text(f'DELETE FROM "SecurityAlert" WHERE alert_key = :k'), {"k": key})
    db.execute(text(m0013.BACKFILL + " AND a.entity_id = :k"), {"k": key})
    [row] = db.scalars(select(SecurityAlert).where(SecurityAlert.alert_key == key)).all()
    assert (row.rule, row.severity, row.status, row.user_id) == ("refresh_token_reused", SecurityAlertSeverity.high, SecurityAlertStatus.open, user.id)
