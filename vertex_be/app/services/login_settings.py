"""Login protection, PR 6 (G7): the thresholds an admin may change.

One SystemSetting, key "login_protection", holding JSON. Each value has a
default (the document's, and what PRs 1 to 5 hard-coded) and an allowed
range; the API refuses a value outside it (422), never clamps it. A missing
or unreadable setting means the defaults. Read through a 60-second cache;
saving clears it in this process, and other processes see the change
within a minute.

Who reads what:
  - FastAPI's per-account lockout (login_lockout): account_max_failures,
    account_window_minutes, cooldown_steps_minutes, lockout_notice_enabled
    (and LOCKOUT_NOTICE_ENABLED in the environment can still turn the
    notice off).
  - FastAPI's per-email limit (email_limit): reset_per_email_hour and
    reset_per_email_day.
  - The website's per-address sign-in limit: ip_login_max_per_minute
    (GET /api/v1/login-protection, its service credential).
"""

from __future__ import annotations

import json
import logging
import time
from dataclasses import asdict, dataclass, field

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.logging import log_event
from app.db.session import engine
from app.models.reference import SystemSetting

KEY = "login_protection"
CACHE_SECONDS = 60


@dataclass(frozen=True)
class LoginProtection:
    account_max_failures: int = 10
    account_window_minutes: int = 15
    cooldown_steps_minutes: tuple[int, ...] = (15, 60, 240, 1440)
    ip_login_max_per_minute: int = 10
    reset_per_email_hour: int = 3
    reset_per_email_day: int = 6
    lockout_notice_enabled: bool = True

    def as_dict(self) -> dict:
        out = asdict(self)
        out["cooldown_steps_minutes"] = list(self.cooldown_steps_minutes)
        return out


DEFAULTS = LoginProtection()

# Allowed ranges (section 3.3): (lowest, highest).
BOUNDS: dict[str, tuple[int, int]] = {
    "account_max_failures": (5, 20),
    "account_window_minutes": (5, 60),
    "cooldown_steps_minutes": (5, 1440),
    "ip_login_max_per_minute": (5, 60),
    "reset_per_email_hour": (1, 10),
    "reset_per_email_day": (2, 20),
}


@dataclass
class _Cache:
    value: LoginProtection | None = None
    at: float = field(default=0.0)


_cache = _Cache()


def problems(values: dict) -> dict[str, list[str]]:
    """What's wrong with these values, per field; empty when they're fine."""
    out: dict[str, list[str]] = {}
    for name, (low, high) in BOUNDS.items():
        if name == "cooldown_steps_minutes":
            steps = values.get(name)
            if not isinstance(steps, list) or len(steps) != 4 or not all(isinstance(s, int) and not isinstance(s, bool) for s in steps):
                out[name] = ["Four whole numbers of minutes."]
            elif any(not low <= s <= high for s in steps):
                out[name] = [f"Each step is {low} to {high} minutes."]
            elif any(b <= a for a, b in zip(steps, steps[1:], strict=False)):
                out[name] = ["Each step must be longer than the one before."]
            continue
        value = values.get(name)
        if not isinstance(value, int) or isinstance(value, bool) or not low <= value <= high:
            out[name] = [f"A whole number from {low} to {high}."]
    if "reset_per_email_hour" not in out and "reset_per_email_day" not in out and values["reset_per_email_day"] < values["reset_per_email_hour"]:
        out["reset_per_email_day"] = ["At least the hourly limit."]
    if not isinstance(values.get("lockout_notice_enabled"), bool):
        out["lockout_notice_enabled"] = ["On or off."]
    return out


def _parse(text: str | None) -> LoginProtection:
    if not text:
        return DEFAULTS
    try:
        stored = json.loads(text)
        merged = DEFAULTS.as_dict() | {k: v for k, v in stored.items() if k in DEFAULTS.as_dict()}
        if problems(merged):
            raise ValueError("out of range")
        merged["cooldown_steps_minutes"] = tuple(merged["cooldown_steps_minutes"])
        return LoginProtection(**merged)
    except (ValueError, TypeError, AttributeError) as err:
        log_event(logging.ERROR, "login_protection.unreadable", error=type(err).__name__)
        return DEFAULTS


def current(db: Session | None = None) -> LoginProtection:
    """The settings in force (cached for a minute). db: the caller's session,
    so a change it hasn't committed yet is seen; else a session of its own."""
    now = time.monotonic()
    if _cache.value is not None and now - _cache.at < CACHE_SECONDS:
        return _cache.value
    try:
        if db is not None:
            text = db.scalar(select(SystemSetting.value).where(SystemSetting.key == KEY))
        else:
            with Session(engine) as own:
                text = own.scalar(select(SystemSetting.value).where(SystemSetting.key == KEY))
    except Exception as err:  # noqa: BLE001 (the database is down: the defaults, not an error at sign-in)
        log_event(logging.ERROR, "login_protection.read_failed", error=type(err).__name__)
        return _cache.value or DEFAULTS
    _cache.value, _cache.at = _parse(text), now
    return _cache.value


def forget() -> None:
    """After a save, and between tests."""
    _cache.value, _cache.at = None, 0.0


def save(db: Session, values: dict) -> LoginProtection:
    """Stores checked values through the ORM (audited, before and after), in
    the caller's transaction."""
    text = json.dumps(values, sort_keys=True)
    setting = db.get(SystemSetting, KEY)
    if setting is None:
        db.add(SystemSetting(key=KEY, value=text, description="Login protection thresholds (Monitoring → Login Protection)"))
    else:
        setting.value = text
    db.flush()
    saved = _parse(text)
    # This process uses the new values at once; the others within a minute.
    _cache.value, _cache.at = saved, time.monotonic()
    return saved
