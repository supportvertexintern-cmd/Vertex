"""API conventions (app/core/api.py): every error leaves as
{"error": {"code", "message", "details"?}}, never FastAPI's {"detail"},
and lists page like the Next.js API."""

from typing import Annotated

import pytest
from fastapi import Depends
from fastapi.testclient import TestClient
from pydantic import BaseModel, Field

from app.core.api import ApiError, Data, Page, PageParams, page_params
from app.core.rbac import require_role
from app.main import app, create_app
from app.models.enums import Role

probe = create_app()


class Item(BaseModel):
    name: str = Field(min_length=2)
    count: int


@probe.get("/api/v1/probe/item")
def item(_: Annotated[object, Depends(require_role(Role.admin))]) -> Data[Item]:
    return Data(data=Item(name="ok", count=1))


@probe.get("/api/v1/probe/missing")
def missing(_: Annotated[object, Depends(require_role(Role.admin))]):
    raise ApiError(404, "not_found", "Case not found.")


@probe.post("/api/v1/probe/items")
def create(body: Item, _: Annotated[object, Depends(require_role(Role.admin))]) -> Data[Item]:
    return Data(data=body)


@probe.get("/api/v1/probe/boom")
def boom(_: Annotated[object, Depends(require_role(Role.admin))]):
    raise RuntimeError("SELECT secret FROM users WHERE email = 'a@b.c'")


@probe.get("/api/v1/probe/page")
def paged(p: Annotated[PageParams, Depends(page_params)], _: Annotated[object, Depends(require_role(Role.admin))]) -> Page[int]:
    return Page(data=list(range(p.offset, p.offset + p.page_size)), total=1000, page=p.page, pageSize=p.page_size)


@pytest.fixture
def as_admin():
    """Requests pass the role check; the conventions are what's under test."""
    from app.core.auth import AuthUser, current_user

    probe.dependency_overrides[current_user] = lambda: AuthUser("u1", "a@test.invalid", Role.admin, "s1", 0)
    yield TestClient(probe, raise_server_exceptions=False)
    probe.dependency_overrides.clear()


def error(res) -> dict:
    body = res.json()
    assert set(body) == {"error"}, body
    assert {"code", "message"} <= set(body["error"]), body
    return body["error"]


def test_success_is_wrapped_in_data(as_admin):
    assert as_admin.get("/api/v1/probe/item").json() == {"data": {"name": "ok", "count": 1}}


def test_an_api_error_keeps_its_status_code_and_message(as_admin):
    res = as_admin.get("/api/v1/probe/missing")
    assert res.status_code == 404
    assert error(res) == {"code": "not_found", "message": "Case not found."}


def test_validation_errors_name_each_field_like_zod(as_admin):
    res = as_admin.post("/api/v1/probe/items", json={"name": "x"})
    assert res.status_code == 422
    err = error(res)
    assert (err["code"], err["message"]) == ("validation_error", "Validation failed")
    assert set(err["details"]) == {"name", "count"}
    assert all(isinstance(m, str) for msgs in err["details"].values() for m in msgs)


def test_a_body_that_is_not_json_is_400_invalid_json(as_admin):
    res = as_admin.post("/api/v1/probe/items", content=b"{not json", headers={"Content-Type": "application/json"})
    assert res.status_code == 400
    assert error(res)["code"] == "invalid_json"


def test_an_unexpected_error_is_500_without_its_text_and_keeps_the_request_id(as_admin):
    res = as_admin.get("/api/v1/probe/boom", headers={"X-Request-ID": "req-boom-12345"})
    assert res.status_code == 500
    assert error(res) == {"code": "internal_error", "message": "Something went wrong."}
    assert "secret" not in res.text
    assert res.headers["X-Request-ID"] == "req-boom-12345"
    assert res.headers["X-Content-Type-Options"] == "nosniff"


@pytest.mark.parametrize(
    ("query", "page", "page_size"),
    [
        ("", 1, 15),
        ("?page=3&pageSize=10", 3, 10),
        ("?page=0&pageSize=0", 1, 1),
        ("?page=-2&pageSize=5000", 1, 100),
    ],
)
def test_lists_page_and_clamp_like_next_js(as_admin, query, page, page_size):
    body = as_admin.get(f"/api/v1/probe/page{query}").json()
    assert (body["page"], body["pageSize"], body["total"], len(body["data"])) == (page, page_size, 1000, page_size)
    assert body["data"][0] == (page - 1) * page_size


def test_a_non_numeric_page_is_a_validation_error(as_admin):
    res = as_admin.get("/api/v1/probe/page?page=abc")
    assert res.status_code == 422
    assert "page" in error(res)["details"]


# The real app: framework errors are in the same shape.
client = TestClient(app)


def test_no_session_is_401_unauthorized_with_the_bearer_challenge():
    res = client.get("/api/v1/me")
    assert res.status_code == 401
    assert error(res)["code"] == "unauthorized"
    assert res.headers["WWW-Authenticate"] == "Bearer"


def test_a_role_checked_route_without_a_session_is_401():
    res = TestClient(probe).get("/api/v1/probe/item")
    assert res.status_code == 401
    assert error(res)["code"] == "unauthorized"


def test_the_wrong_role_is_403_forbidden():
    from app.core.auth import AuthUser, current_user

    probe.dependency_overrides[current_user] = lambda: AuthUser("u2", "m@test.invalid", Role.marketing, "s2", 0)
    try:
        res = TestClient(probe).get("/api/v1/probe/item")
    finally:
        probe.dependency_overrides.clear()
    assert res.status_code == 403
    assert error(res) == {"code": "forbidden", "message": "Forbidden. Insufficient role."}


def test_an_unknown_path_is_404_not_found():
    res = client.get("/api/v1/no-such-thing")
    assert res.status_code == 404
    assert error(res)["code"] == "not_found"


def test_a_wrong_method_is_405():
    res = client.post("/api/v1/health")
    assert res.status_code == 405
    assert error(res)["code"] == "method_not_allowed"


def test_health_keeps_its_own_shape_for_docker_and_the_deploy_scripts():
    assert "status" in client.get("/api/v1/health").json()


def test_no_response_uses_fastapis_detail_shape():
    for res in (client.get("/api/v1/me"), client.get("/api/v1/no-such-thing"), client.post("/api/v1/health")):
        assert "detail" not in res.json()
