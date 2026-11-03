"""Security monitoring and alerts (Phase 10), moved from the website's
lib/security-monitor.ts in reads handover R7a (D3 A). Rules agreed with the
owner (2026-10-11): brute-force sign-ins, malware, authorization probing and
privilege grants, plus two operational ones: audit-trail write failures and
the malware scanner being unreachable (uploads accepted unscanned). E6
(2026-10-12) adds refresh-token reuse, a sign of a stolen session.

An alert is a log line at CRITICAL (event alert.raised), an `alert_raised`
row in the audit trail, and an email to SECURITY_ALERT_EMAILS
(comma-separated; default: every admin user). Each alert key fires at most
once per window: in this process, and across processes through the trail.
The counts come from vertex_security_count (migration 0009), since
vertex_api can't read the trail. Nothing here raises: a monitoring failure
is logged and never changes a request's outcome.
"""

from __future__ import annotations

import json
import logging
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any, Literal

from sqlalchemy import insert, select, text

from app.core.clock import utc_now_ms
from app.core.config import settings
from app.db.base import new_id
from app.core.logging import log_event, redact, request_id_var
from app.core.mailer import send_mail
from app.db.session import engine
from app.models.audit import AuditLog
from app.models.enums import Role
from app.models.identity import User


@dataclass(frozen=True)
class Rule:
    id: str
    severity: Literal["high", "critical"]
    window_minutes: int
    threshold: int


BRUTE_FORCE_ACCOUNT = Rule("brute_force_account", "high", 15, 10)
BRUTE_FORCE_IP = Rule("brute_force_ip", "high", 15, 20)
AUTHORIZATION_PROBING = Rule("authorization_probing", "high", 10, 20)
MALWARE = Rule("malware_detected", "critical", 60, 1)
PRIVILEGE_GRANTED = Rule("privilege_granted", "critical", 1, 1)
AUDIT_WRITE_FAILED = Rule("audit_write_failed", "critical", 15, 1)
SCANNER_UNAVAILABLE = Rule("malware_scanner_unavailable", "high", 60, 1)
REFRESH_TOKEN_REUSED = Rule("refresh_token_reused", "high", 15, 1)
RULES = (BRUTE_FORCE_ACCOUNT, BRUTE_FORCE_IP, AUTHORIZATION_PROBING, MALWARE, PRIVILEGE_GRANTED, AUDIT_WRITE_FAILED,
         SCANNER_UNAVAILABLE, REFRESH_TOKEN_REUSED)

def _in_background(send: Callable[[], None]) -> None:
    threading.Thread(target=send, daemon=True).start()


# The email goes out off the request, as the website's `void raiseAlert(...)`
# did, so a slow mail server never holds a request. Tests send in line.
dispatch: Callable[[Callable[[], None]], None] = _in_background

# Per-process dedupe, so a burst doesn't query the database per event and
# alerts still dedupe when the database is the thing that's failing.
_last_raised: dict[str, float] = {}


def _since(minutes: int) -> datetime:
    # The trail's times are UTC without a zone, as Prisma wrote them.
    return utc_now_ms() - timedelta(minutes=minutes)


def _count(action: str, key: str, value: str, minutes: int) -> int:
    with engine.connect() as conn:
        return int(conn.execute(
            text("SELECT public.vertex_security_count(:a, :k, :v, :s)"), {"a": action, "k": key, "v": value, "s": _since(minutes)}
        ).scalar() or 0)


def on_security_event(action: str, actor_id: str | None, entity_id: str, detail: dict[str, Any]) -> None:
    """Called once a security event is on the trail."""
    try:
        if action == "login_failed":
            fp, ip = detail.get("email_fp"), detail.get("ip")
            if isinstance(fp, str) and fp:
                r = BRUTE_FORCE_ACCOUNT
                n = _count(action, "email_fp", fp, r.window_minutes)
                if n >= r.threshold:
                    raise_alert(r, f"account:{fp}", f"{n} failed sign-ins for one account in {r.window_minutes} minutes",
                                {"email_fp": fp, "failures": n, "last_ip": ip})
            if isinstance(ip, str) and ip:
                r = BRUTE_FORCE_IP
                n = _count(action, "ip", ip, r.window_minutes)
                if n >= r.threshold:
                    raise_alert(r, f"ip:{ip}", f"{n} failed sign-ins from one address in {r.window_minutes} minutes", {"ip": ip, "failures": n})
        elif action == "access_denied" and actor_id:
            r = AUTHORIZATION_PROBING
            n = _count(action, "actor_id", actor_id, r.window_minutes)
            if n >= r.threshold:
                raise_alert(r, f"user:{actor_id}", f"{n} denied requests by one user in {r.window_minutes} minutes",
                            {"actor_id": actor_id, "denials": n, "last_path": detail.get("path")})
        elif action == "refresh_token_reused":
            raise_alert(REFRESH_TOKEN_REUSED, f"session:{entity_id}", "A spent refresh token was used again; the session was revoked",
                        {"actor_id": actor_id, "session": entity_id, "used_at": detail.get("used_at")})
        elif action in ("malware_rejected", "malware_blocked_download"):
            summary = "An uploaded file was infected and rejected" if action == "malware_rejected" else "A stored document was found infected and blocked"
            raise_alert(MALWARE, f"{action}:{entity_id}", summary, {"actor_id": actor_id, "entity_id": entity_id, "signature": detail.get("signature")})
    except Exception as err:  # noqa: BLE001
        log_event(logging.ERROR, "monitor.evaluate_failed", action=action, error=type(err).__name__)


