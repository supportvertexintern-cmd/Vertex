"""The owner's additions to admin monitoring (2026-11-07):

- the country of an address, from the bundled DB-IP database, on sign-ins
  and the pages, and an alert for a sign-in from a country the account
  never signed in from (flag only, D4);
- Locked Accounts: the accounts the per-account sign-in limit holds, and an
  admin's unlock, recorded;
- script-like activity: an account reading, writing or signing in faster
  than a person would.
"""

from __future__ import annotations

import secrets

import pytest

from app.core.config import settings
from app.models.enums import Role
from app.services import activity, geoip, security_monitor
from app.services.security_monitor import Rule
from app.services.sessions import email_fingerprint
from tests.test_account_monitoring import ACCOUNTS, admin, signed_in, trail  # noqa: F401  (fixtures)
from tests.test_auth import bearer
from tests.test_sessions import PASSWORD, account, api, google, svc  # noqa: F401  (fixtures)
from tests.test_suspicious_activity import committed

LOCKED = "/api/v1/monitoring/locked"
COUNTRIES = {"41.90.0.1": "KE", "41.90.0.2": "KE", "196.188.0.1": "ET", "102.0.0.9": "NG"}


@pytest.fixture(autouse=True)
def quiet(monkeypatch):
    monkeypatch.setattr(settings, "SMTP_HOST", None)
    monkeypatch.setattr(security_monitor, "dispatch", lambda send: send())
    security_monitor.reset_dedupe()
    activity.reset()


@pytest.fixture
def places(monkeypatch):
    """A stand-in for the bundled database: these addresses, these countries."""
    monkeypatch.setattr(geoip, "country_of", lambda ip: COUNTRIES.get(ip or ""))


def sign_in_from(api, user, ip, password=PASSWORD):
    return api.post("/api/v1/auth/login", headers={**svc(), "X-Forwarded-For": ip}, json={"email": user.email, "password": password})


# --- the country database ------------------------------------------------------------


def test_without_the_database_every_country_is_unknown(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "GEOIP_DIR", str(tmp_path))
    monkeypatch.setattr(geoip, "_loaded", False)
    monkeypatch.setattr(geoip, "_reader", None)
    assert geoip.country_of("8.8.8.8") is None and geoip.database_month() is None


def test_private_and_malformed_addresses_have_no_country(monkeypatch):
    class Reader:
        def get(self, _ip):
            return {"country": {"iso_code": "US"}}

    monkeypatch.setattr(geoip, "_open", lambda: Reader())
    assert geoip.country_of("8.8.8.8") == "US"
    for ip in ("10.0.0.1", "127.0.0.1", "192.168.1.4", "not-an-ip", "", None):
        assert geoip.country_of(ip) is None, ip


def test_a_sign_in_records_its_country_and_the_pages_show_it(api, db, admin, places):
    _, headers = admin
    user = account(db, role=Role.hr)
    assert sign_in_from(api, user, "41.90.0.1").status_code == 200
    [event] = trail("action = 'login_succeeded' AND entity_id = :e", e=f"user:{user.id}")
    assert event["after"]["country"] == "KE"
    detail = api.get(f"{ACCOUNTS}/{user.id}", headers=headers).json()["data"]
    assert detail["last_sign_in_country"] == "KE" and detail["sign_ins"][0]["country"] == "KE"


# --- sign-in from a new country -----------------------------------------------------------


def test_a_new_country_is_flagged_once_and_the_first_one_sets_the_baseline(api, db, places):
    user = account(db, role=Role.partner)
    key = f"sign_in_new_country:user:{user.id}"
    assert sign_in_from(api, user, "41.90.0.1").status_code == 200  # the first: the baseline
    assert sign_in_from(api, user, "41.90.0.2").status_code == 200  # another address, same country
    assert committed("alert_key LIKE :k", k=f"{key}%") == []
    assert sign_in_from(api, user, "196.188.0.1").status_code == 200  # Ethiopia: new
    [row] = committed("alert_key LIKE :k", k=f"{key}%")
    assert (row["severity"], row["ip"], row["detail"]["country"], row["detail"]["known_countries"]) == ("high", "196.188.0.1", "ET", ["KE"])
    assert sign_in_from(api, user, "196.188.0.1").status_code == 200  # not twice
    assert len(committed("alert_key LIKE :k", k=f"{key}%")) == 1


def test_an_unknown_country_is_never_flagged(api, db, places):
    user = account(db, role=Role.hr)
    assert sign_in_from(api, user, "41.90.0.1").status_code == 200
    assert sign_in_from(api, user, "203.0.113.50").status_code == 200  # not in the database
    assert committed("alert_key LIKE :k", k=f"sign_in_new_country:user:{user.id}%") == []


# --- locked accounts ------------------------------------------------------------------------


