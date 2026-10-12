"""Default deny for FastAPI (zero-trust policy §3, app/core/access.py): every
route is public by a reviewed decision or guarded; anything else is 401."""

from fastapi import Depends
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient

from app.core import access
from app.main import app, create_app


def keys(application):
    return {access.route_key(m, path): r for path, r in access.iter_api_routes(application.routes) for m in r.methods}


def test_the_walker_sees_the_routers_routes():
    assert "GET /api/v1/health" in keys(app)


def test_every_route_is_registered_public_or_guarded():
    unguarded = [k for k, r in keys(app).items() if k not in access.PUBLIC_ENDPOINTS and not access.is_guarded(r)]
    assert unguarded == [], "add an auth guard, or register the route in app/core/access.py"


def test_public_register_has_no_stale_entries():
    assert set(access.PUBLIC_ENDPOINTS) - set(keys(app)) == set()


def test_non_api_routes_are_known_framework_routes():
    others = {r.path for r in app.routes if not isinstance(r, APIRoute) and hasattr(r, "path")}
    assert others <= access.FRAMEWORK_ROUTES


def test_an_unregistered_route_is_refused_before_it_runs():
    probe = create_app()
    ran = []

    @probe.get("/api/v1/probe")
    def handler():
        ran.append(True)
        return {"secret": "data"}

    client = TestClient(probe)
    res = client.get("/api/v1/probe")
    assert res.status_code == 401
    assert ran == []
    assert client.get("/api/v1/health").status_code == 200


def test_a_route_with_a_registered_guard_is_let_through(monkeypatch):
    def fake_guard():
        return "user"

    monkeypatch.setattr(access, "GUARDS", {fake_guard})
    probe = create_app()

    @probe.get("/api/v1/mine")
    def mine(user: str = Depends(fake_guard)):
        return {"user": user}

    assert TestClient(probe).get("/api/v1/mine").json() == {"user": "user"}
