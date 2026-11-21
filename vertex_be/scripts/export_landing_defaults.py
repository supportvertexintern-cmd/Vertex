"""Writes the website's landing blocks' built-in text (app/services/
landing_content.py) to vertex/src/server/services/landing.defaults.json.
The website shows it when FastAPI can't answer, so the home page, footer
and contact details never go blank. Run after changing a default or a
block, from vertex_be/:

    python scripts/export_landing_defaults.py

tests/test_landing_content.py fails while the file is stale.
"""

import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("DATABASE_URL", "postgresql://unused@localhost/unused")

from app.services.landing_content import BLOCK_VERSION, blocks_for  # noqa: E402

OUT = Path(__file__).resolve().parents[2] / "vertex" / "src" / "server" / "services" / "landing.defaults.json"


def defaults_text() -> str:
    blocks = {spec.key: spec.default for spec in blocks_for("web")}
    return json.dumps({"version": BLOCK_VERSION, "blocks": blocks}, indent=1, ensure_ascii=False) + "\n"


if __name__ == "__main__":
    OUT.write_text(defaults_text(), encoding="utf-8", newline="\n")
    print(f"wrote {OUT}")
