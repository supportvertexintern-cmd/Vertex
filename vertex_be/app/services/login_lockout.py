"""Login protection, PR 1: the per-account lockout with escalating cooldowns.

Failed sign-ins are counted per account, by the email's fingerprint (an
address typed at sign-in, which may have no account), in Redis when
REDIS_URL is set so every worker shares the count, else in this process.
ACCOUNT_MAX_FAILURES in ACCOUNT_WINDOW_SECONDS lock the address: a
LoginLockout row, open until its locked_until. Sign-in is refused while it
is, with the same answer whether or not the address has an account.

Each lockout in a row holds longer (COOLDOWN_MINUTES, decision L1): 15
minutes, 1 hour, 4 hours, then 24 hours, which also flags the account for an
admin's review (L6: never deactivated by itself). A lockout is "in a row"
when the previous one ended less than 24 hours before; an admin unlock or a
password reset starts the count again.

A successful sign-in clears the failures, never the lockout history, so
someone who also knows the password can't wipe it.

The lock lives in the database, not Redis: every worker sees it, and so
does an admin, even while Redis is down (failures are then counted per
process, as before; the outage is logged).
"""

from __future__ import annotations

import logging
import math
import threading
import time
from collections import deque
from dataclasses import dataclass
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.audit import set_audit_actor
from app.core.clock import utc_now_ms
from app.core.config import settings
from app.core.logging import log_event
from app.core.redis_store import StoreUnavailable, call, counter_store
from app.db.session import engine  # the sweep's own session
from app.models.enums import LockoutEnd
from app.models.identity import User
from app.models.security import LoginLockout

ACCOUNT_WINDOW_SECONDS = 15 * 60
ACCOUNT_MAX_FAILURES = 10
# The cooldown for the 1st, 2nd, 3rd and 4th-or-later lockout in a row (L1).
COOLDOWN_MINUTES = (15, 60, 240, 1440)
# How long after a lockout ends the next one still counts as "in a row".
IN_A_ROW = timedelta(hours=24)
# The owner is emailed at most once in this long (L2).
NOTICE_EVERY = timedelta(hours=24)
REVIEW_STEP = len(COOLDOWN_MINUTES)


# --- the failure counter ------------------------------------------------------------

_failures: dict[str, deque[float]] = {}
_failures_lock = threading.Lock()


def _recent(fp: str, now: float) -> deque[float]:
    times = _failures.setdefault(fp, deque())
    while times and now - times[0] > ACCOUNT_WINDOW_SECONDS:
        times.popleft()
    return times


def _key(fp: str) -> str:
    return f"{settings.APP_ENV}:rl:login-account:{fp}"


def note_failure(fp: str) -> int:
    """Counts one failed sign-in; returns the count in the window, which
    starts at the first failure."""
    store = counter_store()
    if store is not None:
        def note(r) -> int:
            pipe = r.pipeline()
            pipe.incr(_key(fp))
            pipe.expire(_key(fp), ACCOUNT_WINDOW_SECONDS, nx=True)
            return int(pipe.execute()[0])

        try:
            return call(store, note)
        except StoreUnavailable as err:
            log_event(logging.ERROR, "ratelimit.store_unavailable", scope="login-account", error=str(err))
    with _failures_lock:
        now = time.monotonic()
        times = _recent(fp, now)
        times.append(now)
        return len(times)


def failures(fp: str) -> int:
    store = counter_store()
    if store is not None:
        try:
            return int(call(store, lambda r: r.get(_key(fp))) or 0)
        except StoreUnavailable as err:
            log_event(logging.ERROR, "ratelimit.store_unavailable", scope="login-account", error=str(err))
    with _failures_lock:
        return len(_recent(fp, time.monotonic()))


def clear_failures(fp: str) -> None:
    """After a successful sign-in, an unlock or a password reset (G2)."""
    store = counter_store()
    if store is not None:
        try:
            call(store, lambda r: r.delete(_key(fp)))
        except StoreUnavailable as err:
            log_event(logging.ERROR, "ratelimit.store_unavailable", scope="login-account", error=str(err))
    with _failures_lock:
        _failures.pop(fp, None)


# --- the lock -------------------------------------------------------------------------


def open_lockout(db: Session, fp: str) -> LoginLockout | None:
    """The lockout holding this address now, if any."""
    return db.scalar(
        select(LoginLockout).where(LoginLockout.email_fp == fp, LoginLockout.ended_at.is_(None), LoginLockout.locked_until > utc_now_ms())
    )


def seconds_left(lockout: LoginLockout) -> int:
    return max(0, math.ceil((lockout.locked_until - utc_now_ms()).total_seconds()))


def locked_message(seconds: int) -> str:
    """What a locked sign-in is told (2.5): the same for every address."""
    minutes = max(1, math.ceil(seconds / 60))
    wait = f"{minutes} minute{'s' if minutes != 1 else ''}" if minutes < 120 else f"{math.ceil(minutes / 60)} hours"
    return f"Too many sign-in attempts. Try again in {wait}, or reset your password."


