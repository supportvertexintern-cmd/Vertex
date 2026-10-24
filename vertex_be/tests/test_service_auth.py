"""Next.js's own credential when it calls FastAPI (gap G18, zero-trust §6):
app/core/tokens.py verifies it, default deny refuses a bad one on any route,
and calling_service guards routes only Next.js may call. It never stands in
for a user: user routes still need the user's session."""

import time

import jwt
import pytest
from fastapi import Depends
from fastapi.testclient import TestClient

from app.core import access, auth, tokens
from app.core.config import Settings, settings
from app.core.tokens import InvalidToken, ServiceClaims, key_for, verify_service_token
from app.main import create_app
from tests.node_session_vectors import SECRET as JWT_TEST_SECRET

SERVICE_SECRET = "test-only-service-secret-0123456789abcdef"  # gitleaks:allow
# Derived in Node with jwt.ts's scheme: hkdfSync("sha256", SERVICE_SECRET,
# "vertex-token-keys", "vertex/jwt/service/v1", 32).
SERVICE_KEY_HEX = "0c2c24200ded280b7a6f422f115040dedc1e54e90c4b8a03a27e600aa31a8e37"  # gitleaks:allow
OLD_SECRET = "test-only-previous-service-secret-0123456789"  # gitleaks:allow


@pytest.fixture(autouse=True)
def service_secret(monkeypatch):
    monkeypatch.setattr(settings, "SERVICE_AUTH_SECRET", SERVICE_SECRET)
    monkeypatch.setattr(settings, "SERVICE_AUTH_SECRET_PREVIOUS", None)


def service_token(*, secret=SERVICE_SECRET, lifetime=60, purpose="service", **overrides) -> str:
    now = int(time.time())
    claims = {"sub": "vertex-web", "scope": "backend", "iat": now, "exp": now + lifetime,
              "iss": "vertex-web", "aud": f"vertex:{purpose}", **overrides}
    claims = {k: v for k, v in claims.items() if v is not None}
    return jwt.encode(claims, key_for(purpose, secret), algorithm="HS256")


def test_the_service_key_matches_node():
    assert key_for("service", SERVICE_SECRET).hex() == SERVICE_KEY_HEX


def test_a_valid_token_is_accepted():
    assert verify_service_token(service_token()) == ServiceClaims(service="vertex-web", scope="backend")


@pytest.mark.parametrize(
    "token",
    [
        pytest.param(lambda: service_token(secret="x" * 40), id="another secret"),
        pytest.param(lambda: jwt.encode({"sub": "vertex-web", "scope": "backend", "iat": int(time.time()), "exp": int(time.time()) + 60,
                                         "iss": "vertex-web", "aud": "vertex:service"}, key_for("session", JWT_TEST_SECRET), algorithm="HS256"),
                     id="keyed from JWT_SECRET"),
        pytest.param(lambda: service_token(purpose="session"), id="another purpose's audience"),
        pytest.param(lambda: service_token(sub="someone-else"), id="another service"),
        pytest.param(lambda: service_token(sub=None), id="no subject"),
        pytest.param(lambda: service_token(scope="admin"), id="another scope"),
        pytest.param(lambda: service_token(scope=None), id="no scope"),
        pytest.param(lambda: service_token(iss="evil"), id="another issuer"),
        pytest.param(lambda: service_token(lifetime=3600), id="lives an hour"),
        pytest.param(lambda: service_token(iat=int(time.time()) - 120, exp=int(time.time()) - 60), id="expired"),
        pytest.param(lambda: service_token(exp=None), id="no expiry"),
        pytest.param(lambda: jwt.encode({"sub": "vertex-web"}, "x", algorithm="HS512"), id="another algorithm"),
        pytest.param(lambda: "not-a-jwt", id="garbage"),
    ],
)
def test_bad_tokens_are_refused(token):
    with pytest.raises(InvalidToken):
        verify_service_token(token())


def test_no_secret_configured_means_no_token_verifies(monkeypatch):
    token = service_token()
    monkeypatch.setattr(settings, "SERVICE_AUTH_SECRET", None)
    with pytest.raises(InvalidToken):
        verify_service_token(token)


def test_the_previous_secret_still_verifies_during_a_rotation(monkeypatch):
    old = service_token(secret=OLD_SECRET)
    with pytest.raises(InvalidToken):
        verify_service_token(old)
    monkeypatch.setattr(settings, "SERVICE_AUTH_SECRET_PREVIOUS", OLD_SECRET)
    assert verify_service_token(old).service == "vertex-web"
    assert verify_service_token(service_token()).service == "vertex-web"


# Routes: one only Next.js may call, on the real default-deny app.
probe = create_app()


@probe.get("/api/v1/probe/internal")
def internal(caller: ServiceClaims = Depends(auth.calling_service)):
    return {"data": {"service": caller.service}}


client = TestClient(probe)


def svc(token: str) -> dict[str, str]:
    return {auth.SERVICE_HEADER: token}


def test_a_service_only_route_counts_as_guarded():
    routes = dict(access.iter_api_routes(probe.routes))
    assert access.is_guarded(routes["/api/v1/probe/internal"])


def test_a_service_only_route_admits_next_js():
    res = client.get("/api/v1/probe/internal", headers=svc(service_token()))
    assert (res.status_code, res.json()) == (200, {"data": {"service": "vertex-web"}})


@pytest.mark.parametrize("headers", [{}, svc("not-a-jwt"), svc(service_token(secret="x" * 40))], ids=["none", "garbage", "wrong secret"])
def test_a_service_only_route_refuses_anyone_else(headers):
    res = client.get("/api/v1/probe/internal", headers=headers)
    assert res.status_code == 401
    assert res.json()["error"]["code"] == "unauthorized"


def test_a_user_session_does_not_open_a_service_only_route():
    assert client.get("/api/v1/probe/internal", headers={"Authorization": "Bearer anything"}).status_code == 401


def test_a_bad_service_token_is_refused_even_on_a_public_route(caplog):
    assert client.get("/api/v1/health").status_code == 200
    assert client.get("/api/v1/health", headers=svc("not-a-jwt")).status_code == 401


def test_a_service_token_alone_does_not_open_a_user_route():
    # FastAPI decides what the user may do; Next.js vouching for the call
    # is not a session.
    assert client.get("/api/v1/me", headers=svc(service_token())).status_code == 401


def test_deployed_environments_need_a_separate_service_secret(monkeypatch):
    base = {"APP_ENV": "staging", "DATABASE_URL": "postgresql://x@y/z", "SECRET_KEY": "k" * 40, "JWT_SECRET": "j" * 40}
    with pytest.raises(ValueError, match="SERVICE_AUTH_SECRET"):
        Settings(**base, _env_file=None)
    with pytest.raises(ValueError, match="differ"):
        Settings(**base, SERVICE_AUTH_SECRET="j" * 40, _env_file=None)
    assert Settings(**base, SERVICE_AUTH_SECRET="s" * 40, _env_file=None).SERVICE_AUTH_SECRET == "s" * 40


def test_the_token_module_mirrors_jwt_ts_versions():
    assert tokens.KEY_VERSION["service"] == 1
