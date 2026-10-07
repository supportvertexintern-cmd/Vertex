def test_health_reports_database_ok(client):
    res = client.get("/api/v1/health")
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "healthy"
    assert body["database"] == "ok"


def test_openapi_is_served_under_v1(client):
    assert client.get("/api/v1/openapi.json").status_code == 200
