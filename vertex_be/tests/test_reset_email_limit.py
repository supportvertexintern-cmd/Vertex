"""Login protection, PR 2 (G3): one email address gets at most 3 password-
reset or setup emails an hour and 6 a day, from any network address. A
visitor is told nothing new; an admin resending is told why. Each refusal is
reset_rate_limited; 10 in an hour for one address raise reset_email_flood.
app/services/email_limit.py."""

from __future__ import annotations

import logging
import secrets
from types import SimpleNamespace

from app.models.enums import Role
from app.services import email_limit, security_monitor
from app.services.sessions import email_fingerprint
from tests.test_account_limit_store import FakeRedis
from tests.test_account_monitoring import admin  # noqa: F401  (fixtures)
from tests.test_partner_activation import partner_login
from tests.test_sessions import account, api, events, google, svc  # noqa: F401  (fixtures)
from tests.test_suspicious_activity import committed

FORGOT = "/api/v1/accounts/forgot-password"


def forgot(api, email: str, ip: str):
    res = api.post(FORGOT, headers={**svc(), "X-Forwarded-For": ip}, json={"email": email})
    assert res.status_code == 200, res.text
    return res.json()["data"]["message"]


def resets(sent_mail, email: str) -> int:
    return sum(1 for m in sent_mail if m.kind == "password_reset" and m.to == email)


def test_a_fourth_reset_in_an_hour_from_another_network_sends_nothing_and_says_nothing(api, db, sent_mail, caplog):
    user = account(db, role=Role.hr)
    with caplog.at_level(logging.INFO, logger="vertex"):
        answers = [forgot(api, user.email, f"198.51.100.{i}") for i in range(4)]
    assert len(set(answers)) == 1  # the same answer every time
    assert resets(sent_mail, user.email) == 3
    [refused] = events(caplog, "reset_rate_limited")
    assert refused["email_fp"] == email_fingerprint(user.email) and refused["kind"] == "password_reset"
    requested = events(caplog, "password_reset_requested")
    assert [r["email_sent"] for r in requested] == [True, True, True, False] and requested[-1]["refused"] == "email_limit"


def test_six_a_day(api, db, sent_mail, monkeypatch):
    clock = [1000.0]
    monkeypatch.setattr(email_limit, "time", SimpleNamespace(monotonic=lambda: clock[0]))
    user = account(db, role=Role.hr)
    for _ in range(3):
        forgot(api, user.email, "198.51.100.1")
    clock[0] += 3601  # a new hour
    for _ in range(4):
        forgot(api, user.email, "198.51.100.1")
    assert resets(sent_mail, user.email) == 6
    clock[0] += 3601  # another hour: still the same day
    forgot(api, user.email, "198.51.100.1")
    assert resets(sent_mail, user.email) == 6
    clock[0] += 24 * 3600  # the next day
    forgot(api, user.email, "198.51.100.1")
    assert resets(sent_mail, user.email) == 7


def test_an_address_without_an_account_isnt_counted(api, db, sent_mail, caplog):
    nobody = f"nobody-{secrets.token_hex(4)}@test.invalid"
    with caplog.at_level(logging.INFO, logger="vertex"):
        for i in range(5):
            forgot(api, nobody, f"198.51.100.{i}")
    assert events(caplog, "reset_rate_limited") == [] and sent_mail == []


def test_an_admin_resending_a_setup_email_is_told_why(api, db, admin, sent_mail):
    _, headers = admin
    fresh = account(db, role=Role.hr, password=None)
    codes = [api.post(f"/api/v1/users/{fresh.id}/setup-email", headers=headers).status_code for _ in range(4)]
    assert codes == [200, 200, 200, 429]
    res = api.post(f"/api/v1/users/{fresh.id}/setup-email", headers=headers)
    assert res.json()["error"]["code"] == "email_limited" and "3 an hour" in res.json()["error"]["message"]
    assert sum(1 for m in sent_mail if m.kind == "account_setup") == 3


def test_resets_and_setup_emails_share_the_limit(api, db, admin, sent_mail):
    _, headers = admin
    login, agency = partner_login(db)
    for i in range(3):
        forgot(api, login.email, f"198.51.100.{i}")
    res = api.post(f"/api/v1/partners/{agency.id}/reset-password", headers=headers)
    assert res.status_code == 429
    db.refresh(login)
    assert login.password_hash  # refused before the password was cleared


def test_ten_refusals_in_an_hour_raise_reset_email_flood(api, db):
    user = account(db, role=Role.hr)
    security_monitor.reset_dedupe()
    for i in range(13):  # 3 sent, then 10 refused
        forgot(api, user.email, f"198.51.100.{i}")
    [alert] = committed("alert_key = :k", k=f"reset_email_flood:email:{email_fingerprint(user.email)}")
    assert alert["severity"] == "medium" and alert["detail"]["refused"] == 10 and alert["detail"]["user_id"] == user.id


def test_redis_down_sends_nothing(api, db, sent_mail, monkeypatch, caplog):
    monkeypatch.setattr(email_limit, "counter_store", lambda: FakeRedis({}, down=True))
    user = account(db, role=Role.hr)
    with caplog.at_level(logging.ERROR, logger="vertex"):
        forgot(api, user.email, "198.51.100.1")
    assert resets(sent_mail, user.email) == 0
    assert any(getattr(r, "event", None) == "ratelimit.store_unavailable" for r in caplog.records)
