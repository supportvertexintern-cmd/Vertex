"""The stack's Redis, for counters every worker must share (auth hardening
plan, workstream B): settings.REDIS_URL, or None when it's unset (tests, a
bare uvicorn), in which case callers count in their own process.

call() runs one operation with a hard deadline: a stopped container's name
can take seconds to fail to resolve, longer than any socket timeout. After a
failure Redis is left alone for a while, so an outage costs one wait, not one
per request. Callers catch StoreUnavailable and decide whether to carry on
or refuse.
"""

from __future__ import annotations

import time
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as Timeout
from functools import lru_cache
from typing import TypeVar

from redis import Redis

from app.core.config import settings

DEADLINE_SECONDS = 0.5
BREAK_SECONDS = 30.0

T = TypeVar("T")
_pool = ThreadPoolExecutor(max_workers=4, thread_name_prefix="redis-store")
_broken_until = 0.0


class StoreUnavailable(Exception):
    """Redis didn't answer in time, refused, or failed recently."""


@lru_cache
def _client(url: str) -> Redis:
    return Redis.from_url(url, socket_timeout=1, socket_connect_timeout=1, decode_responses=True)


def counter_store() -> Redis | None:
    return _client(settings.REDIS_URL) if settings.REDIS_URL else None


def call(store: Redis, operation: Callable[[Redis], T]) -> T:
    global _broken_until
    if time.monotonic() < _broken_until:
        raise StoreUnavailable("recently unreachable")
    try:
        return _pool.submit(operation, store).result(timeout=DEADLINE_SECONDS)
    except (Timeout, Exception) as err:  # noqa: BLE001 (any failure means: no counter)
        _broken_until = time.monotonic() + BREAK_SECONDS
        raise StoreUnavailable(type(err).__name__) from err
