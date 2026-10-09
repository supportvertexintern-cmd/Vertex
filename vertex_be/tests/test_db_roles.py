"""deploy/db-roles.sql gives each service the least privilege it needs.

Applies the script to the (migrated) test database — with empty passwords, so
no real credentials change — then checks, as each role, what it can and
can't do. Every "can't" must fail with insufficient_privilege (42501), not
some unrelated error.
"""

import re
from collections.abc import Iterator

import pytest
from sqlalchemy import Connection, text
from sqlalchemy.exc import DBAPIError

from app.core.config import BASE_DIR
from app.db.session import engine

INSUFFICIENT_PRIVILEGE = "42501"


@pytest.fixture(scope="module", autouse=True)
def roles_provisioned() -> None:
    sql = (BASE_DIR / "deploy" / "db-roles.sql").read_text(encoding="utf-8")
    sql = re.sub(r"^\\set .*$", "", sql, flags=re.M)  # psql-only directive
    sql = re.sub(r":'(migrator|api|web|readonly)_pw'", "''", sql)  # keep passwords as-is
    # Straight to psycopg2 with no parameters, so the script's own format()
    # placeholders (%I, %L) aren't taken for bind parameters.
    raw = engine.raw_connection()
    try:
        raw.driver_connection.autocommit = True
        raw.driver_connection.cursor().execute(sql)
    finally:
        raw.driver_connection.autocommit = False
        raw.close()


@pytest.fixture
def conn() -> Iterator[Connection]:
    with engine.connect() as c:
        trans = c.begin()
        try:
            yield c
        finally:
            trans.rollback()


def run_as(conn: Connection, role: str, sql: str) -> str | None:
    """Runs sql as role inside a savepoint; returns the SQLSTATE on failure."""
    savepoint = conn.begin_nested()
    try:
        conn.execute(text(f"SET LOCAL ROLE {role}"))
        conn.execute(text(sql))
        return None
    except DBAPIError as exc:
        return getattr(exc.orig, "pgcode", "unknown")
    finally:
        savepoint.rollback()


RUNTIME_ROLES = ["vertex_api", "vertex_web"]


@pytest.mark.parametrize("role", RUNTIME_ROLES)
def test_runtime_roles_can_read_and_write_rows(conn, role):
    assert run_as(conn, role, 'SELECT count(*) FROM "User"') is None
    assert run_as(conn, role, """INSERT INTO "Region" (id, name) VALUES ('ctest-role-region', 'Role test')""") is None
    assert run_as(conn, role, """INSERT INTO "AuditLog" (id, entity_type, entity_id, action)
                                 VALUES ('ctest-role-audit', 'test', 'x', 'CREATE')""") is None


@pytest.mark.parametrize("role", RUNTIME_ROLES)
@pytest.mark.parametrize(
    "sql",
    [
        "CREATE TABLE role_probe (id int)",
        'ALTER TABLE "User" ADD COLUMN role_probe int',
        'DROP TABLE "Region"',
        'TRUNCATE "Region"',
        'CREATE INDEX role_probe_idx ON "User" (email)',
        'UPDATE "AuditLog" SET action = action',
        'DELETE FROM "AuditLog"',
        'TRUNCATE "AuditLog"',
        "SELECT * FROM alembic_version",
        "UPDATE alembic_version SET version_num = version_num",
        "CREATE ROLE role_probe",
        "CREATE DATABASE role_probe",
        "CREATE SCHEMA role_probe",
    ],
)
def test_runtime_roles_cannot_do_admin_or_destructive_work(conn, role, sql):
    if sql.startswith("CREATE DATABASE"):
        # Not allowed inside a transaction at all; the role attribute is what
        # matters, and it can't be checked with SET ROLE in a transaction.
        rolcreatedb = conn.execute(text("SELECT rolcreatedb FROM pg_roles WHERE rolname = :r"), {"r": role}).scalar()
        assert rolcreatedb is False
        return
    assert run_as(conn, role, sql) == INSUFFICIENT_PRIVILEGE


def test_readonly_role_can_read_rows(conn):
    assert run_as(conn, "vertex_readonly", 'SELECT count(*) FROM "User"') is None
    assert run_as(conn, "vertex_readonly", 'SELECT count(*) FROM "AuditLog"') is None


@pytest.mark.parametrize(
    "sql",
    [
        """INSERT INTO "Region" (id, name) VALUES ('ctest-readonly', 'x')""",
        'UPDATE "User" SET full_name = full_name',
        'DELETE FROM "Region"',
        'TRUNCATE "Region"',
        """INSERT INTO "AuditLog" (id, entity_type, entity_id, action) VALUES ('ctest-ro', 't', 'x', 'CREATE')""",
        "CREATE TABLE role_probe (id int)",
        'ALTER TABLE "User" ADD COLUMN role_probe int',
        "CREATE ROLE role_probe",
    ],
)
def test_readonly_role_cannot_change_anything(conn, sql):
    assert run_as(conn, "vertex_readonly", sql) == INSUFFICIENT_PRIVILEGE


@pytest.mark.parametrize("role", [*RUNTIME_ROLES, "vertex_migrator", "vertex_readonly"])
def test_no_role_has_special_attributes(conn, role):
    row = conn.execute(
        text("SELECT rolsuper, rolcreaterole, rolcreatedb, rolreplication, rolbypassrls FROM pg_roles WHERE rolname = :r"),
        {"r": role},
    ).one()
    assert not any(row), f"{role} has special attributes: {row}"


def test_migrator_owns_the_schema_and_can_run_ddl(conn):
    not_owned = conn.execute(
        text("""SELECT count(*) FROM pg_class
                WHERE relnamespace = 'public'::regnamespace AND relkind IN ('r', 'p', 'v', 'm')
                  AND relowner <> 'vertex_migrator'::regrole""")
    ).scalar()
    assert not_owned == 0
    assert run_as(conn, "vertex_migrator", "CREATE TABLE role_probe (id int)") is None
    assert run_as(conn, "vertex_migrator", 'ALTER TABLE "Region" ADD COLUMN role_probe int') is None


def test_audit_log_stays_immutable_even_for_the_owner(conn):
    # The migrator owns AuditLog, but the triggers still refuse changes.
    conn.execute(text("""INSERT INTO "AuditLog" (id, entity_type, entity_id, action)
                         VALUES ('ctest-immutable', 'test', 'x', 'CREATE')"""))
    assert run_as(conn, "vertex_migrator", """UPDATE "AuditLog" SET action = 'UPDATE' WHERE id = 'ctest-immutable'""") == "P0001"
