"""Tests run against a dedicated database (TEST_DATABASE_URL), never the dev
database. It's brought to `alembic upgrade head` once per session, so the
tests also prove the migrations apply cleanly."""

import os

# Never a stack's real database: run the suite via scripts/test.sh (a
# throwaway Postgres) locally, or with CI's disposable one.
TEST_DATABASE_URL = os.environ.get("TEST_DATABASE_URL")
if not TEST_DATABASE_URL:
    raise RuntimeError("TEST_DATABASE_URL is not set: run the tests with `sh scripts/test.sh`")
# Must happen before anything imports app.core.config. JWT_SECRET is the
# test-only secret the Node golden vectors were signed with, never a real
# one from vertex_be/.env.
os.environ["DATABASE_URL"] = TEST_DATABASE_URL
from tests.node_session_vectors import SECRET as TEST_JWT_SECRET  # noqa: E402

os.environ["JWT_SECRET"] = TEST_JWT_SECRET

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
