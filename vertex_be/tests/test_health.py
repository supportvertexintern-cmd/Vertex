def test_health_reports_database_ok(client):
    res = client.get("/api/v1/health")
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "healthy"
    assert body["database"] == "ok"


def test_openapi_is_served_under_v1(client):
    assert client.get("/api/v1/openapi.json").status_code == 200


def test_api_responses_carry_security_headers(client):
    res = client.get("/api/v1/health")
    assert res.headers["x-content-type-options"] == "nosniff"
    assert res.headers["x-frame-options"] == "DENY"
    assert res.headers["content-security-policy"] == "default-src 'none'; frame-ancestors 'none'"


def test_docs_keep_working_without_the_api_csp(client):
    res = client.get("/docs")
    assert res.status_code == 200
    assert res.headers["x-content-type-options"] == "nosniff"
    assert "content-security-policy" not in res.headers
