"""Writes FastAPI's OpenAPI schema to vertex_be/openapi.json, the source of
the website's generated types (vertex/src/lib/api.generated.ts; auth
hardening plan D.3). Run after changing an endpoint, from vertex_be/:

    python scripts/export_openapi.py && (cd ../vertex && npm run api:types)

tests/test_openapi_snapshot.py fails while the file is stale, and the
website's CI job fails while the generated types are.
"""

import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("DATABASE_URL", "postgresql://unused@localhost/unused")

from app.main import app  # noqa: E402

OUT = Path(__file__).resolve().parents[1] / "openapi.json"


def schema_text() -> str:
    return json.dumps(app.openapi(), indent=1, sort_keys=True, ensure_ascii=False) + "\n"


if __name__ == "__main__":
    OUT.write_text(schema_text(), encoding="utf-8", newline="\n")
    print(f"wrote {OUT}")
