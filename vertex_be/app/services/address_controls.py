"""Login protection, PR 5: address controls and the website's live limits.

An admin blocks or allows a network address or range (AddressRule). The
website asks for the active rules (GET /address-controls, its service
credential), keeps them for 60 seconds, and:
  - refuses sign-in, registration and password-reset requests from a
    blocked address (403);
  - skips its per-address limits for an allowed one. The per-account
    lockout (login_lockout) is FastAPI's and always applies.
Where a block and an allow both match, the block wins.

Guards (section 4.3): a block needs a reason and an expiry, at most 30
days, and may not cover the admin's own address; an allow needs a reason
and is no wider than a /24 (IPv4) or /64 (IPv6). A block is also no wider
than a /16 or /48, so one mistyped range can't shut out a whole region.

The website's limits live in its Redis, under
"{APP_ENV}:rl:{scope}:{digest}:{window}" (lib/rate-limit.ts); when it
refuses a request it also writes the address it refused under
"{APP_ENV}:rl-ip:{scope}:{digest}:{window}", with the same expiry. Those
sibling keys are the addresses limited now, and clearing one deletes both.
"""

from __future__ import annotations

import ipaddress
import logging
import re
from dataclasses import dataclass
from datetime import timedelta

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.core.clock import utc_now_ms
from app.core.config import settings
from app.core.logging import log_event
from app.core.redis_store import StoreUnavailable, call, counter_store
from app.models.enums import AddressRuleKind
from app.models.security import AddressRule

MAX_BLOCK_DAYS = 30
# The widest ranges each kind may cover.
WIDEST = {AddressRuleKind.allow: (24, 64), AddressRuleKind.block: (16, 48)}
LIMIT_KEY = re.compile(r"^[a-z0-9-]{1,60}:[0-9a-f]{32}:[0-9]{1,15}$")


class RangeRefused(ValueError):
    """Why a network can't be a rule, in words for the admin."""


def network_for(value: str, kind: AddressRuleKind) -> ipaddress.IPv4Network | ipaddress.IPv6Network:
    """The normalized network ("203.0.113.7" -> 203.0.113.7/32), within
    the widest range its kind may cover."""
    try:
        net = ipaddress.ip_network(value.strip(), strict=False)
    except ValueError:
        raise RangeRefused("Not an IP address or range (for example 203.0.113.7 or 203.0.113.0/24).") from None
    v4, v6 = WIDEST[kind]
    widest = v4 if net.version == 4 else v6
    if net.prefixlen < widest:
        raise RangeRefused(f"A {kind.value} may cover at most a /{widest} range for IPv{net.version}.")
    return net


def active(db: Session) -> list[AddressRule]:
    """The rules in force now: not removed, not expired."""
    now = utc_now_ms()
    return list(db.scalars(
        select(AddressRule).where(AddressRule.removed_at.is_(None), or_(AddressRule.expires_at.is_(None), AddressRule.expires_at > now))
        .order_by(AddressRule.created_at.desc())
    ))


def block_until(days: int):
    return utc_now_ms() + timedelta(days=days)


# --- the website's limits, in its Redis -----------------------------------------------


@dataclass(frozen=True)
class Limited:
    # "scope:digest:window": what clearing names.
    key: str
    scope: str
    ip: str
    hits: int
    resets_in_seconds: int


def _prefix(kind: str) -> str:
    return f"{settings.APP_ENV}:{kind}:"


def limited_now() -> list[Limited] | None:
    """The addresses a website limit is refusing now, longest to go first;
    None if there is no shared store (each process counts itself)."""
    store = counter_store()
    if store is None:
        return None
    ip_prefix, rl_prefix = _prefix("rl-ip"), _prefix("rl")

    def scan(r) -> list[Limited]:
        found = []
        for raw in r.scan_iter(match=ip_prefix + "*", count=500):
            key = raw.decode() if isinstance(raw, bytes) else raw
            rest = key[len(ip_prefix):]
            if not LIMIT_KEY.match(rest):
                continue
            ip, hits, ttl = r.get(key), r.get(rl_prefix + rest), r.pttl(key)
            if ip is None or ttl is None or ttl <= 0:
                continue
            found.append(Limited(rest, rest.split(":")[0], ip.decode() if isinstance(ip, bytes) else ip, int(hits or 0), -(-int(ttl) // 1000)))
        return found

    try:
        return sorted(call(store, scan), key=lambda x: -x.resets_in_seconds)
    except StoreUnavailable as err:
        log_event(logging.ERROR, "ratelimit.store_unavailable", scope="address-limits", error=str(err))
        raise


def clear(key: str) -> Limited | None:
    """Lifts one website limit at once. Returns what it held, or None if it
    had already expired."""
    if not LIMIT_KEY.match(key):
        raise RangeRefused("Not a limit key.")
    store = counter_store()
    if store is None:
        return None
    ip_key, rl_key = _prefix("rl-ip") + key, _prefix("rl") + key

    def take(r) -> Limited | None:
        ip, hits = r.get(ip_key), r.get(rl_key)
        r.delete(ip_key, rl_key)
        if ip is None:
            return None
        return Limited(key, key.split(":")[0], ip.decode() if isinstance(ip, bytes) else ip, int(hits or 0), 0)

    return call(store, take)
