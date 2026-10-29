"""The interactive docs authenticate as the routes do (app/core/openapi.py):
every guarded operation lists the credential its guard checks, public ones
none, and the service token script signs a token FastAPI accepts."""

import subprocess
import sys

from app.core.access import PUBLIC_ENDPOINTS, _calls, iter_api_routes, route_key
from app.core.auth import calling_service, current_user
from app.core.config import BASE_DIR, settings
from app.core.tokens import verify_service_token
from app.main import app
from tests.test_service_auth import SERVICE_SECRET


def test_the_docs_offer_both_credentials():
    schemes = app.openapi()["components"]["securitySchemes"]
    assert schemes["session"] == {"type": "http", "scheme": "bearer", "bearerFormat": "JWT", "description": schemes["session"]["description"]}
    assert (schemes["service"]["type"], schemes["service"]["in"], schemes["service"]["name"]) == ("apiKey", "header", "X-Vertex-Service")


def test_every_operation_lists_what_its_guard_checks():
    paths = app.openapi()["paths"]
    checked = 0
    for path, route in iter_api_routes(app.routes):
        if not route.include_in_schema:
            continue
        calls = _calls(route.dependant)
        for method in route.methods:
            security = paths[path][method.lower()].get("security")
            if route_key(method, path) in PUBLIC_ENDPOINTS:
                assert security is None, path
            elif calling_service in calls:
                assert {"service": []} in security, path
                assert all("service" in requirement for requirement in security), path  # never a session alone
            else:
                assert current_user in calls, path
                assert security == [{"session": []}], path
            checked += 1
    assert checked > 50


def test_the_script_prints_a_token_fastapi_accepts(monkeypatch):
    monkeypatch.setattr(settings, "SERVICE_AUTH_SECRET", SERVICE_SECRET)
    monkeypatch.setattr(settings, "SERVICE_AUTH_SECRET_PREVIOUS", None)
    out = subprocess.run(
        [sys.executable, str(BASE_DIR / "scripts" / "service_token.py")],
        capture_output=True,
        text=True,
        env={"SERVICE_AUTH_SECRET": SERVICE_SECRET, "DATABASE_URL": settings.DATABASE_URL, "JWT_SECRET": settings.JWT_SECRET, "SYSTEMROOT": "C:\\Windows"},
        cwd=BASE_DIR,
        check=True,
    )
    claims = verify_service_token(out.stdout.strip())
    assert (claims.service, claims.scope) == ("vertex-web", "backend")
