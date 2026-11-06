"""What the seeds share (reads handover R8: the website has no database).

A seed takes a Session, so the tests run it inside their own transaction.
Run from vertex_be/ with DATABASE_URL set explicitly, as the schema owner:
this never reads the backend's .env, so it can't reach a database by accident.
"""

from __future__ import annotations

import os
import sys
from collections.abc import Callable
from pathlib import Path
from typing import Any, TypeVar

import bcrypt
from sqlalchemy import Executable, create_engine, select
from sqlalchemy.orm import Session

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from app.core.config import with_driver  # noqa: E402

HERE = Path(__file__).resolve().parent
M = TypeVar("M")


def database_url() -> str:
    url = os.environ.get("DATABASE_URL")
    if not url:
        raise SystemExit("Set DATABASE_URL to the database to seed.")
    return with_driver(url)


def run(seed: Callable[[Session], Any]) -> Any:
    """Runs one seed in one transaction: all of it or none of it."""
    engine = create_engine(database_url())
    try:
        with Session(engine) as db:
            result = seed(db)
            db.commit()
            return result
    finally:
        engine.dispose()


def hash_password(password: str, rounds: int = 12) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt(rounds)).decode()


def purge(db: Session, statement: Executable) -> None:
    """A DELETE in the database, its foreign keys deciding what cascades. A
    seed is test data written outside FastAPI and its audit trail
    (docs/architecture/data-ownership.md), so it goes around the ORM's guard
    against bulk changes on purpose."""
    db.connection().execute(statement)


def first(db: Session, model: type[M], **where: Any) -> M | None:
    return db.scalars(select(model).filter_by(**where)).first()


def upsert(db: Session, model: type[M], where: dict[str, Any], update: dict[str, Any] | None = None, create: dict[str, Any] | None = None) -> M:
    """The row matching `where`, given `update`, else a new one with `where`,
    `update` and `create`."""
    row = first(db, model, **where)
    if row is None:
        row = model(**where, **(update or {}), **(create or {}))
        db.add(row)
    else:
        for name, value in (update or {}).items():
            setattr(row, name, value)
    db.flush()
    return row
