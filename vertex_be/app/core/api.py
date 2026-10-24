"""API conventions for every FastAPI route, the same shapes the Next.js API
returns, so one client (vertex/src/lib/apiError.ts, the Flutter app) reads
both services:

    success   {"data": ...}                                   Data[T]
    list      {"data": [...], "total", "page", "pageSize"}    Page[T]
    error     {"error": {"code", "message", "details"?}}      ApiError

Errors raised anywhere (ApiError, FastAPI/Starlette HTTP errors, request
validation, an unexpected exception) leave in the error shape, with the
request ID and security headers like any other response; nothing
returns FastAPI's {"detail": ...}. Validation errors are 422
validation_error with details {field: [reason, ...]}, like Zod's
flatten().fieldErrors; a body that isn't JSON is 400 invalid_json.

/health keeps its own shape: Docker and the deploy scripts read it.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any, Generic, TypeVar

from fastapi import FastAPI, Query, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.core.logging import log_event

T = TypeVar("T")

# Next.js routes clamp pageSize to their own MAX_PAGE_SIZE (100 or 200); 100
# is the common one. A route can pass its own limits to page_params.
DEFAULT_PAGE_SIZE = 15
MAX_PAGE_SIZE = 100


class Data(BaseModel, Generic[T]):
    data: T


class Page(BaseModel, Generic[T]):
    data: list[T]
    total: int
    page: int
    pageSize: int  # noqa: N815  (the Next.js field name)


@dataclass(frozen=True)
class PageParams:
    page: int
    page_size: int

    @property
    def offset(self) -> int:
        return (self.page - 1) * self.page_size


def page_params(
    page: int = Query(1),
    page_size: int = Query(DEFAULT_PAGE_SIZE, alias="pageSize"),
) -> PageParams:
    """?page=&pageSize=, clamped (not refused) as Next.js does."""
    return PageParams(page=max(1, page), page_size=min(MAX_PAGE_SIZE, max(1, page_size)))


class ApiError(Exception):
    """Raise from a route for a deliberate error: ApiError(404, "not_found", "Case not found.")."""

    def __init__(self, status_code: int, code: str, message: str, details: Any = None) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message
        self.details = details


def error_response(
    status_code: int, code: str, message: str, details: Any = None, headers: dict[str, str] | None = None
) -> JSONResponse:
    error: dict[str, Any] = {"code": code, "message": message}
    if details is not None:
        error["details"] = details
    return JSONResponse(status_code=status_code, content={"error": error}, headers=headers)


# Codes for HTTP errors raised without one (default deny, current_user,
# require_role, unknown paths), as the Next.js routes name them.
STATUS_CODES: dict[int, tuple[str, str]] = {
    400: ("bad_request", "Bad request."),
    401: ("unauthorized", "Unauthorized. Please log in."),
    403: ("forbidden", "Forbidden."),
    404: ("not_found", "Not found."),
    405: ("method_not_allowed", "Method not allowed."),
    409: ("conflict", "Conflict."),
    413: ("payload_too_large", "Request too large."),
    429: ("rate_limited", "Too many requests."),
}


def _field(loc: tuple[Any, ...]) -> str:
    # ("body", "items", 0, "name") -> "items.0.name"; ("query", "page") -> "page"
    parts = [str(p) for p in loc[1:]] if len(loc) > 1 else [str(p) for p in loc]
    return ".".join(parts) or "body"


async def _api_error(_request: Request, exc: ApiError) -> JSONResponse:
    return error_response(exc.status_code, exc.code, exc.message, exc.details)


async def _http_error(_request: Request, exc: StarletteHTTPException) -> JSONResponse:
    code, default = STATUS_CODES.get(exc.status_code, ("error", "Request failed."))
    message = exc.detail if isinstance(exc.detail, str) and exc.detail else default
    return error_response(exc.status_code, code, message, headers=getattr(exc, "headers", None))


async def _validation_error(_request: Request, exc: RequestValidationError) -> JSONResponse:
    errors = exc.errors()
    if any(e.get("type") == "json_invalid" for e in errors):
        return error_response(status.HTTP_400_BAD_REQUEST, "invalid_json", "Request body is not valid JSON.")
    details: dict[str, list[str]] = {}
    for e in errors:
        details.setdefault(_field(tuple(e.get("loc", ()))), []).append(str(e.get("msg", "Invalid value")))
    return error_response(status.HTTP_422_UNPROCESSABLE_CONTENT, "validation_error", "Validation failed", details)


class CatchUnexpectedErrors:
    """An unexpected exception becomes a 500 in the error shape. Middleware,
    not an exception handler: Starlette runs Exception handlers outermost,
    outside RequestContextMiddleware and SecurityHeadersMiddleware, so the
    500 would lose its request ID and security headers. Added innermost."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        started = False

        async def tracking_send(message: Message) -> None:
            nonlocal started
            if message["type"] == "http.response.start":
                started = True
            await send(message)

        try:
            await self.app(scope, receive, tracking_send)
        except Exception as exc:
            if started:
                raise
            # Never the exception's text: it can hold SQL or personal data.
            log_event(logging.ERROR, "api.unhandled_error", error=type(exc).__name__, path=scope.get("path"))
            response = error_response(status.HTTP_500_INTERNAL_SERVER_ERROR, "internal_error", "Something went wrong.")
            await response(scope, receive, send)


def install(app: FastAPI) -> None:
    """Error handlers and the 500 catcher; call before adding other middleware."""
    app.add_exception_handler(ApiError, _api_error)
    app.add_exception_handler(StarletteHTTPException, _http_error)
    app.add_exception_handler(RequestValidationError, _validation_error)
    app.add_middleware(CatchUnexpectedErrors)
