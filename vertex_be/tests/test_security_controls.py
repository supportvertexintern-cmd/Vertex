"""Security controls proven on the backend (the QA, Security & Implementation
Guide, upstream staging; tools/traceability.py): no response carries a
stored credential, public endpoints send only public fields, and passwords,
session tokens and reset links never reach the logs."""

from __future__ import annotations

import logging
import secrets

import bcrypt
import pytest

from app.api.v1.jobs import PublicJobDetailOut, PublicJobOut
from app.core.config import settings
from app.services import login_lockout
from app.db.session import get_db
from app.main import app
from app.models.enums import Role
from app.models.identity import User
from tests.mail import token
from tests.test_service_auth import SERVICE_SECRET, service_token

# Stored credentials: what a response must never carry, whoever asks.
CREDENTIAL_FIELDS = {"password_hash", "token_hash"}
CREDENTIAL_SUFFIXES = ("_secret", "private_key")


def _response_schemas(spec: dict) -> set[str]:
    """Every schema any route answers with, followed through its references."""
    schemas = spec["components"]["schemas"]
    seen: set[str] = set()

    def visit(node) -> None:
        if isinstance(node, dict):
            ref = node.get("$ref")
            if ref:
                name = ref.rsplit("/", 1)[-1]
                if name not in seen:
                    seen.add(name)
                    visit(schemas.get(name, {}))
            for value in node.values():
                visit(value)
        elif isinstance(node, list):
            for value in node:
                visit(value)

    for path in spec["paths"].values():
        for operation in path.values():
            for response in (operation.get("responses") or {}).values():
                visit(response)
    return seen


@pytest.mark.proves("SEC-DB-007")
def test_no_response_carries_a_stored_credential():
    spec = app.openapi()
    leaks = []
    for name in _response_schemas(spec):
        for field in (spec["components"]["schemas"].get(name, {}).get("properties") or {}):
            if field in CREDENTIAL_FIELDS or field.endswith(CREDENTIAL_SUFFIXES):
                leaks.append(f"{name}.{field}")
    assert leaks == []
    assert len(_response_schemas(spec)) > 100  # the walk really reaches the API


@pytest.mark.proves("SEC-NEXT-004", "SEC-DB-007")
def test_public_job_endpoints_send_only_public_fields():
    internal = {"employer_client_id", "application_fee", "updated_at", "created_by", "created_by_id",
                "stripe_product_id", "stripe_price_id", "synced_amount_gbp", "deleted_at"}
    for model in (PublicJobOut, PublicJobDetailOut):
        assert internal.isdisjoint(model.model_fields), model.__name__


# --- the logs ------------------------------------------------------------------


@pytest.fixture
def api(db, client, monkeypatch):
    monkeypatch.setattr(settings, "SERVICE_AUTH_SECRET", SERVICE_SECRET)
    monkeypatch.setattr(settings, "SERVICE_AUTH_SECRET_PREVIOUS", None)
    monkeypatch.setattr(login_lockout, "_failures", {})
    app.dependency_overrides[get_db] = lambda: db
    yield client
    app.dependency_overrides.pop(get_db, None)


def svc() -> dict[str, str]:
    return {"X-Vertex-Service": service_token(), "X-Forwarded-For": "203.0.113.50", "User-Agent": "Probe/1.0"}


@pytest.mark.proves("SEC-DB-012")
def test_passwords_tokens_and_reset_links_never_reach_the_logs(api, db, caplog, sent_mail):
    password = f"Log-Probe-{secrets.token_hex(6)}"
    user = User(full_name="Log Probe", email=f"logprobe-{secrets.token_hex(4)}@test.invalid", role=Role.hr, email_verified=True,
                password_hash=bcrypt.hashpw(password.encode(), bcrypt.gensalt(4)).decode())
    db.add(user)
    db.flush()
    caplog.set_level(logging.DEBUG)

    wrong = api.post("/api/v1/auth/login", headers=svc(), json={"email": user.email, "password": password + "x", "client": "web"})
    assert wrong.status_code == 401
    signed_in = api.post("/api/v1/auth/login", headers=svc(), json={"email": user.email, "password": password, "client": "web"})
    assert signed_in.status_code == 200
    issued = signed_in.json()["data"]["session"]
    api.post("/api/v1/accounts/forgot-password", headers=svc(), json={"email": user.email})
    [reset] = [m for m in sent_mail if m.kind == "password_reset"]

    secrets_seen = [password, password + "x", issued["access_token"], issued["refresh_token"], token(reset)]
    logged = caplog.text
    assert "auth.login" in logged or "login" in logged  # the requests were logged
    for value in secrets_seen:
        assert value not in logged