def lock(api, user):
    for _ in range(10):
        assert sign_in_from(api, user, "198.51.100.40", "Wrong-Password-1").status_code == 401
    assert sign_in_from(api, user, "198.51.100.40").status_code == 429  # held, even with the right password


def test_a_locked_account_is_listed_and_an_admin_unlocks_it(api, db, admin):
    me, headers = admin
    user = account(db, role=Role.partner)
    lock(api, user)
    fp = email_fingerprint(user.email)
    [row] = [r for r in api.get(LOCKED, headers=headers).json()["data"] if r["email_fp"] == fp]
    assert row["failures"] == 10 and 0 < row["unlocks_in_seconds"] <= 15 * 60 and row["account"]["id"] == user.id
    detail = api.get(f"{ACCOUNTS}/{user.id}", headers=headers).json()["data"]
    assert detail["locked"] is True and detail["email_fp"] == fp

    res = api.post(f"{LOCKED}/{fp}/unlock", headers={**headers, **svc()}, json={"reason": "Called the partner; it was them"})
    assert res.json()["data"] == {"email_fp": fp, "unlocked": True, "reset_sent": False, "reset_refused": None}
    assert sign_in_from(api, user, "198.51.100.40").status_code == 200
    assert fp not in {r["email_fp"] for r in api.get(LOCKED, headers=headers).json()["data"]}
    [event] = trail("action = 'login_unlocked' AND entity_id = :e", e=f"user:{user.id}")
    assert event["actor_id"] == me.id and event["after"]["was_locked"] is True
    assert event["after"]["reason"] == "Called the partner; it was them"
    # unlocking what isn't locked says so
    assert api.post(f"{LOCKED}/{fp}/unlock", headers=headers, json={"reason": "again"}).json()["data"]["unlocked"] is False


def test_locked_accounts_are_for_admins_only(api, db):
    headers = bearer(signed_in(api, account(db, role=Role.director))[0])
    assert api.get(LOCKED, headers=headers).status_code == 403
    assert api.post(f"{LOCKED}/{'a' * 16}/unlock", headers=headers, json={"reason": "why not"}).status_code == 403


def test_an_unlock_needs_a_fingerprint(api, db, admin):
    _, headers = admin
    assert api.post(f"{LOCKED}/not-a-fingerprint/unlock", headers=headers, json={"reason": "a reason"}).status_code == 422


def test_the_overview_counts_locked_accounts(api, db, admin):
    _, headers = admin
    before = api.get("/api/v1/monitoring/overview", headers=headers).json()["data"]["locked_accounts"]
    lock(api, account(db, role=Role.hr))
    assert api.get("/api/v1/monitoring/overview", headers=headers).json()["data"]["locked_accounts"] == before + 1


# --- script-like activity ----------------------------------------------------------------------


def test_reading_faster_than_a_person_is_flagged_once(api, db, monkeypatch):
    monkeypatch.setattr(security_monitor, "UNUSUAL_READS", Rule("unusual_read_rate", "medium", 5, 4))
    user = account(db, role=Role.hr)
    headers = bearer(signed_in(api, user)[0])
    for _ in range(6):
        assert api.get("/api/v1/auth/sessions", headers=headers).status_code == 200
    [row] = committed("alert_key = :k", k=f"unusual_read_rate:user:{user.id}")
    assert row["detail"]["count"] == 4 and row["severity"] == "medium"


def test_writing_faster_than_a_person_is_flagged(api, db, monkeypatch):
    monkeypatch.setattr(security_monitor, "UNUSUAL_WRITES", Rule("unusual_write_rate", "high", 5, 3))
    user = account(db, role=Role.hr)
    headers = bearer(signed_in(api, user)[0])
    for _ in range(3):
        api.delete("/api/v1/auth/sessions/not-a-session", headers=headers)  # a write, refused or not
    assert len(committed("alert_key = :k", k=f"unusual_write_rate:user:{user.id}")) == 1


def test_signing_in_again_and_again_is_flagged(api, db, monkeypatch):
    monkeypatch.setattr(security_monitor, "RAPID_SIGN_INS", Rule("rapid_sign_ins", "medium", 10, 3))
    user = account(db, role=Role.partner)
    ip = f"198.51.100.{secrets.randbelow(200)}"
    for _ in range(3):
        assert sign_in_from(api, user, ip).status_code == 200
    assert len(committed("alert_key = :k", k=f"rapid_sign_ins:user:{user.id}")) == 1


def test_people_at_a_normal_pace_raise_nothing(api, db):
    user = account(db, role=Role.hr)
    headers = bearer(signed_in(api, user)[0])
    for _ in range(20):
        api.get("/api/v1/auth/sessions", headers=headers)
    assert committed("alert_key = :k", k=f"unusual_read_rate:user:{user.id}") == []
