"""The one clock for times FastAPI stores, compares or signs (auth hardening
plan, workstream C).

Prisma stores timestamps as timestamp(3): UTC without a time zone, to the
millisecond. Python keeps microseconds, so a value written without cutting
it first can differ by a millisecond from the one FastAPI holds or answered
with. Both helpers return what Prisma stores: naive UTC, cut to the
millisecond.

New code takes its time from here; the older modules move over in their own
change, which also bans calling datetime.now() elsewhere.
"""

from __future__ import annotations

from datetime import UTC, datetime


def to_ms(value: datetime) -> datetime:
    """value as Prisma stores it. A naive value is taken to be UTC already."""
    if value.tzinfo is not None:
        value = value.astimezone(UTC).replace(tzinfo=None)
    return value.replace(microsecond=value.microsecond // 1000 * 1000)


def utc_now_ms() -> datetime:
    return to_ms(datetime.now(UTC))
