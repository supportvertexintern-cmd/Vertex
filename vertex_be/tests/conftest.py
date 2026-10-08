"""Tests run against a dedicated database (TEST_DATABASE_URL), never the dev
database. It's brought to `alembic upgrade head` once per session, so the
tests also prove the migrations apply cleanly."""

import os
from pathlib import Path

from dotenv import dotenv_values


def _default_test_database_url() -> str:
    """Local runs reuse the dev stack's credentials (from the gitignored .env)
    against its Postgres on localhost; CI sets TEST_DATABASE_URL instead."""
    env = dotenv_values(Path(__file__).resolve().parents[1] / ".env")
    try:
        user, password = env["POSTGRES_USER"], env["POSTGRES_PASSWORD"]
    except KeyError:
        raise RuntimeError("Set TEST_DATABASE_URL, or POSTGRES_USER/POSTGRES_PASSWORD in vertex_be/.env") from None
    return f"postgresql://{user}:{password}@localhost:5432/vertexdb_test"


TEST_DATABASE_URL = os.environ.get("TEST_DATABASE_URL") or _default_test_database_url()
# Must happen before anything imports app.core.config.
os.environ["DATABASE_URL"] = TEST_DATABASE_URL

from collections.abc import Iterator  # noqa: E402

import pytest  # noqa: E402
from alembic import command  # noqa: E402
from alembic.config import Config  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402

from app.core.config import BASE_DIR  # noqa: E402
from app.db.session import engine  # noqa: E402
from app.main import app  # noqa: E402


@pytest.fixture(scope="session", autouse=True)
def migrated_db() -> None:
    command.upgrade(Config(str(BASE_DIR / "alembic.ini")), "head")


@pytest.fixture
def db() -> Iterator[Session]:
    """A session whose work is always rolled back."""
    with engine.connect() as conn:
        trans = conn.begin()
        session = Session(bind=conn, join_transaction_mode="create_savepoint")
        try:
            yield session
        finally:
            session.close()
            trans.rollback()


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)
