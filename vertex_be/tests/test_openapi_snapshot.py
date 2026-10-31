"""vertex_be/openapi.json is FastAPI's schema as it is now (auth hardening
plan D.3): the website's types (vertex/src/lib/api.generated.ts) are
generated from it, and its CI job fails if they differ. Regenerate both with
`python scripts/export_openapi.py && (cd ../vertex && npm run api:types)`."""

import importlib.util

from app.core.config import BASE_DIR


def test_the_committed_schema_is_current():
    spec = importlib.util.spec_from_file_location("export_openapi", BASE_DIR / "scripts" / "export_openapi.py")
    exporter = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(exporter)
    committed = (BASE_DIR / "openapi.json").read_text(encoding="utf-8")
    assert committed == exporter.schema_text(), "run: python scripts/export_openapi.py && (cd ../vertex && npm run api:types)"
