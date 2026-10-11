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
    # Same order as deploy.sh: the readonly column allowlist, then the roles.
    sql = (BASE_DIR / "deploy" / "readonly-columns.sql").read_text(encoding="utf-8") + "\n" + (
        BASE_DIR / "deploy" / "db-roles.sql"
    ).read_text(encoding="utf-8")
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


def test_only_the_web_service_reads_the_audit_trail(conn):
    # Phase 10: Next.js shows case history and runs the security monitor;
    # FastAPI may append to the trail but not read it.
    assert run_as(conn, "vertex_web", 'SELECT count(*) FROM "AuditLog"') is None
    assert run_as(conn, "vertex_api", 'SELECT count(*) FROM "AuditLog"') == INSUFFICIENT_PRIVILEGE


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
        'ALTER TABLE "AuditLog" DISABLE TRIGGER audit_log_no_update',
        'DROP TRIGGER audit_log_no_delete ON "AuditLog"',
        "CREATE OR REPLACE FUNCTION prevent_auditlog_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN OLD; END $$",
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


SECRET_NAME = r"(password|passwd|hash|token|secret|session|otp|mfa|salt|api_?key|private_?key|credential)"


def test_readonly_role_can_read_non_secret_columns(conn):
    assert run_as(conn, "vertex_readonly", 'SELECT count(*) FROM "User"') is None
    assert run_as(conn, "vertex_readonly", 'SELECT id, role FROM "User"') is None


def _classification() -> dict[tuple[str, str], str]:
    text_ = (BASE_DIR / "deploy" / "readonly-columns.sql").read_text(encoding="utf-8")
    rows = re.findall(r"^\s*\('([^']+)', '([^']+)',\s*'(grant|exclude)'\)[,;]", text_, re.M)
    return {(t, c): d for t, c, d in rows}


def test_every_column_is_classified_for_the_readonly_role(conn):
    # Allowlist gate: a migration that adds a column fails CI until someone
    # decides (in deploy/readonly-columns.sql) whether pgAdmin may read it.
    schema = {
        (t, c)
        for t, c in conn.execute(
            text("""SELECT table_name, column_name FROM information_schema.columns
                    WHERE table_schema = 'public'
                      AND table_name NOT IN ('alembic_version', '_prisma_migrations')""")
        ).all()
    }
    classified = set(_classification())
    assert sorted(f"{t}.{c}" for t, c in schema - classified) == [], "classify in deploy/readonly-columns.sql"
    assert sorted(f"{t}.{c}" for t, c in classified - schema) == [], "stale rows in deploy/readonly-columns.sql"


def test_readonly_role_reads_exactly_the_granted_columns(conn):
    granted = {k for k, d in _classification().items() if d == "grant"}
    readable = {
        (t, c)
        for t, c in conn.execute(
            text("""SELECT table_name, column_name FROM information_schema.column_privileges
                    WHERE grantee = 'vertex_readonly' AND privilege_type = 'SELECT'""")
        ).all()
    }
    assert readable == granted
    assert [f"{t}.{c}" for t, c in granted if re.search(SECRET_NAME, c, re.I) or t == "AuditLog"] == []
    assert run_as(conn, "vertex_readonly", 'SELECT id, name FROM "Region"') is None


@pytest.mark.parametrize(
    "sql",
    [
        'SELECT password_hash FROM "User"',
        'SELECT email FROM "User"',  # personal data: excluded in the allowlist
        'SELECT date_of_birth, passport_number FROM "Candidate"',
        'SELECT * FROM "User"',  # * includes password_hash
        'SELECT count(*) FROM "AuditLog"',  # personal-data snapshots
        "SELECT * FROM alembic_version",
        'SELECT stripe_checkout_session_id FROM "CasePayment"',
    ],
)
def test_readonly_role_cannot_read_secrets_or_audit_log(conn, sql):
    assert run_as(conn, "vertex_readonly", sql) == INSUFFICIENT_PRIVILEGE


def test_readonly_role_has_no_secret_columns_table_grants_or_default_privileges(conn):
    # Generic: whatever tables exist, no secret-looking column is readable...
    readable = conn.execute(
        text("""SELECT table_name, column_name FROM information_schema.column_privileges
                WHERE grantee = 'vertex_readonly' AND privilege_type = 'SELECT'""")
    ).all()
    assert readable, "vertex_readonly should be able to read something"
    leaked = [f"{t}.{c}" for t, c in readable if re.search(SECRET_NAME, c, re.I) or t == "AuditLog"]
    assert leaked == []
    # ...access is column by column, never whole tables...
    table_grants = conn.execute(
        text("""SELECT count(*) FROM information_schema.table_privileges
                WHERE grantee = 'vertex_readonly' AND privilege_type = 'SELECT'""")
    ).scalar()
    assert table_grants == 0
    # ...and nothing becomes readable automatically.
    default_acl = conn.execute(
        text("SELECT count(*) FROM pg_default_acl WHERE defaclacl::text LIKE '%vertex_readonly%'")
    ).scalar()
    assert default_acl == 0


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
