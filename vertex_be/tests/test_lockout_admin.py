"""Login protection, PR 3 (section 4.1, 4.6, 4.7): the admin's follow-up on
lockouts. The history with filters, closing "Needs review" with a note,
"Unlock and send reset link", "Force password reset", the account's own
lockouts and escalation, the sidebar badge, and the Overview's new counts.
Admins only."""

from __future__ import annotations

import secrets
from datetime import timedelta

import pytest
from sqlalchemy import select

from app.core.clock import utc_now_ms
from app.models.audit import AuditLog
from app.models.enums import LockoutEnd, Role
from app.models.security import LoginLockout
from app.services.sessions import email_fingerprint
from tests.test_account_monitoring import admin, signed_in  # noqa: F401  (fixtures)
from tests.test_auth import bearer
from tests.test_login_protection import fail, lockouts, run_out
from tests.test_partner_activation import partner_login
from tests.test_sessions import account, api, google, sign_in, svc  # noqa: F401  (fixtures)

M = "/api/v1/monitoring"


def lockout(db, user=None, *, step=1, needs_review=False, holding=True, ended_by=None, days_ago=0) -> LoginLockout:
    """A lockout as login_lockout writes one, in the test's transaction."""
    at = utc_now_ms() - timedelta(days=days_ago, minutes=5)
    until = at + timedelta(minutes=[15, 60, 240, 1440][step - 1]) if holding else at + timedelta(minutes=1)
    row = LoginLockout(
        email_fp=email_fingerprint(user.email) if user else secrets.token_hex(8), user_id=user.id if user else None, step=step,
        locked_at=at, locked_until=until, failures=10, last_ip="198.51.100.7", last_country="KE", needs_review=needs_review,
        ended_at=None if holding else until, ended_by=ended_by,
    )
    db.add(row)
    db.flush()
    return row


def history(api, headers, **params) -> dict[str, dict]:
    res = api.get(f"{M}/lockouts", headers=headers, params={"pageSize": 100, **params})
    assert res.status_code == 200, res.text
    return {r["id"]: r for r in res.json()["data"]}


@pytest.mark.parametrize("role", [Role.director, Role.inhouse_supervisor, Role.partner])
def test_only_admins(api, db, role):
    headers = bearer(signed_in(api, account(db, role=role))[0])
    some = account(db, role=Role.hr)
    assert api.get(f"{M}/lockouts", headers=headers).status_code == 403
    assert api.get(f"{M}/locked/summary", headers=headers).status_code == 403
    assert api.post(f"{M}/lockouts/x/review", headers=headers, json={"note": "fine"}).status_code == 403
    assert api.post(f"{M}/accounts/{some.id}/force-reset", headers=headers, json={"reason": "why"}).status_code == 403


def test_the_history_and_its_filters(api, db, admin):
    _, headers = admin
    user = account(db, role=Role.hr)
    user.full_name = f"Lock History {secrets.token_hex(3)}"
    held = lockout(db, user, step=2)
    expired = lockout(db, user, step=1, holding=False, ended_by=LockoutEnd.expired, days_ago=1)
    unlocked = lockout(db, user, step=4, needs_review=True, holding=False, ended_by=LockoutEnd.admin, days_ago=2)
    old = lockout(db, user, holding=False, ended_by=LockoutEnd.expired, days_ago=400)  # past the retention window

    mine = history(api, headers, q=user.full_name)
    assert set(mine) == {held.id, expired.id, unlocked.id}
    assert list(mine) == [held.id, expired.id, unlocked.id]  # newest first
    assert mine[held.id]["holding"] is True and mine[held.id]["account"]["id"] == user.id
    assert set(history(api, headers, q=user.full_name, ended_by="holding")) == {held.id}
    assert set(history(api, headers, q=user.full_name, ended_by="expired")) == {expired.id}
    assert set(history(api, headers, q=user.full_name, ended_by="admin")) == {unlocked.id}
    assert set(history(api, headers, q=user.full_name, step=4)) == {unlocked.id}
    assert set(history(api, headers, q=user.full_name, needs_review=True)) == {unlocked.id}
    assert old.id not in history(api, headers, q=user.full_name)


