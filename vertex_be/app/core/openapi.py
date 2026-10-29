"""How the interactive docs (/docs) authenticate, so routes can be tried
from Swagger UI with the same credentials Next.js sends (zero-trust §6):

- "session": a signed-in user's session token, sent as
  `Authorization: Bearer <token>`. It's the website's auth_token cookie
  (browser dev tools, Application > Cookies, while signed in); it lasts
  as long as the website's session and FastAPI checks it is still live.
- "service": Next.js's own credential, the X-Vertex-Service header, for the
  routes only Next.js may call. `python scripts/service_token.py` prints one
  from SERVICE_AUTH_SECRET, valid for five minutes.

Each operation lists the scheme its guard needs, read from the same
dependency tree default deny checks (app/core/access.py), so the docs can't
claim less than the route enforces. Swagger UI sends every scheme an
operation lists that has been authorized ("Authorize", top right).
"""

from __future__ import annotations

from typing import Any

from fastapi import FastAPI
from fastapi.openapi.utils import get_openapi

from app.core.access import _calls, iter_api_routes
from app.core.auth import SERVICE_HEADER, calling_service, current_user, optional_user

SECURITY_SCHEMES: dict[str, dict[str, Any]] = {
    "session": {
        "type": "http",
        "scheme": "bearer",
        "bearerFormat": "JWT",
        "description": "A signed-in user's session: the website's auth_token cookie.",
    },
    "service": {
        "type": "apiKey",
        "in": "header",
        "name": SERVICE_HEADER,
        "description": "Next.js's own credential: `python scripts/service_token.py` prints one (five minutes).",
    },
}


def security_for(calls: set[Any]) -> list[dict[str, list[str]]] | None:
    """The OpenAPI security requirements for a route's dependencies; None
    for a public route. Alternatives are listed separately."""
    if calling_service in calls:
        # A service route may also carry the user it acts for.
        return [{"service": []}, {"service": [], "session": []}] if optional_user in calls else [{"service": []}]
    if current_user in calls:
        return [{"session": []}]
    return None


def install(app: FastAPI) -> None:
    def openapi() -> dict[str, Any]:
        if app.openapi_schema:
            return app.openapi_schema
        schema = get_openapi(title=app.title, version=app.version, routes=app.routes, description=app.description)
        schema.setdefault("components", {})["securitySchemes"] = SECURITY_SCHEMES
        for path, route in iter_api_routes(app.routes):
            security = security_for(_calls(route.dependant))
            operations = schema["paths"].get(path, {})
            for method in route.methods:
                operation = operations.get(method.lower())
                if operation is not None and security is not None:
                    operation["security"] = security
        app.openapi_schema = schema
        return schema

    app.openapi = openapi  # type: ignore[method-assign]
