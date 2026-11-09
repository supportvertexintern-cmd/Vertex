"""Login protection, PR 1 (owner's document 2026-11-09, decisions L1-L6 as
recommended): escalating cooldowns, the failures cleared by a successful
sign-in, every lockout kept with how it ended, an unlock with a reason, a
password reset ending a lockout, and one notice email a day to the owner.
app/services/login_lockout.py; migration 0017."""

from __future__ import annotations

import secrets
from datetime import timedelta

import pytest
from sqlalchemy import delete, insert, select

from app.core.clock import utc_now_ms
from app.core.config import settings
from app.db.base import new_id
from app.db.session import engine
from app.models.audit import AuditLog
from app.models.enums import LockoutEnd, Role
from app.models.security import LoginLockout
from app.services import login_lockout, security_monitor
from app.services.sessions import email_fingerprint
from tests.mail import of, token as mailed_token
from tests.test_account_monitoring import admin, signed_in  # noqa: F401  (fixtures)
from tests.test_sessions import PASSWORD, account, api, google, sign_in, svc  # noqa: F401  (fixtures)

LOCKED = "/api/v1/monitoring/locked"


def fail(api, email: str, times: int = 10):
    for _ in range(times):
        res = api.post("/api/v1/auth/login", headers=svc(), json={"email": email, "password": "Wrong-Password-1"})
        assert res.status_code == 401, res.text


def lockouts(db, email: str) -> list[LoginLockout]:
    db.expire_all()
    return list(db.scalars(select(LoginLockout).where(LoginLockout.email_fp == email_fingerprint(email)).order_by(LoginLockout.locked_at)))


def run_out(db, row: LoginLockout, hours_ago: float = 0) -> None:
    """The lockout's time has passed (hours_ago after it ended): the
    address's whole history moves back in time, in order."""
    shift = row.locked_until - (utc_now_ms() - timedelta(hours=hours_ago, seconds=1))
    for r in db.scalars(select(LoginLockout).where(LoginLockout.email_fp == row.email_fp)):
        r.locked_at, r.locked_until = r.locked_at - shift, r.locked_until - shift
        if r.ended_at is not None:
            r.ended_at -= shift
    db.flush()


def mails(sent, kind: str) -> list:
    return [m for m in sent if m.kind == kind]


def committed_lockout(**fields) -> str:
    """A lockout committed for real (the sweep and the clean-up use their
    own sessions); the caller deletes it."""
    now = utc_now_ms()
    row = {"id": new_id(), "email_fp": secrets.token_hex(8), "step": 1, "locked_at": now - timedelta(minutes=20),
           "locked_until": now - timedelta(minutes=5), "failures": 10, **fields}
    with engine.begin() as conn:
        conn.execute(insert(LoginLockout.__table__).values(row))
    return row["id"]


def committed_row(row_id: str) -> dict | None:
    with engine.connect() as conn:
        found = conn.execute(select(LoginLockout.__table__).where(LoginLockout.__table__.c.id == row_id)).mappings().first()
    return dict(found) if found else None


def forget(row_id: str) -> None:
    with engine.begin() as conn:
        conn.execute(delete(LoginLockout.__table__).where(LoginLockout.__table__.c.id == row_id))


def test_repeated_lockouts_escalate_and_the_fourth_needs_review(api, db):
    user = account(db, role=Role.hr)
    expected = [15, 60, 240, 1440]
    for step, minutes in enumerate(expected, start=1):
        fail(api, user.email)
        locked = sign_in(api, user)  # even the right password
        assert locked.status_code == 429
        row = lockouts(db, user.email)[-1]
        assert (row.step, row.user_id, row.failures) == (step, user.id, 10)
        assert row.locked_until - row.locked_at == timedelta(minutes=minutes)
        assert row.needs_review is (step == 4)
        run_out(db, row)
    # A fifth stays at 24 hours.
    fail(api, user.email)
    assert lockouts(db, user.email)[-1].step == 4


def test_the_count_starts_again_a_day_after_the_last_lockout(api, db):
    user = account(db, role=Role.hr)
    fail(api, user.email)
    run_out(db, lockouts(db, user.email)[-1], hours_ago=25)
    fail(api, user.email)
    assert [r.step for r in lockouts(db, user.email)] == [1, 1]
    # The stale one was closed as expired when the next began.
    assert lockouts(db, user.email)[0].ended_by is LockoutEnd.expired


def test_a_successful_sign_in_clears_the_failures_but_not_the_history(api, db):
    user = account(db, role=Role.hr)
    fail(api, user.email, 9)
    assert sign_in(api, user).status_code == 200
    fail(api, user.email, 9)
    assert sign_in(api, user).status_code == 200  # 18 failures, never 10 in a row
    assert lockouts(db, user.email) == []

    fail(api, user.email)
    run_out(db, lockouts(db, user.email)[-1])
    assert sign_in(api, user).status_code == 200
    fail(api, user.email)
    assert [r.step for r in lockouts(db, user.email)] == [1, 2]  # the success didn't reset the steps


def test_the_lock_message_is_the_same_with_or_without_an_account(api, db):
    user = account(db, role=Role.hr)
    nobody = f"nobody-{secrets.token_hex(4)}@test.invalid"
    fail(api, user.email)
    fail(api, nobody)
    answers = [api.post("/api/v1/auth/login", headers=svc(), json={"email": e, "password": PASSWORD}) for e in (user.email, nobody)]
    assert [a.status_code for a in answers] == [429, 429]
    assert answers[0].json()["error"]["message"] == answers[1].json()["error"]["message"]
    assert answers[0].json()["error"]["message"] == "Too many sign-in attempts. Try again in 15 minutes, or reset your password."
    assert lockouts(db, nobody)[0].user_id is None


