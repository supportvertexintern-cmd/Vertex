"""Retention (decision D3, interim pending legal, 2026-11-08; exceptions.md
E11): security alerts older than SECURITY_RETENTION_MONTHS (12) are deleted
by the daily clean-up, each delete on the trail; the monitoring pages stop
showing sign-in history older than that. The trail itself is never changed."""

from __future__ import annotations

import secrets
from datetime import timedelta

from sqlalchemy import insert, text

from app.core.clock import utc_now_ms
from app.core.config import settings
from app.db.base import new_id
from app.db.session import engine
from app.models.audit import AuditLog
from app.models.enums import Role
from app.models.security import SecurityAlert
from app.services import security_monitor
from tests.test_account_monitoring import ACCOUNTS, admin  # noqa: F401  (fixtures)
from tests.test_sessions import account, api, google  # noqa: F401  (fixtures)
from tests.test_suspicious_activity import committed


def old_alert(days: int) -> str:
    key = f"retention-test:{secrets.token_hex(6)}"
    with engine.begin() as conn:
        conn.execute(insert(SecurityAlert.__table__).values(
            id=new_id(), rule="inactive_account", alert_key=key, severity="medium", summary="test", status="open",
            created_at=utc_now_ms() - timedelta(days=days),
        ))
    return key


def test_the_default_is_twelve_months():
    assert settings.SECURITY_RETENTION_MONTHS == 12
    assert abs((utc_now_ms() - security_monitor.retention_cutoff()) - timedelta(days=365)) < timedelta(days=1)


def test_the_clean_up_deletes_alerts_past_the_window_and_records_each_delete():
    gone, kept = old_alert(400), old_alert(300)
    assert security_monitor.run_retention() >= 1
    assert committed("alert_key = :k", k=gone) == []
    [young] = committed("alert_key = :k", k=kept)
    with engine.connect() as conn:
        deletes = conn.execute(text('SELECT actor_id FROM "AuditLog" WHERE entity_type = \'SecurityAlert\' AND action = \'delete\' '
                                    "AND before ->> 'alert_key' = :k"), {"k": gone}).all()
    assert [d.actor_id for d in deletes] == [None]  # the system's, on the trail
    # tidy: the young one goes too, the same way
    with engine.begin() as conn:
        conn.execute(text('UPDATE "SecurityAlert" SET created_at = created_at - interval \'200 days\' WHERE id = :i'), {"i": young["id"]})
    security_monitor.run_retention()
    assert committed("alert_key = :k", k=kept) == []


def test_a_shorter_setting_shortens_the_window(monkeypatch):
    key = old_alert(40)
    monkeypatch.setattr(settings, "SECURITY_RETENTION_MONTHS", 1)
    security_monitor.run_retention()
    assert committed("alert_key = :k", k=key) == []


def test_sign_in_history_past_the_window_is_not_shown_and_the_trail_keeps_it(api, db, admin):
    _, headers = admin
    user = account(db, role=Role.hr)
    then = utc_now_ms() - timedelta(days=400)
    with engine.begin() as conn:
        conn.execute(insert(AuditLog.__table__).values(
            id=new_id(), entity_type="Auth", entity_id=f"user:{user.id}", action="login_succeeded", actor_id=user.id,
            after={"method": "password", "ip": "198.51.100.77"}, created_at=then,
        ))
    detail = api.get(f"{ACCOUNTS}/{user.id}", headers=headers).json()["data"]
    assert detail["sign_ins"] == [] and detail["last_sign_in_at"] is None
    with engine.connect() as conn:
        assert conn.execute(text('SELECT count(*) FROM "AuditLog" WHERE entity_id = :e'), {"e": f"user:{user.id}"}).scalar() >= 1


def test_the_overview_says_how_long(api, db, admin):
    _, headers = admin
    assert api.get("/api/v1/monitoring/overview", headers=headers).json()["data"]["retention_months"] == 12
