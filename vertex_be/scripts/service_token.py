"""Prints a service token (Next.js's X-Vertex-Service credential) for trying
the service-only routes from /docs: "Authorize" > service. Valid for five
minutes, the longest FastAPI accepts (app/core/tokens.py).

    env/Scripts/python scripts/service_token.py   (from vertex_be/)

The secret comes from the environment or vertex_be/.env, else from the
repo-root .env that scripts/local-env.sh writes for the local stack.

Signed with SERVICE_AUTH_SECRET as lib/jwt.ts signs one. Anyone with that
secret can already sign these: this only saves doing it by hand. Never
point it at a deployed stack's secret on a shared machine.
"""

import sys
import time
from pathlib import Path

import jwt

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.core.config import settings  # noqa: E402
from app.core.tokens import ISSUER, SERVICE_TOKEN_MAX_LIFETIME, key_for  # noqa: E402

def _local_stack_secret() -> str | None:
    env = Path(__file__).resolve().parents[2] / ".env"
    if not env.is_file():
        return None
    for line in env.read_text(encoding="utf-8").splitlines():
        name, _, value = line.partition("=")
        if name.strip() == "SERVICE_AUTH_SECRET":
            return value.strip().strip('"').strip("'") or None
    return None


secret = settings.SERVICE_AUTH_SECRET or _local_stack_secret()
if not secret or len(secret) < 32:
    sys.exit("SERVICE_AUTH_SECRET isn't set (32+ characters) in vertex_be/.env or the environment.")
now = int(time.time())
claims = {"sub": ISSUER, "scope": "backend", "iat": now, "exp": now + SERVICE_TOKEN_MAX_LIFETIME, "iss": ISSUER, "aud": "vertex:service"}
print(jwt.encode(claims, key_for("service", secret), algorithm="HS256"))
