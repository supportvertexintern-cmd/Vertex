"""Login protection, PR 4 (4.2, 4.4, 4.6): Sign-in Activity and Reset Email
Activity, read from the trail through the functions of migration 0020; the
flooding flag; an admin's manual resend, which no limit counts; and the
account drawer's emails. Admins only; reading either page is recorded."""

from __future__ import annotations

import logging
import secrets

import pytest

from app.core.audit import record_security_event
from app.core.clock import utc_now_ms
from app.models.enums import Role
from app.services.sessions import email_fingerprint
from tests.test_account_monitoring import admin, signed_in  # noqa: F401  (fixtures)
from tests.test_auth import bearer
from tests.test_login_protection import fail
from tests.test_sessions import account, api, events, google, sign_in, svc  # noqa: F401  (fixtures)

M = "/api/v1/monitoring"


def rows(api, headers, path: str, **params) -> list[dict]:
    res = api.get(f"{M}/{path}", headers=headers, params={"pageSize": 100, **params})
    assert res.status_code == 200, res.text
    return res.json()["data"]


def forgot(api, email: str, ip: str = "198.51.100.20"):
    assert api.post("/api/v1/accounts/forgot-password", headers={**svc(), "X-Forwarded-For": ip}, json={"email": email}).status_code == 200


@pytest.mark.parametrize("role", [Role.director, Role.inhouse_supervisor, Role.partner])
def test_only_admins(api, db, role):
    headers = bearer(signed_in(api, account(db, role=role))[0])
    for path in ("sign-ins", "sign-ins/stats", "reset-emails", "reset-emails/flagged"):
        assert api.get(f"{M}/{path}", headers=headers).status_code == 403, path
    assert api.post(f"{M}/reset-emails/resend", headers=headers, json={"user_id": "x", "kind": "password_reset", "reason": "why"}).status_code == 403


def test_sign_in_activity_shows_each_result(api, db, admin, caplog):
    _, headers = admin
    user = account(db, role=Role.hr)
    unverified = account(db, role=Role.hr, verified=False)
    off = account(db, role=Role.hr, deactivated_at=utc_now_ms())
    assert sign_in(api, user).status_code == 200
    fail(api, user.email)  # 10 wrong passwords, then locked
    assert sign_in(api, user).status_code == 429
    assert sign_in(api, unverified).status_code == 403
    assert sign_in(api, off).status_code == 403

    with caplog.at_level(logging.INFO, logger="vertex"):
        mine = rows(api, headers, "sign-ins", q=user.email)
    assert [r["result"] for r in mine] == ["locked"] + ["wrong_password"] * 10 + ["success"]  # newest first
    assert mine[-1]["account"]["id"] == user.id and mine[-1]["method"] == "password" and mine[-1]["client"] == "web"
    assert mine[-1]["ip"] and mine[-1]["device"]
    assert [r["result"] for r in rows(api, headers, "sign-ins", q=unverified.email)] == ["not_activated"]
    assert [r["result"] for r in rows(api, headers, "sign-ins", q=off.email)] == ["deactivated"]
    viewed = [e for e in events(caplog, "audit_trail_viewed") if e.get("view") == "sign_in_activity"][0]
    assert viewed["filters"] == {"search": True}

    # Filters
    assert {r["result"] for r in rows(api, headers, "sign-ins", q=user.email, failures_only=True)} == {"wrong_password", "locked"}
    assert len(rows(api, headers, "sign-ins", q=user.email, result="success")) == 1
    assert len(rows(api, headers, "sign-ins", user_id=user.id)) == 12
    assert rows(api, headers, "sign-ins", q=f"nobody-{secrets.token_hex(4)}") == []


def test_the_failure_charts(api, db, admin):
    _, headers = admin
    user = account(db, role=Role.hr)
    fail(api, user.email, 9)
    stats = api.get(f"{M}/sign-ins/stats", headers=headers).json()["data"]
    assert sum(h["n"] for h in stats["hours"]) >= 9
    fp = email_fingerprint(user.email)
    mine = [a for a in stats["top_accounts"] if a["email_fp"] == fp]
    # Top 10 by failures: 9 is likely, not certain, to rank among a test run's accounts.
    if mine:
        assert mine[0]["n"] == 9 and mine[0]["account"]["id"] == user.id
    assert all(set(a) == {"ip", "country", "n"} for a in stats["top_addresses"])


