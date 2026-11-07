"""A stack's first admin, for one with no test accounts (deploy/seed-staging.sh).
The address and the password arrive on stdin, one line each, so the password is
never in an argument. A rerun leaves an existing account as it is: its password
may have been changed since.

    DATABASE_URL=... python -m scripts.seed.first_admin     (from vertex_be/)
"""

from __future__ import annotations

import sys

from sqlalchemy.orm import Session

from scripts.seed.common import hash_password, run, upsert

from app.models.enums import Role  # noqa: E402  (after common sets the path)
from app.models.identity import User  # noqa: E402


def seed(db: Session, email: str, password: str) -> User:
    return upsert(db, User, {"email": email}, None, {
        "full_name": "First Admin", "role": Role.admin, "password_hash": hash_password(password), "email_verified": True,
    })


if __name__ == "__main__":
    address, secret = sys.stdin.read().splitlines()[:2]
    run(lambda db: seed(db, address, secret))
    print(f"First admin ready: {address}")
