"""Script-like activity (owner's request 2026-11-07): an account reading,
writing or signing in faster than a person would, which is what a script
running with its session looks like. Each signed-in request is counted per
account (app/core/auth.py), in a fixed window from its first request: in
Redis when REDIS_URL is set, so every worker shares the count, otherwise in
this process. Crossing a rule's threshold raises its alert once per window
(security_monitor's UNUSUAL_READS, UNUSUAL_WRITES, RAPID_SIGN_INS). Nothing
here raises or slows a request: a failure is logged and the count skipped.
"""

from __future__ import annotations

import logging
import threading
import time

from app.core.config import settings
from app.core.logging import log_event
from app.core.redis_store import StoreUnavailable, call, counter_store

WRITES = frozenset({"POST", "PUT", "PATCH", "DELETE"})
_local: dict[str, tuple[float, int]] = {}
_lock = threading.Lock()


def _count(kind: str, user_id: str, window_seconds: int) -> int:
    key = f"{settings.APP_ENV}:activity:{kind}:{user_id}"
    store = counter_store()
    if store is not None:
        def bump(r):
            pipe = r.pipeline()
            pipe.incr(key)
            pipe.expire(key, window_seconds, nx=True)
            return pipe.execute()[0]

        try:
            return int(call(store, bump))
        except StoreUnavailable as err:
            log_event(logging.WARNING, "activity.store_unavailable", error=str(err))
            return 0
    now = time.monotonic()
    with _lock:
        started, n = _local.get(key, (now, 0))
        if now - started > window_seconds:
            started, n = now, 0
        _local[key] = (started, n + 1)
        return n + 1


def _check(rule, kind: str, user_id: str, what: str) -> None:
    from app.services import security_monitor  # noqa: PLC0415 (it imports nothing of this)

    n = _count(kind, user_id, rule.window_minutes * 60)
    if n == rule.threshold:  # once, as it crosses
        security_monitor.raise_alert(
            rule, f"user:{user_id}", f"{n} {what} by one account in {rule.window_minutes} minutes",
            {"user_id": user_id, "count": n, "window_minutes": rule.window_minutes},
        )


def note_request(user_id: str, method: str) -> None:
    from app.services import security_monitor  # noqa: PLC0415

    try:
        if method.upper() in WRITES:
            _check(security_monitor.UNUSUAL_WRITES, "write", user_id, "changes")
        else:
            _check(security_monitor.UNUSUAL_READS, "read", user_id, "reads")
    except Exception as err:  # noqa: BLE001
        log_event(logging.ERROR, "activity.note_failed", error=type(err).__name__)


def note_sign_in(user_id: str) -> None:
    from app.services import security_monitor  # noqa: PLC0415

    try:
        _check(security_monitor.RAPID_SIGN_INS, "sign_in", user_id, "sign-ins")
    except Exception as err:  # noqa: BLE001
        log_event(logging.ERROR, "activity.note_failed", error=type(err).__name__)


def reset() -> None:
    """Test hook."""
    with _lock:
        _local.clear()
