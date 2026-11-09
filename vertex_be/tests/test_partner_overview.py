"""Admin → Monitoring → Partners & Logins (owner's request 2026-11-08): the
overview at the top of the page, and the two follow-up filters. A setup email
unused for 7+ days and an active login not signed in for 60+ days are found
the same way by the scheduled checks, the Security Overview and this page
(security_monitor.overdue_setups / inactive_logins). Admins only."""

from __future__ import annotations

import secrets
from datetime import timedelta

import pytest

from app.core.clock import utc_now_ms
from app.models.enums import PartnerStatus, Role
from tests.test_account_monitoring import admin, signed_in  # noqa: F401  (fixtures)
from tests.test_auth import bearer
from tests.test_partners_logins import agency, rows
from tests.test_sessions import account, api, google  # noqa: F401  (fixtures)

SUMMARY = "/api/v1/monitoring/partners/summary"


def summary(api, headers) -> dict:
    res = api.get(SUMMARY, headers=headers)
    assert res.status_code == 200, res.text
    return res.json()["data"]


def stale_and_idle(db, stamp: str):
    """An agency whose setup email is 8 days old and unused, one created now
    (not yet overdue), and one whose active login has never signed in
    in the 90 days since it was created."""
    now = utc_now_ms()
    overdue_login = account(db, role=Role.partner, password=None)
    overdue_login.created_at = now - timedelta(days=8)
    fresh_login = account(db, role=Role.partner, password=None)
    idle_login = account(db, role=Role.partner)
    idle_login.activated_at = idle_login.created_at = now - timedelta(days=90)
    db.flush()
    return (
        agency(db, f"Agency {stamp} overdue", login=overdue_login),
        agency(db, f"Agency {stamp} fresh", login=fresh_login),
        agency(db, f"Agency {stamp} idle", login=idle_login, status=PartnerStatus.active),
    )


@pytest.mark.parametrize("role", [Role.director, Role.inhouse_supervisor, Role.partner])
def test_only_admins(api, db, role):
    headers = bearer(signed_in(api, account(db, role=role))[0])
    assert api.get(SUMMARY, headers=headers).status_code == 403


def test_rows_say_what_needs_following_up(api, db, admin):
    _, headers = admin
    stamp = secrets.token_hex(3)
    overdue, fresh, idle = stale_and_idle(db, stamp)
    signed = account(db, role=Role.partner)
    active = agency(db, f"Agency {stamp} active", login=signed)
    signed_in(api, signed)

    found = rows(api, headers, q=f"Agency {stamp}")
    assert found[overdue.id]["attention"] == {"kind": "setup_overdue", "days": 8}
    assert found[fresh.id]["attention"] is None
    assert found[idle.id]["attention"]["kind"] == "inactive" and found[idle.id]["attention"]["days"] >= 60
    assert found[active.id]["attention"] is None

    assert set(rows(api, headers, q=f"Agency {stamp}", attention="setup_overdue")) == {overdue.id}
    assert set(rows(api, headers, q=f"Agency {stamp}", attention="inactive")) == {idle.id}
    assert api.get("/api/v1/monitoring/partners", headers=headers, params={"attention": "other"}).status_code == 422


def test_the_overview_counts(api, db, admin):
    _, headers = admin
    before = summary(api, headers)
    stamp = secrets.token_hex(3)
    stale_and_idle(db, stamp)
    signed = account(db, role=Role.partner)
    agency(db, f"Agency {stamp} active", login=signed, status=PartnerStatus.active)
    signed_in(api, signed)
    agency(db, f"Agency {stamp} bare", status=PartnerStatus.suspended)

    after = summary(api, headers)
    delta = lambda *path: _at(after, path) - _at(before, path)  # noqa: E731
    assert delta("agencies") == 5
    assert (delta("agencies_by_status", "pending"), delta("agencies_by_status", "active"), delta("agencies_by_status", "suspended")) == (2, 2, 1)
    assert delta("logins_by_status", "setup_pending") == 2
    assert delta("logins_by_status", "active") == 2
    assert delta("logins_by_status", "no_login") == 1
    assert (delta("attention", "setup_overdue"), delta("attention", "inactive")) == (1, 1)
    assert delta("new_agencies", "last_7d") == 5
    assert delta("signed_in_last_30d") == 1


def _at(data: dict, path: tuple) -> int:
    for key in path:
        data = data[key]
    return data


def test_the_security_overview_counts_inactive_accounts(api, db, admin):
    _, headers = admin
    before = api.get("/api/v1/monitoring/overview", headers=headers).json()["data"]
    stale_and_idle(db, secrets.token_hex(3))
    idle_staff = account(db, role=Role.hr)
    idle_staff.activated_at = idle_staff.created_at = utc_now_ms() - timedelta(days=61)
    db.flush()
    after = api.get("/api/v1/monitoring/overview", headers=headers).json()["data"]
    assert after["accounts_inactive"] - before["accounts_inactive"] == 2  # the idle partner login and the staff one
    assert after["partner_logins_not_activated"] - before["partner_logins_not_activated"] == 1