def test_reset_email_activity(api, db, admin, sent_mail):
    _, headers = admin
    user = account(db, role=Role.hr)
    for i in range(4):  # 3 sent, then refused by the per-email limit
        forgot(api, user.email, f"198.51.100.{i}")
    fresh = account(db, role=Role.hr, password=None)
    assert api.post(f"/api/v1/users/{fresh.id}/setup-email", headers=headers).status_code == 200
    nobody = f"nobody-{secrets.token_hex(4)}@test.invalid"
    forgot(api, nobody)
    record_security_event("reset_rate_limited", actor_id=None, entity_type="Auth", entity_id="forgot_password",
                          detail={"scope": "address", "kind": "password_reset", "ip": "203.0.113.99"})

    mine = rows(api, headers, "reset-emails", q=user.email)
    assert [(r["kind"], r["result"]) for r in mine] == [("password_reset", "refused_email_limit")] + [("password_reset", "sent")] * 3
    assert mine[0]["account"]["id"] == user.id and mine[0]["ip"] == "198.51.100.3"
    [setup] = rows(api, headers, "reset-emails", q=fresh.email)
    assert (setup["kind"], setup["result"], setup["manual"]) == ("account_setup", "sent", False)
    by_address = rows(api, headers, "reset-emails", result="refused_address_limit")
    assert any(r["ip"] == "203.0.113.99" and r["account"] is None for r in by_address)
    assert any(r["email_fp"] == email_fingerprint(nobody) and r["result"] == "not_sent" for r in rows(api, headers, "reset-emails", result="not_sent"))
    assert all(r["kind"] == "account_setup" for r in rows(api, headers, "reset-emails", kind="account_setup"))


def test_three_refusals_in_a_day_are_flagged(api, db, admin):
    _, headers = admin
    user = account(db, role=Role.hr)
    for i in range(6):  # 3 sent, 3 refused
        forgot(api, user.email, f"198.51.100.{i}")
    fp = email_fingerprint(user.email)
    [flag] = [f for f in api.get(f"{M}/reset-emails/flagged", headers=headers).json()["data"] if f["email_fp"] == fp]
    assert flag["refused"] == 3 and flag["account"]["id"] == user.id


def test_a_manual_resend_counts_toward_no_limit(api, db, admin, sent_mail):
    me, headers = admin
    user = account(db, role=Role.hr)
    for i in range(4):
        forgot(api, user.email, f"198.51.100.{i}")
    assert sum(1 for m in sent_mail if m.kind == "password_reset") == 3
    res = api.post(f"{M}/reset-emails/resend", headers=headers, json={"user_id": user.id, "kind": "password_reset", "reason": "Asked by phone"})
    assert res.status_code == 200, res.text
    assert sum(1 for m in sent_mail if m.kind == "password_reset") == 4
    [latest, *_] = rows(api, headers, "reset-emails", q=user.email)
    assert (latest["result"], latest["manual"]) == ("sent", True)
    # The right kind for the account's state.
    assert api.post(f"{M}/reset-emails/resend", headers=headers, json={"user_id": user.id, "kind": "account_setup", "reason": "x y z"}).status_code == 409
    fresh = account(db, role=Role.hr, password=None)
    assert api.post(f"{M}/reset-emails/resend", headers=headers, json={"user_id": fresh.id, "kind": "password_reset", "reason": "x y z"}).status_code == 409
    assert api.post(f"{M}/reset-emails/resend", headers=headers, json={"user_id": user.id, "kind": "password_reset", "reason": ""}).status_code == 422


def test_the_drawer_shows_the_accounts_emails(api, db, admin):
    _, headers = admin
    user = account(db, role=Role.hr)
    for i in range(4):
        forgot(api, user.email, f"198.51.100.{i}")
    detail = api.get(f"{M}/accounts/{user.id}", headers=headers).json()["data"]
    assert [e["result"] for e in detail["account_emails"]] == ["refused_email_limit", "sent", "sent", "sent"]
