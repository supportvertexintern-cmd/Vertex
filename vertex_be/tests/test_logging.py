"""Phase 10: structured logs, request correlation and redaction."""

import json
import logging

import pytest

from app.core.logging import JsonFormatter, log_event, redact, resolve_request_id


@pytest.fixture
def lines():
    """Log lines the app writes during the test, parsed."""
    records: list[logging.LogRecord] = []

    class Capture(logging.Handler):
        def emit(self, record: logging.LogRecord) -> None:
            records.append(record)

    handler = Capture()
    root = logging.getLogger()
    root.addHandler(handler)
    formatter = JsonFormatter("backend", "test")
    try:
        yield lambda: [json.loads(formatter.format(r)) for r in records]
    finally:
        root.removeHandler(handler)


def test_a_well_formed_request_id_is_kept_and_echoed(client, lines):
    res = client.get("/api/v1/health", headers={"X-Request-ID": "trace-0123456789"})
    assert res.headers["x-request-id"] == "trace-0123456789"
    access = [entry for entry in lines() if entry["event"] == "http.request"]
    assert access[-1]["request_id"] == "trace-0123456789"
    assert access[-1]["path"] == "/api/v1/health"
    assert access[-1]["status"] == 200


@pytest.mark.parametrize("bad", ["short", "has space 123456", "x" * 200, "inject\nline-123456"])
def test_a_malformed_request_id_is_replaced(client, bad):
    res = client.get("/api/v1/health", headers={"X-Request-ID": bad.replace("\n", "%0A")})
    assert res.headers["x-request-id"] != bad
    assert len(res.headers["x-request-id"]) == 36  # a fresh UUID


def test_requests_without_an_id_get_one(client):
    a = client.get("/api/v1/health").headers["x-request-id"]
    b = client.get("/api/v1/health").headers["x-request-id"]
    assert a != b and len(a) == 36


def test_access_lines_leave_out_the_query_string(client, lines):
    client.get("/api/v1/health?token=abc.def.ghi&password=hunter2")
    access = [entry for entry in lines() if entry["event"] == "http.request"][-1]
    assert access["path"] == "/api/v1/health"
    assert "hunter2" not in json.dumps(access)


def test_credentials_are_redacted_by_key_and_by_shape():
    # Built at runtime so the secret scanner (rightly) doesn't flag a JWT-shaped literal.
    jwt = ".".join(["eyJhbGciOiJIUzI1NiJ9", "eyJ1c2VySWQiOiJ4In0", "c2lnbmF0dXJlLXZhbHVl"])
    out = redact(
        {
            "password": "hunter2",
            "nested": {"api_key": "k-123", "authorization": "Bearer abc"},
            "note": f"failed with token {jwt}",
            "error_text": "connect to postgresql://vertex_web:<DB_PASSWORD>@db:5432/vertex failed",
            "passport_number": "P1234567",
        }
    )
    text = json.dumps(out)
    for secret in ("hunter2", "k-123", "Bearer abc", jwt, "<DB_PASSWORD>"):
        assert secret not in text
    assert out["passport_number"] == "P1234567"  # not a credential
    assert out["error_text"] == "connect to postgresql://[redacted]@db:5432/vertex failed"


def test_the_formatter_never_raises():
    class Unprintable:
        def __str__(self) -> str:
            raise RuntimeError("boom")

    record = logging.LogRecord("vertex", logging.INFO, __file__, 1, "x", None, None)
    record.event = "test.unprintable"
    record.fields = {"value": Unprintable()}
    line = json.loads(JsonFormatter("backend", "test").format(record))
    assert line["event"] in ("test.unprintable", "log.format_failed")


def test_log_event_never_raises():
    log_event(logging.INFO, "test.event", value=object(), nested={"a": [1, {"b": 2}]})


def test_resolve_request_id():
    assert resolve_request_id("abc-1234-5678") == "abc-1234-5678"
    assert resolve_request_id(None) != resolve_request_id(None)
