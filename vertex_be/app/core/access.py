"""Default deny for the FastAPI service (zero-trust policy §3).

Every API route is refused (401) unless it is either
  - registered below as public, with the reason it may be, or
  - protected by an authentication dependency listed in GUARDS.

The check runs as an app-wide dependency, before a route's own
dependencies, so a route that forgets its guard fails closed instead of
serving data (the way G1/G2 happened in the Next.js app). tests/
test_default_deny.py also fails CI on any route that is neither, and on
stale register entries.

GUARDS holds current_user (app/core/auth.py, G9): a route that depends on
it serves only a live Next.js session.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from fastapi import HTTPException, Request, status
from fastapi.dependencies.models import Dependant
from fastapi.routing import APIRoute

from app.core.auth import current_user

# "<METHOD> <path>": why it is public and what limits it.
PUBLIC_ENDPOINTS: dict[str, str] = {
    "GET /": "service name and links; no data",
    "GET /api/v1/health": "liveness and database reachability for Docker and verify-stack; no data",
}

# Framework routes that aren't API routes (interactive docs and the schema).
FRAMEWORK_ROUTES: set[str] = {"/docs", "/docs/oauth2-redirect", "/redoc", "/api/v1/openapi.json"}

# Authentication dependencies. A route whose dependency tree contains one of
# these is guarded: current_user (G9) verifies a Next.js session.
GUARDS: set[Callable[..., Any]] = {current_user}


def route_key(method: str, path: str) -> str:
    return f"{method.upper()} {path}"


def _calls(dependant: Dependant) -> set[Callable[..., Any]]:
    found: set[Callable[..., Any]] = set()
    for d in dependant.dependencies:
        if d.call is not None:
            found.add(d.call)
        found |= _calls(d)
    return found


def is_guarded(route: APIRoute) -> bool:
    return bool(_calls(route.dependant) & GUARDS)


def iter_api_routes(routes: list[Any], prefix: str = "") -> list[tuple[str, APIRoute]]:
    """Every API route with its full path. FastAPI 0.143 keeps included
    routers nested (_IncludedRouter), so this walks them; used by the tests."""
    found: list[tuple[str, APIRoute]] = []
    for r in routes:
        if isinstance(r, APIRoute):
            found.append((prefix + r.path, r))
        elif hasattr(r, "original_router"):
            inner = getattr(getattr(r, "include_context", None), "prefix", "") or ""
            found += iter_api_routes(r.original_router.routes, prefix + inner)
    return found


async def default_deny(request: Request) -> None:
    route = request.scope.get("route")
    if not isinstance(route, APIRoute):
        return
    # Public entries are static paths, so the concrete path is the key.
    if route_key(request.method, request.url.path) in PUBLIC_ENDPOINTS or is_guarded(route):
        return
    raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
