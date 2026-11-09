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


def _test_session_keys() -> None:
    """A fresh TEST-ONLY session key pair per run, and a test-only link
    secret (session keys K3: no session or account link without them)."""
    import base64

    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import ec

    from tests.node_session_vectors import ACCOUNT_LINK_SECRET

    key = ec.generate_private_key(ec.SECP256R1())
    private = key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())
    public = key.public_key().public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo)
    os.environ["SESSION_PRIVATE_KEY"] = base64.b64encode(private).decode()
    os.environ["SESSION_PUBLIC_KEYS"] = base64.b64encode(public).decode()
    os.environ["ACCOUNT_LINK_SECRET"] = ACCOUNT_LINK_SECRET


_test_session_keys()
# No scheduled account checks in tests: they call run_account_checks().
os.environ["MONITOR_CHECKS_INTERVAL_MINUTES"] = "0"

from collections.abc import Iterator  # noqa: E402

import pytest  # noqa: E402
from alembic import command  # noqa: E402
from alembic.config import Config  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402

from app.core.audit import set_audit_actor  # noqa: E402
from app.core.config import BASE_DIR  # noqa: E402
from app.db.session import engine  # noqa: E402
from app.main import app  # noqa: E402
from app.services import emails  # noqa: E402
from app.services import email_limit, login_settings  # noqa: E402


@pytest.fixture(autouse=True)
def fresh_email_limit(monkeypatch: pytest.MonkeyPatch) -> None:
    """Each test starts with no account emails counted (the per-email limit
    counts in this process when there is no Redis), and with the login
    protection settings read afresh (a test may have saved others)."""
    monkeypatch.setattr(email_limit, "_sent", {})
    login_settings.forget()


@pytest.fixture(scope="session", autouse=True)
def migrated_db() -> None:
    command.upgrade(Config(str(BASE_DIR / "alembic.ini")), "head")


@pytest.fixture
def db() -> Iterator[Session]:
    """A session whose work is always rolled back."""
    with engine.connect() as conn:
        trans = conn.begin()
        session = Session(bind=conn, join_transaction_mode="create_savepoint")
        # Fixtures set up rows as the system; the audit trail records them.
        set_audit_actor(session, None)
        try:
            yield session
        finally:
            session.close()
            trans.rollback()


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


@pytest.fixture(autouse=True)
def sent_mail(monkeypatch: pytest.MonkeyPatch) -> list[emails.Mail]:
    """The emails FastAPI sends (app/services/emails.py), captured in line,
    never over SMTP."""
    sent: list[emails.Mail] = []
    monkeypatch.setattr(emails, "dispatch", lambda send: send())
    monkeypatch.setattr(emails, "_transmit", sent.append)
    return sent


@pytest.fixture
def sent_notices(monkeypatch: pytest.MonkeyPatch, sent_mail: list[emails.Mail]) -> list[dict]:
    """The notices FastAPI emailed, as the JSON `notify` would have carried
    them before it sent them itself (reads handover R7b)."""
    notices: list[dict] = []
    mail = emails._mail

    def recording(db, notice):
        notices.append(notice.model_dump(mode="json"))
        return mail(db, notice)

    monkeypatch.setattr(emails, "_mail", recording)
    return notices
