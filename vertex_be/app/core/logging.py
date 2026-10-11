"""Structured logs and request correlation (Phase 10).

One JSON object per line, the same shape as the Next.js service
(vertex/src/lib/log.ts):

    {"ts", "level", "service", "env", "event", "request_id", ...fields}

Every request gets an ID: the caller's X-Request-ID if well-formed,
otherwise a fresh UUID. It is returned on the response, attached to every
log line written while the request runs, and is the header any call to
another service must forward. Credentials are redacted from every line,
and logging never raises into the request.
"""

from __future__ import annotations

import contextvars
import json
import logging
import re
import sys
import time
import uuid
from datetime import UTC, datetime
from typing import Any

from starlette.types import ASGIApp, Message, Receive, Scope, Send

REQUEST_ID_HEADER = "x-request-id"
_VALID_REQUEST_ID = re.compile(r"^[A-Za-z0-9._:-]{8,128}$")

request_id_var: contextvars.ContextVar[str | None] = contextvars.ContextVar("request_id", default=None)

_SENSITIVE_KEY = re.compile(
    r"password|passwd|passphrase|(^|_)pass($|_)|secret|token|authorization|cookie|api[_-]?key"
    r"|private[_-]?key|credential|database_url|dsn|session",
    re.I,
)
_STRING_PATTERNS = [
    (re.compile(r"\b([a-z][a-z0-9+.-]*://)[^\s:/@]+:[^\s@/]+@", re.I), r"\1[redacted]@"),
    (re.compile(r"\bBearer\s+[A-Za-z0-9._~+/=-]+"), "Bearer [redacted]"),
    (re.compile(r"\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]+"), "[redacted-jwt]"),
    (re.compile(r"((?:auth_token|token|access_token|refresh_token|api_key|password)=)[^\s&;\"]+", re.I), r"\1[redacted]"),
]
REDACTED = "[redacted]"


def resolve_request_id(incoming: str | None) -> str:
    return incoming if incoming and _VALID_REQUEST_ID.match(incoming) else str(uuid.uuid4())


def redact_string(value: str) -> str:
    for pattern, replacement in _STRING_PATTERNS:
        value = pattern.sub(replacement, value)
    return value


def redact(value: Any, depth: int = 0) -> Any:
    if isinstance(value, str):
        return redact_string(value)
    if value is None or isinstance(value, bool | int | float):
        return value
    if depth > 8:
        return "[truncated]"
    if isinstance(value, dict):
        return {
            str(k): REDACTED if _SENSITIVE_KEY.search(str(k)) and value[k] not in (None, "") else redact(v, depth + 1)
            for k, v in value.items()
        }
    if isinstance(value, list | tuple | set):
        return [redact(v, depth + 1) for v in list(value)[:100]]
    if isinstance(value, BaseException):
        return {"name": type(value).__name__, "message": redact_string(str(value))}
    return redact_string(str(value))


class JsonFormatter(logging.Formatter):
    def __init__(self, service: str, env: str) -> None:
        super().__init__()
        self.service = service
        self.env = env

    def format(self, record: logging.LogRecord) -> str:
        try:
            fields = getattr(record, "fields", None) or {}
            line: dict[str, Any] = {
                "ts": datetime.fromtimestamp(record.created, UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
                "level": "alert" if record.levelno >= logging.CRITICAL else record.levelname.lower().replace("warning", "warn"),
                "service": self.service,
                "env": self.env,
                "event": getattr(record, "event", None) or f"{record.name}.message",
                "request_id": getattr(record, "request_id", None) or request_id_var.get(),
            }
            if not getattr(record, "event", None):
                line["message"] = record.getMessage()
            line.update(redact(fields))
            if record.exc_info:
                line["err"] = redact(record.exc_info[1])
            if isinstance(line.get("message"), str):
                line["message"] = redact_string(line["message"])
            return json.dumps(line, default=str)
        except Exception:  # noqa: BLE001 - a log line must never raise
            return json.dumps({"level": "error", "service": self.service, "event": "log.format_failed"})


def configure_logging(env: str, level: str = "INFO") -> None:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter("backend", env))
    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(level)
    # Its own level, so a later logging.config call (Alembic's, when
    # migrations run in-process) can't silence the application's lines.
    logging.getLogger("vertex").setLevel(level)
    # Uvicorn's own loggers go through the same format; its access log is
    # replaced by RequestContextMiddleware's (which leaves out query strings).
    for name in ("uvicorn", "uvicorn.error"):
        logging.getLogger(name).handlers = []
        logging.getLogger(name).propagate = True
    logging.getLogger("uvicorn.access").disabled = True


_log = logging.getLogger("vertex")


def log_event(level: int, event: str, **fields: Any) -> None:
    try:
        # The ID is taken now, not when a handler formats the line later.
        _log.log(level, event, extra={"event": event, "fields": fields, "request_id": request_id_var.get()})
    except Exception:  # noqa: BLE001
        pass


class RequestContextMiddleware:
    """Assigns the request ID, echoes it, and writes one access line per
    request (method, path without query string, status, duration)."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        incoming = None
        for name, value in scope.get("headers", []):
            if name.decode("latin-1").lower() == REQUEST_ID_HEADER:
                incoming = value.decode("latin-1")
                break
        request_id = resolve_request_id(incoming)
        token = request_id_var.set(request_id)
        status = 500
        start = time.perf_counter()

        async def send_with_id(message: Message) -> None:
            nonlocal status
            if message["type"] == "http.response.start":
                status = message["status"]
                headers = [(k, v) for k, v in message.get("headers", []) if k.lower() != REQUEST_ID_HEADER.encode()]
                headers.append((REQUEST_ID_HEADER.encode(), request_id.encode()))
                message["headers"] = headers
            await send(message)

        try:
            await self.app(scope, receive, send_with_id)
        finally:
            client = scope.get("client")
            log_event(
                logging.WARNING if status >= 500 else logging.INFO,
                "http.request",
                method=scope.get("method"),
                path=scope.get("path"),
                status=status,
                duration_ms=round((time.perf_counter() - start) * 1000, 1),
                client_ip=client[0] if client else None,
            )
            request_id_var.reset(token)