def test_closing_needs_review_with_a_note(api, db, admin):
    me, headers = admin
    user = account(db, role=Role.hr)
    plain = lockout(db, user, holding=False, ended_by=LockoutEnd.expired, days_ago=1)
    flagged = lockout(db, user, step=4, needs_review=True)
    before = api.get(f"{M}/locked/summary", headers=headers).json()["data"]
    assert before["open"] >= 1

    assert api.post(f"{M}/lockouts/{plain.id}/review", headers=headers, json={"note": "fine"}).status_code == 409
    assert api.post(f"{M}/lockouts/{flagged.id}/review", headers=headers, json={"note": ""}).status_code == 422
    res = api.post(f"{M}/lockouts/{flagged.id}/review", headers=headers, json={"note": "Owner travelling; password changed"})
    assert res.status_code == 200
    row = res.json()["data"]
    assert row["reviewed_by"]["id"] == me.id and row["review_note"] == "Owner travelling; password changed"
    assert api.post(f"{M}/lockouts/{flagged.id}/review", headers=headers, json={"note": "again"}).status_code == 409
    assert api.get(f"{M}/locked/summary", headers=headers).json()["data"]["open"] == before["open"] - 1
    change = db.scalar(select(AuditLog).where(AuditLog.entity_type == "LoginLockout", AuditLog.entity_id == flagged.id, AuditLog.action == "update"))
    assert change.actor_id == me.id


def test_unlock_and_send_a_reset_link(api, db, admin, sent_mail):
    _, headers = admin
    user = account(db, role=Role.hr)
    fail(api, user.email)
    fp = email_fingerprint(user.email)
    res = api.post(f"{M}/locked/{fp}/unlock", headers={**headers, **svc()}, json={"reason": "Called them", "send_reset": True})
    assert res.json()["data"] == {"email_fp": fp, "unlocked": True, "reset_sent": True, "reset_refused": None}
    assert [m.to for m in sent_mail if m.kind == "password_reset"] == [user.email]


def test_unlock_and_send_reset_says_why_it_didnt(api, db, admin, sent_mail):
    _, headers = admin
    nobody = f"nobody-{secrets.token_hex(4)}@test.invalid"
    fail(api, nobody)
    fp = email_fingerprint(nobody)
    res = api.post(f"{M}/locked/{fp}/unlock", headers=headers, json={"reason": "Guessing", "send_reset": True})
    assert res.json()["data"]["reset_refused"] == "no_account" and res.json()["data"]["unlocked"] is True
    assert [m for m in sent_mail if m.kind == "password_reset"] == []


def test_force_password_reset(api, db, admin, sent_mail):
    me, headers = admin
    login, _agency = partner_login(db)
    fail(api, login.email)
    res = api.post(f"{M}/accounts/{login.id}/force-reset", headers={**headers, **svc()}, json={"reason": "Possible compromise"})
    assert res.status_code == 200, res.text
    assert res.json()["data"] == {"id": login.id, "email": login.email, "unlocked": True}
    db.refresh(login)
    assert login.password_hash is None
    assert [m.to for m in sent_mail if m.kind == "account_setup"] == [login.email]
    assert lockouts(db, login.email)[-1].ended_by is LockoutEnd.admin
    assert sign_in(api, login).status_code == 401  # the old password is gone


def test_force_reset_refusals(api, db, admin):
    me, headers = admin
    candidate = account(db, role=Role.candidate)
    off = account(db, role=Role.hr, deactivated_at=utc_now_ms())
    for target, code in ((candidate.id, 422), (me.id, 422), (off.id, 409), ("nope", 404)):
        assert api.post(f"{M}/accounts/{target}/force-reset", headers=headers, json={"reason": "a reason"}).status_code == code
    assert api.post(f"{M}/accounts/{off.id}/force-reset", headers=headers, json={}).status_code == 422


def test_the_account_shows_its_lockouts_and_escalation(api, db, admin):
    _, headers = admin
    user = account(db, role=Role.hr)
    fail(api, user.email)
    run_out(db, lockouts(db, user.email)[-1])
    detail = api.get(f"{M}/accounts/{user.id}", headers=headers).json()["data"]
    assert [lk["step"] for lk in detail["lockouts"]] == [1]
    assert detail["next_lockout_step"] == 2 and detail["steps_reset_at"] is not None
    fresh = api.get(f"{M}/accounts/{account(db, role=Role.hr).id}", headers=headers).json()["data"]
    assert (fresh["lockouts"], fresh["next_lockout_step"], fresh["steps_reset_at"]) == ([], 1, None)


def test_the_overview_counts(api, db, admin):
    _, headers = admin
    before = api.get(f"{M}/overview", headers=headers).json()["data"]
    lockout(db, account(db, role=Role.hr), step=4, needs_review=True)
    user = account(db, role=Role.hr)
    for i in range(4):  # the 4th is refused by the per-email limit
        api.post("/api/v1/accounts/forgot-password", headers={**svc(), "X-Forwarded-For": f"198.51.100.{i}"}, json={"email": user.email})
    after = api.get(f"{M}/overview", headers=headers).json()["data"]
    assert after["lockouts_needing_review"] == before["lockouts_needing_review"] + 1
    assert after["reset_emails_refused"]["last_24h"] == before["reset_emails_refused"]["last_24h"] + 1
    assert isinstance(after["failed_sign_ins_previous_24h"], int)
