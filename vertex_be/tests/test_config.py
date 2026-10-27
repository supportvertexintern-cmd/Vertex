"""The database URLs name their driver, so a SQLAlchemy upgrade that changes
the default for postgresql:// (2.1 picked psycopg v3) can't break startup."""

import pytest

from app.core.config import Settings, settings, with_driver
from app.db.session import engine


@pytest.mark.parametrize(
    ("url", "expected"),
    [
        ("postgresql://u:p@db:5432/x", "postgresql+psycopg2://u:p@db:5432/x"),
        ("postgres://u@db/x", "postgresql+psycopg2://u@db/x"),
        ("postgresql+psycopg2://u@db/x", "postgresql+psycopg2://u@db/x"),
        ("postgresql+psycopg://u@db/x", "postgresql+psycopg://u@db/x"),
    ],
)
def test_with_driver(url, expected):
    assert with_driver(url) == expected


def test_both_urls_name_the_driver():
    s = Settings(DATABASE_URL="postgresql://api@db/x", MIGRATION_DATABASE_URL="postgresql://migrator@db/x")
    assert (s.DATABASE_URL, s.MIGRATION_DATABASE_URL) == ("postgresql+psycopg2://api@db/x", "postgresql+psycopg2://migrator@db/x")
    assert Settings(DATABASE_URL="postgresql://api@db/x").MIGRATION_DATABASE_URL is None


def test_the_app_connects_with_psycopg2():
    assert settings.DATABASE_URL.startswith("postgresql+psycopg2://")
    assert engine.dialect.driver == "psycopg2"