def on_privilege_granted(actor_id: str | None, user_id: str, was: str | None, now: str) -> None:
    summary = f"A user was promoted from {was} to {now}" if was else f"An {now} account was created"
    raise_alert(PRIVILEGE_GRANTED, f"user:{user_id}", summary, {"actor_id": actor_id, "user_id": user_id, "from": was, "to": now})


def on_audit_write_failed(what: str, err: BaseException) -> None:
    # The trail itself is failing: no row (that's what's broken), just the
    # log line and the email.
    raise_alert(AUDIT_WRITE_FAILED, "audit", "Writing to the audit trail failed", {"operation": what, "error": type(err).__name__}, persist=False)


def on_scanner_unavailable(reason: str) -> None:
    raise_alert(SCANNER_UNAVAILABLE, "clamd", "The malware scanner is unreachable; uploads are being accepted unscanned", {"reason": reason})


def raise_alert(rule: Rule, key: str, summary: str, detail: dict[str, Any], *, persist: bool = True) -> bool:
    try:
        alert_key = f"{rule.id}:{key}"[:200]
        now = time.monotonic()
        window = rule.window_minutes * 60
        if _last_raised.get(alert_key, float("-inf")) > now - window:
            return False
        _last_raised[alert_key] = now
        request_id = request_id_var.get()
        clean = redact({**detail, "severity": rule.severity, "rule": rule.id, "summary": summary})

        if persist:
            try:
                if _count("alert_raised", "entity_id", alert_key, rule.window_minutes):
                    return False  # another process raised it
                with engine.begin() as conn:
                    conn.execute(insert(AuditLog.__table__), {
                        "id": new_id(), "entity_type": "SecurityAlert", "entity_id": alert_key, "action": "alert_raised",
                        "actor_id": None, "request_id": request_id, "after": clean,
                    })
            except Exception as err:  # noqa: BLE001
                log_event(logging.ERROR, "alert.persist_failed", rule=rule.id, error=type(err).__name__)

        log_event(logging.CRITICAL, "alert.raised", alert_key=alert_key, **clean)
        dispatch(lambda: _notify(rule, alert_key, summary, clean, request_id))
        return True
    except Exception as err:  # noqa: BLE001
        log_event(logging.ERROR, "alert.failed", rule=rule.id, error=type(err).__name__)
        return False


def _recipients() -> list[str]:
    configured = [a.strip() for a in (settings.SECURITY_ALERT_EMAILS or "").split(",") if a.strip()]
    if configured:
        return configured
    with engine.connect() as conn:
        return list(conn.execute(select(User.email).where(User.role == Role.admin)).scalars())


def _notify(rule: Rule, alert_key: str, summary: str, detail: dict[str, Any], request_id: str | None) -> None:
    try:
        if not settings.SMTP_HOST:
            log_event(logging.WARNING, "alert.email_skipped", rule=rule.id, reason="SMTP_HOST not set")
            return
        to = _recipients()
        if not to:
            log_event(logging.WARNING, "alert.email_skipped", rule=rule.id, reason="no recipients")
            return
        env = settings.APP_ENV
        lines = [
            f"{summary}.",
            "",
            f"Rule:        {rule.id} ({rule.severity})",
            f"Environment: {env}",
            f"Time:        {utc_now_ms().isoformat(timespec='milliseconds')}Z",
            f"Alert key:   {alert_key}",
            f"Request ID:  {request_id or '-'}",
            "",
            "Details:",
            *(f"  {k}: {v if isinstance(v, str) else json.dumps(v)}" for k, v in detail.items() if k not in ("summary", "severity", "rule")),
            "",
            f'Investigate: AuditLog rows with action "alert_raised" and entity_id "{alert_key}",',
            "and the application logs for the request ID above.",
            f"This alert won't repeat for {rule.window_minutes} minutes.",
        ]
        send_mail(to, f"[Vertex {env}] Security alert: {summary}", "\n".join(lines))
        log_event(logging.INFO, "alert.email_sent", rule=rule.id, recipients=len(to), request_id=request_id)
    except Exception as err:  # noqa: BLE001
        log_event(logging.ERROR, "alert.email_failed", rule=rule.id, error=type(err).__name__)


def reset_dedupe() -> None:
    """Test hook."""
    _last_raised.clear()
