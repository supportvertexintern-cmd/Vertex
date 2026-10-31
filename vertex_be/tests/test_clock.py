"""One clock (auth hardening plan, workstream C): every time FastAPI stores,
compares or signs comes from app/core/clock.py, cut to the millisecond as
Prisma stores it, so no check fails on a microsecond again."""

import re
from datetime import UTC, datetime, timedelta, timezone

from app.core import clock
from app.core.config import BASE_DIR

APP = BASE_DIR / "app"
# Reading the clock anywhere but clock.py, or computing an expiry in SQL.
FORBIDDEN = re.compile(r"datetime\.(?:now|utcnow|today)\(|\bdate\.today\(|\btime\.time\(\)|func\.now\(\)\s*[+-]|now\(\)\s*[+-]\s*interval", re.I)


def test_nothing_else_reads_the_clock():
    offenders = []
    for path in APP.rglob("*.py"):
        if path == APP / "core" / "clock.py":
            continue
        for n, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            if FORBIDDEN.search(line):
                offenders.append(f"{path.relative_to(BASE_DIR)}:{n}: {line.strip()}")
    assert offenders == [], "use app.core.clock (utc_now_ms, to_ms, epoch_seconds)"


def test_the_ban_catches_what_it_should():
    for line in ("x = datetime.now(UTC)", "datetime.utcnow()", "date.today()", "int(time.time())", "func.now() + interval", "now() + interval '1 day'"):
        assert FORBIDDEN.search(line), line
    assert not FORBIDDEN.search("created_at = utc_now_ms()")


def test_now_is_naive_utc_to_the_millisecond():
    now = clock.utc_now_ms()
    assert now.tzinfo is None and now.microsecond % 1000 == 0
    assert abs(now - datetime.now(UTC).replace(tzinfo=None)) < timedelta(seconds=2)


def test_to_ms_cuts_and_converts():
    assert clock.to_ms(datetime(2026, 10, 31, 12, 0, 0, 123987)) == datetime(2026, 10, 31, 12, 0, 0, 123000)
    plus3 = timezone(timedelta(hours=3))
    assert clock.to_ms(datetime(2026, 10, 31, 15, 0, 0, 999999, tzinfo=plus3)) == datetime(2026, 10, 31, 12, 0, 0, 999000)


def test_epoch_seconds_are_whole():
    assert isinstance(clock.epoch_seconds(), int)
    assert abs(clock.epoch_seconds() - datetime.now(UTC).timestamp()) < 2