def test_an_admin_unlock_needs_a_reason_and_starts_the_count_again(api, db, admin):
    me, headers = admin
    user = account(db, role=Role.hr)
    fail(api, user.email)
    run_out(db, lockouts(db, user.email)[-1])
    fail(api, user.email)  # step 2
    fp = email_fingerprint(user.email)
    [listed] = [r for r in api.get(LOCKED, headers=headers).json()["data"] if r["email_fp"] == fp]
    assert listed["step"] == 2 and 55 * 60 < listed["unlocks_in_seconds"] <= 60 * 60 and listed["account"]["id"] == user.id

    assert api.post(f"{LOCKED}/{fp}/unlock", headers=headers, json={}).status_code == 422
    assert api.post(f"{LOCKED}/{fp}/unlock", headers=headers, json={"reason": "  "}).status_code == 422
    res = api.post(f"{LOCKED}/{fp}/unlock", headers=headers, json={"reason": "Verified by phone"})
    assert res.json()["data"]["unlocked"] is True
    row = lockouts(db, user.email)[-1]
    assert (row.ended_by, row.ended_by_user_id, row.end_reason) == (LockoutEnd.admin, me.id, "Verified by phone")
    change = db.scalar(select(AuditLog).where(AuditLog.entity_type == "LoginLockout", AuditLog.entity_id == row.id, AuditLog.action == "update"))
    assert change.actor_id == me.id and change.after["end_reason"] == "Verified by phone"

    assert sign_in(api, user).status_code == 200
    fail(api, user.email)
    assert lockouts(db, user.email)[-1].step == 1  # escalation reset


def test_a_password_reset_ends_the_lockout_and_the_escalation(api, db, sent_mail):
    user = account(db, role=Role.hr)
    fail(api, user.email)
    run_out(db, lockouts(db, user.email)[-1])
    fail(api, user.email)  # step 2, holding
    assert api.post("/api/v1/accounts/forgot-password", headers=svc(), json={"email": user.email}).status_code == 200
    reset = mailed_token(of(sent_mail, "password_reset"))
    assert api.post("/api/v1/accounts/reset-password", headers=svc(), json={"token": reset, "password": "Brand-New-Pass1"}).status_code == 200
    row = lockouts(db, user.email)[-1]
    assert (row.ended_by, row.ended_by_user_id) == (LockoutEnd.password_reset, user.id)
    assert sign_in(api, user, "Brand-New-Pass1").status_code == 200
    fail(api, user.email)
    assert lockouts(db, user.email)[-1].step == 1


def test_a_reset_after_the_lockout_expired_also_starts_the_count_again(api, db):
    user = account(db, role=Role.hr)
    fail(api, user.email)
    first = lockouts(db, user.email)[-1]
    run_out(db, first)
    login_lockout.end(db, email_fingerprint(user.email), LockoutEnd.password_reset, by=user.id)
    db.expire_all()
    assert first.ended_by is LockoutEnd.expired and first.steps_reset_at is not None  # history stays true
    fail(api, user.email)
    assert lockouts(db, user.email)[-1].step == 1


def test_the_owner_gets_one_notice_a_day_never_with_the_address(api, db, sent_mail):
    user = account(db, role=Role.hr)
    fail(api, user.email)
    [notice] = mails(sent_mail, "account_locked")
    assert notice.to == user.email and "15 minutes" in notice.html
    assert "198.51" not in notice.html and "203.0" not in notice.html
    run_out(db, lockouts(db, user.email)[-1])
    fail(api, user.email)  # the 1-hour one: no second email the same day
    assert len(mails(sent_mail, "account_locked")) == 1
    assert lockouts(db, user.email)[0].notice_sent_at is not None and lockouts(db, user.email)[1].notice_sent_at is None


@pytest.mark.parametrize("fields", [{"verified": False}, {"deactivated_at": "now"}])
def test_no_notice_to_an_unverified_or_deactivated_account(api, db, sent_mail, fields):
    if fields.get("deactivated_at"):
        fields = {"deactivated_at": utc_now_ms()}
    user = account(db, role=Role.hr, **fields)
    fail(api, user.email)
    assert mails(sent_mail, "account_locked") == []
    assert lockouts(db, user.email)[0].notice_sent_at is None


def test_the_notice_can_be_turned_off(api, db, sent_mail, monkeypatch):
    monkeypatch.setattr(settings, "LOCKOUT_NOTICE_ENABLED", False)
    fail(api, account(db, role=Role.hr).email)
    assert mails(sent_mail, "account_locked") == []


def test_the_sweep_closes_lockouts_past_their_time():
    past, holding = committed_lockout(), committed_lockout(locked_until=utc_now_ms() + timedelta(minutes=10))
    try:
        login_lockout.expire_ended()
        row = committed_row(past)
        assert row["ended_by"] == "expired" and row["ended_at"] == row["locked_until"]
        assert committed_row(holding)["ended_at"] is None
    finally:
        forget(past)
        forget(holding)


def test_retention_deletes_old_ended_lockouts_only():
    old = utc_now_ms() - timedelta(days=400)
    ended = committed_lockout(locked_at=old, locked_until=old + timedelta(minutes=15), ended_at=old + timedelta(minutes=15), ended_by="expired")
    recent = committed_lockout(ended_at=utc_now_ms() - timedelta(minutes=5), ended_by="expired")
    try:
        security_monitor.run_retention()
        assert committed_row(ended) is None
        assert committed_row(recent) is not None
    finally:
        forget(ended)
        forget(recent)
