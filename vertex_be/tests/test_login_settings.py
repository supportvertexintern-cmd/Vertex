"""Login protection, PR 6 (G7, 3.3, 4.5): the thresholds an admin may change.
The defaults until saved; values outside their range refused (422), never
clamped; a reason with every save; the change on the trail with who, why,
before and after, which the page's history shows; and each setting taking
effect: the failures that lock, the cooldowns, the notice, the per-email
limit and the website's per-address sign-in limit."""

from __future__ import annotations

from datetime import timedelta

import pytest
from sqlalchemy import select

from app.models.audit import AuditLog
from app.models.enums import Role
from app.services import login_settings
from tests.test_account_monitoring import admin, signed_in  # noqa: F401  (fixtures)
from tests.test_auth import bearer
from tests.test_login_protection import fail, lockouts
from tests.test_sessions import account, api, google, sign_in, svc  # noqa: F401  (fixtures)

URL = "/api/v1/monitoring/settings/login-protection"


def values(**changes) -> dict:
    return login_settings.DEFAULTS.as_dict() | changes


def save(api, headers, reason="Tuning after a week of data", **changes):
    return api.put(URL, headers={**headers, **svc()}, json=values(**changes) | {"reason": reason})


@pytest.mark.parametrize("role", [Role.director, Role.inhouse_supervisor, Role.partner])
def test_only_admins(api, db, role):
    headers = bearer(signed_in(api, account(db, role=role))[0])
    assert api.get(URL, headers=headers).status_code == 403
    assert save(api, headers).status_code == 403


def test_only_the_website_reads_its_limit(api, db):
    assert api.get("/api/v1/login-protection").status_code in (401, 403)
    assert api.get("/api/v1/login-protection", headers=svc()).json()["data"] == {"ip_login_max_per_minute": 10}


def test_the_defaults_and_their_ranges(api, db, admin):
    _, headers = admin
    page = api.get(URL, headers=headers).json()["data"]
    assert page["values"] == page["defaults"] == {
        "account_max_failures": 10, "account_window_minutes": 15, "cooldown_steps_minutes": [15, 60, 240, 1440],
        "ip_login_max_per_minute": 10, "reset_per_email_hour": 3, "reset_per_email_day": 6, "lockout_notice_enabled": True,
    }
    assert page["bounds"]["account_max_failures"] == [5, 20] and page["bounds"]["cooldown_steps_minutes"] == [5, 1440]


@pytest.mark.parametrize("changes, field", [
    ({"account_max_failures": 4}, "account_max_failures"),
    ({"account_max_failures": 21}, "account_max_failures"),
    ({"account_window_minutes": 61}, "account_window_minutes"),
    ({"cooldown_steps_minutes": [15, 15, 240, 1440]}, "cooldown_steps_minutes"),
    ({"cooldown_steps_minutes": [15, 60, 240]}, "cooldown_steps_minutes"),
    ({"cooldown_steps_minutes": [1, 60, 240, 1440]}, "cooldown_steps_minutes"),
    ({"ip_login_max_per_minute": 61}, "ip_login_max_per_minute"),
    ({"reset_per_email_hour": 0}, "reset_per_email_hour"),
    ({"reset_per_email_hour": 5, "reset_per_email_day": 4}, "reset_per_email_day"),
])
def test_out_of_range_is_refused_never_clamped(api, db, admin, changes, field):
    _, headers = admin
    res = save(api, headers, **changes)
    assert res.status_code == 422 and field in res.json()["error"]["details"], res.text
    assert api.get(URL, headers=headers).json()["data"]["values"] == login_settings.DEFAULTS.as_dict()


def test_a_save_needs_a_reason_and_is_on_the_trail(api, db, admin):
    me, headers = admin
    assert save(api, headers, reason="").status_code == 422
    res = save(api, headers, account_max_failures=8)
    assert res.status_code == 200
    page = res.json()["data"]
    assert page["values"]["account_max_failures"] == 8
    latest = page["history"][0]
    assert (latest["by"]["id"], latest["reason"]) == (me.id, "Tuning after a week of data")
    assert latest["before"]["account_max_failures"] == 10 and latest["after"]["account_max_failures"] == 8
    change = db.scalar(select(AuditLog).where(AuditLog.entity_type == "SystemSetting", AuditLog.entity_id == "login_protection"))
    assert change is not None and change.actor_id == me.id
    # Back to the defaults is a save like any other.
    assert save(api, headers, reason="Back to the defaults").json()["data"]["values"] == login_settings.DEFAULTS.as_dict()


def test_fewer_failures_and_a_longer_first_cooldown_take_effect(api, db, admin):
    _, headers = admin
    assert save(api, headers, account_max_failures=5, cooldown_steps_minutes=[30, 60, 240, 1440]).status_code == 200
    user = account(db, role=Role.hr)
    fail(api, user.email, 5)
    assert sign_in(api, user).status_code == 429
    [row] = lockouts(db, user.email)
    assert row.failures == 5 and row.locked_until - row.locked_at == timedelta(minutes=30)
    assert "30 minutes" in sign_in(api, user).json()["error"]["message"]


def test_the_notice_can_be_turned_off_here(api, db, admin, sent_mail):
    _, headers = admin
    assert save(api, headers, lockout_notice_enabled=False).status_code == 200
    fail(api, account(db, role=Role.hr).email)
    assert [m for m in sent_mail if m.kind == "account_locked"] == []


def test_the_per_email_limit_follows_the_setting(api, db, admin, sent_mail):
    _, headers = admin
    assert save(api, headers, reset_per_email_hour=1, reset_per_email_day=2).status_code == 200
    user = account(db, role=Role.hr)
    for i in range(2):
        api.post("/api/v1/accounts/forgot-password", headers={**svc(), "X-Forwarded-For": f"198.51.100.{i}"}, json={"email": user.email})
    assert sum(1 for m in sent_mail if m.kind == "password_reset" and m.to == user.email) == 1


def test_the_website_gets_its_new_limit(api, db, admin):
    _, headers = admin
    assert save(api, headers, ip_login_max_per_minute=20).status_code == 200
    assert api.get("/api/v1/login-protection", headers=svc()).json()["data"] == {"ip_login_max_per_minute": 20}


def test_an_unreadable_setting_means_the_defaults(db):
    from app.models.reference import SystemSetting

    db.add(SystemSetting(key="login_protection", value='{"account_max_failures": 999}'))
    db.flush()
    login_settings.forget()
    assert login_settings.current(db) == login_settings.DEFAULTS
