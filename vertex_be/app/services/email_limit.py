"""Login protection, PR 2 (G3): a per-email limit on account emails.

The website limits forgot-password per network address; one person's inbox
could still be flooded from many addresses. This caps the password-reset
and setup emails one email address receives, from anywhere: PER_HOUR in an
hour and PER_DAY in a day, counted together. Keys hold only the email's
fingerprint.

Counted in Redis when REDIS_URL is set, so every worker shares the count;
without Redis (development, tests), in this process. If Redis is set but
unreachable, the email isn't sent (fail closed, as the website's
forgot-password limit is) and the outage is logged.
"""

from __future__ import annotations

import logging
import threading
import time
from collections import deque

from app.core.config import settings
from app.core.logging import log_event
from app.core.redis_store import StoreUnavailable, call, counter_store

PER_HOUR = 3
PER_DAY = 6
HOUR, DAY = 3600, 24 * 3600

_sent: dict[str, deque[float]] = {}
_lock = threading.Lock()


def _keys(fp: str) -> tuple[str, str]:
    return f"{settings.APP_ENV}:rl:account-email:h:{fp}", f"{settings.APP_ENV}:rl:account-email:d:{fp}"


def allow(fp: str) -> bool:
    """True, and counted, if one more account email may go to this address
    now; False if it has had its share (nothing is counted then)."""
    store = counter_store()
    if store is not None:
        hour, day = _keys(fp)

        def take(r) -> bool:
            if int(r.get(hour) or 0) >= PER_HOUR or int(r.get(day) or 0) >= PER_DAY:
                return False
            pipe = r.pipeline()
            pipe.incr(hour)
            pipe.expire(hour, HOUR, nx=True)
            pipe.incr(day)
            pipe.expire(day, DAY, nx=True)
            pipe.execute()
            return True

        try:
            return call(store, take)
        except StoreUnavailable as err:
            log_event(logging.ERROR, "ratelimit.store_unavailable", scope="account-email", error=str(err))
            return False
    with _lock:
        now = time.monotonic()
        times = _sent.setdefault(fp, deque())
        while times and now - times[0] > DAY:
            times.popleft()
        if len(times) >= PER_DAY or sum(1 for t in times if now - t <= HOUR) >= PER_HOUR:
            return False
        times.append(now)
        return True