def next_step(db: Session, fp: str, now: datetime) -> int:
    """The step of a lockout starting now: one more than the last, if that
    one expired less than 24 hours ago and nothing has started the count
    again since (an admin unlock or a password reset); else 1."""
    last = db.scalar(select(LoginLockout).where(LoginLockout.email_fp == fp).order_by(LoginLockout.locked_at.desc()).limit(1))
    if last is None or last.ended_by in (LockoutEnd.admin, LockoutEnd.password_reset) or last.steps_reset_at is not None:
        return 1
    ended = last.ended_at or last.locked_until
    if now - ended >= IN_A_ROW:
        return 1
    return min(last.step + 1, REVIEW_STEP)


@dataclass(frozen=True)
class Locked:
    lockout_id: str
    step: int
    minutes: int
    notify: User | None


def lock(db: Session, fp: str, *, user: User | None, failures_seen: int, ip: str | None, country: str | None) -> Locked | None:
    """Locks the address and commits, before the sign-in is refused (a
    refusal rolls the request's session back). None if another worker
    locked it first; its lockout stands."""
    now = utc_now_ms()
    set_audit_actor(db, None)  # the system's
    # A lockout past its time that the sweep hasn't closed yet.
    for stale in db.scalars(select(LoginLockout).where(LoginLockout.email_fp == fp, LoginLockout.ended_at.is_(None))):
        stale.ended_at, stale.ended_by = stale.locked_until, LockoutEnd.expired
    db.flush()
    step = next_step(db, fp, now)
    minutes = COOLDOWN_MINUTES[step - 1]
    notify = None
    if user is not None and user.email_verified and user.deactivated_at is None and settings.LOCKOUT_NOTICE_ENABLED:
        noticed = db.scalar(select(LoginLockout.id).where(
            LoginLockout.user_id == user.id, LoginLockout.notice_sent_at > now - NOTICE_EVERY,
        ).limit(1))
        notify = None if noticed else user
    row = LoginLockout(
        email_fp=fp, user_id=user.id if user else None, step=step, locked_at=now, locked_until=now + timedelta(minutes=minutes),
        failures=failures_seen, last_ip=ip, last_country=country, needs_review=step >= REVIEW_STEP,
        notice_sent_at=now if notify else None,
    )
    try:
        with db.begin_nested():
            db.add(row)
    except IntegrityError:
        return None  # the other worker's lockout stands
    db.commit()
    clear_failures(fp)
    log_event(logging.WARNING, "login.locked", email_fp=fp, step=step, minutes=minutes)
    if notify is not None:
        _send_notice(db, notify, minutes)
    return Locked(row.id, step, minutes, notify)


def _send_notice(db: Session, user: User, minutes: int) -> None:
    from app.api.notices import AccountLockedEmail  # noqa: PLC0415
    from app.services.emails import deliver  # noqa: PLC0415

    wait = f"{minutes} minutes" if minutes < 120 else f"{minutes // 60} hours"
    deliver(db, [AccountLockedEmail(email=user.email, full_name=user.full_name, duration=wait)])


def end(db: Session, fp: str, how: LockoutEnd, *, by: str | None = None, reason: str | None = None) -> LoginLockout | None:
    """An admin unlock or a password reset (2.1), in the caller's
    transaction: lifts the lockout holding this address, if one is, clears
    its failures, and starts the escalation again. Returns the lockout it
    lifted, or None if none was holding the address."""
    now = utc_now_ms()
    lifted = None
    row = db.scalar(select(LoginLockout).where(LoginLockout.email_fp == fp, LoginLockout.ended_at.is_(None)).with_for_update())
    if row is not None and row.locked_until > now:
        row.ended_at, row.ended_by, row.ended_by_user_id, row.end_reason = now, how, by, reason
        lifted = row
    elif row is not None:
        row.ended_at, row.ended_by = row.locked_until, LockoutEnd.expired
    if lifted is None:
        # Nothing holding the address, but a recent lockout would still make
        # the next one longer: mark where the count starts again.
        last = db.scalar(select(LoginLockout).where(LoginLockout.email_fp == fp).order_by(LoginLockout.locked_at.desc()).limit(1))
        if last is not None and last.steps_reset_at is None and now - (last.ended_at or last.locked_until) < IN_A_ROW:
            last.steps_reset_at = now
    db.flush()
    clear_failures(fp)
    return lifted


def expire_ended() -> int:
    """The sweep (on the account checks' schedule): closes the lockouts past
    their time as expired. Returns how many."""
    now = utc_now_ms()
    closed = 0
    with Session(engine) as db:
        set_audit_actor(db, None)
        for row in db.scalars(select(LoginLockout).where(LoginLockout.ended_at.is_(None), LoginLockout.locked_until <= now).limit(500)):
            row.ended_at, row.ended_by = row.locked_until, LockoutEnd.expired
            closed += 1
        db.commit()
    return closed


def held(db: Session) -> list[LoginLockout]:
    """Every lockout holding an address now, longest to go first."""
    return list(db.scalars(
        select(LoginLockout).where(LoginLockout.ended_at.is_(None), LoginLockout.locked_until > utc_now_ms())
        .order_by(LoginLockout.locked_until.desc())
    ))
