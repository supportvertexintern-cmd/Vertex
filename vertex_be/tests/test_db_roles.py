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


def roles_sql() -> str:
    # Same order as deploy.sh: the readonly column allowlist, then the roles.
    sql = (BASE_DIR / "deploy" / "readonly-columns.sql").read_text(encoding="utf-8") + "\n" + (
        BASE_DIR / "deploy" / "db-roles.sql"
    ).read_text(encoding="utf-8")
    sql = re.sub(r"^\\set .*$", "", sql, flags=re.M)  # psql-only directive
    return re.sub(r":'(migrator|api|readonly)_pw'", "''", sql)  # keep passwords as-is


def apply_sql(sql: str) -> None:
    # Straight to psycopg2 with no parameters, so the script's own format()
    # placeholders (%I, %L) aren't taken for bind parameters.
    raw = engine.raw_connection()
    try:
        raw.driver_connection.autocommit = True
        raw.driver_connection.cursor().execute(sql)
    finally:
        raw.driver_connection.autocommit = False
        raw.close()


@pytest.fixture(scope="module", autouse=True)
def roles_provisioned() -> None:
    apply_sql(roles_sql())


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


RUNTIME_ROLES = ["vertex_api"]


@pytest.mark.parametrize("role", RUNTIME_ROLES)
def test_runtime_roles_can_read_rows(conn, role):
    assert run_as(conn, role, 'SELECT count(*) FROM "User"') is None


def test_the_websites_old_role_goes_with_its_grants(conn):
    # Reads handover R8. A stack deployed before it has the role, with grants
    # on the database, the schema and the tables, and default privileges;
    # any of them left behind would make DROP ROLE fail and stop the deploy.
    apply_sql("""
        DO $$ BEGIN
          EXECUTE format('CREATE ROLE vertex_web LOGIN; GRANT CONNECT, TEMPORARY ON DATABASE %I TO vertex_web', current_database());
        END $$;
        GRANT USAGE ON SCHEMA public TO vertex_web;
        GRANT SELECT ON ALL TABLES IN SCHEMA public TO vertex_web;
        GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO vertex_web;
        ALTER DEFAULT PRIVILEGES FOR ROLE vertex_migrator IN SCHEMA public GRANT SELECT ON TABLES TO vertex_web;
        ALTER DEFAULT PRIVILEGES FOR ROLE vertex_migrator IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO vertex_web;
    """)
    apply_sql(roles_sql())
    assert conn.scalar(text("SELECT count(*) FROM pg_roles WHERE rolname = 'vertex_web'")) == 0
    # A run with no such role does nothing (the deploy runs this every time).
    apply_sql(roles_sql())


def test_the_api_has_every_table_but_the_audit_trail(conn):
    # FastAPI is the only service with a database login, and the only writer.
    tables = set(conn.scalars(text("SELECT tablename FROM pg_tables WHERE schemaname = 'public'")))
    for table in tables - {"AuditLog", "alembic_version", "_prisma_migrations"}:
        ask = text("SELECT has_table_privilege('vertex_api', :t, 'SELECT, INSERT, UPDATE, DELETE')")
        assert conn.scalar(ask, {"t": f'public."{table}"'}) is True, table


def test_the_api_writes_rows(conn):
    assert run_as(conn, "vertex_api", """INSERT INTO "Region" (id, name) VALUES ('ctest-role-row', 'Role test')""") is None
    assert run_as(conn, "vertex_api", """INSERT INTO "User" (id, full_name, email, updated_at)
                                         VALUES ('ctest-role-row', 'Role test', 'role-row@test.invalid', now())""") is None


def test_no_runtime_role_reads_the_audit_trail(conn):
    # Phase 10: FastAPI may append to the trail but not read it; since reads
    # handover R5 and R7a it asks the functions of migrations 0008 and 0009.
    assert run_as(conn, "vertex_api", 'SELECT count(*) FROM "AuditLog"') == INSUFFICIENT_PRIVILEGE
    assert run_as(conn, "vertex_api", """INSERT INTO "AuditLog" (id, entity_type, entity_id, action) VALUES ('ctest-role-audit', 'test', 'x', 'CREATE')""") is None


def test_sessions_are_the_apis_alone(conn):
    # G19: refresh tokens belong to the service that signs users in, FastAPI
    # since users step 8.2, which checks every request against them.
    assert run_as(conn, "vertex_api", 'SELECT count(*) FROM "RefreshToken"') is None
    assert run_as(conn, "vertex_readonly", 'SELECT count(*) FROM "RefreshToken"') == INSUFFICIENT_PRIVILEGE


def test_only_the_api_may_ask_whether_a_session_is_live(conn):
    # G9: FastAPI verifies Next.js sessions through a yes/no function
    # (migration 0007), never by reading session rows.
    ask = "SELECT public.vertex_session_is_live('u', 'f')"
    assert run_as(conn, "vertex_api", ask) is None
    assert run_as(conn, "vertex_readonly", ask) == INSUFFICIENT_PRIVILEGE
    owner, public_can = conn.execute(
        text(
            "SELECT pg_get_userbyid(proowner), has_function_privilege('public', oid, 'EXECUTE') "
            "FROM pg_proc WHERE proname = 'vertex_session_is_live'"
        )
    ).one()
    assert public_can is False
    assert owner != "vertex_api"


@pytest.mark.parametrize(
    "ask",
    [
        "SELECT count(*) FROM public.vertex_case_trail('c')",
        "SELECT count(*) FROM public.vertex_rejection_dates('Candidate', ARRAY['c'])",
        "SELECT public.vertex_security_count('access_denied', 'actor_id', 'u', now()::timestamp)",  # R7a
        "SELECT count(*) FROM public.vertex_last_sign_ins(ARRAY['u'])",  # admin monitoring (0012)
        "SELECT count(*) FROM public.vertex_sign_in_history('u', 10)",
    ],
)
def test_only_the_api_may_ask_for_the_trail_it_shows(conn, ask):
    # Reads handover R5 (owner's decision 2026-11-02): FastAPI reads a
    # case's history and rejection dates through functions (migration 0008),
    # never AuditLog itself, whose snapshots hold personal data.
    assert run_as(conn, "vertex_api", ask) is None
    assert run_as(conn, "vertex_api", 'SELECT before FROM "AuditLog"') == INSUFFICIENT_PRIVILEGE
    assert run_as(conn, "vertex_readonly", ask) == INSUFFICIENT_PRIVILEGE
    for name in ("vertex_case_trail", "vertex_rejection_dates", "vertex_security_count", "vertex_last_sign_ins", "vertex_sign_in_history"):
        owner, public_can = conn.execute(
            text("SELECT pg_get_userbyid(proowner), has_function_privilege('public', oid, 'EXECUTE') FROM pg_proc WHERE proname = :n"), {"n": name}
        ).one()
        assert public_can is False
        assert owner != "vertex_api"


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
        'ALTER TABLE "User" DISABLE TRIGGER user_token_version_bump',
        "CREATE OR REPLACE FUNCTION bump_user_token_version() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$",
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


def test_deleting_a_country_clears_its_fee_policy(conn):
    # Countries are FastAPI's since step 2.1. ON DELETE SET NULL runs as
    # FeePolicy's owner, so the delete needs no write grant on FeePolicy.
    conn.execute(text("""INSERT INTO "Region" (id, name) VALUES ('ctest-fp-region', 'FP region')"""))
    conn.execute(text("""INSERT INTO "Country" (id, name, region_id) VALUES ('ctest-fp-country', 'FP country', 'ctest-fp-region')"""))
    conn.execute(text("""INSERT INTO "User" (id, full_name, email, updated_at) VALUES ('ctest-fp-user', 'FP', 'fp@test.invalid', now())"""))
    conn.execute(text("""INSERT INTO "FeePolicy" (id, country_id, updated_by, updated_at)
                         VALUES ('ctest-fp-policy', 'ctest-fp-country', 'ctest-fp-user', now())"""))
    savepoint = conn.begin_nested()
    try:
        conn.execute(text("SET LOCAL ROLE vertex_api"))
        conn.execute(text("""DELETE FROM "Country" WHERE id = 'ctest-fp-country'"""))
        conn.execute(text("RESET ROLE"))
        assert conn.execute(text("""SELECT country_id FROM "FeePolicy" WHERE id = 'ctest-fp-policy'""")).scalar() is None
    finally:
        savepoint.rollback()


def test_the_monitor_count_answers_only_its_four_questions(conn):
    # R7a: a number for the four pairs the alert rules use; anything else
    # is refused, so the function can't be used to read the trail.
    ask = "SELECT public.vertex_security_count(:a, :k, 'v', now()::timestamp)"
    for action, key in (("login_failed", "email_fp"), ("login_failed", "ip"), ("access_denied", "actor_id"), ("alert_raised", "entity_id")):
        assert conn.execute(text(ask), {"a": action, "k": key}).scalar() == 0
    savepoint = conn.begin_nested()
    with pytest.raises(DBAPIError, match="not a monitored count"):
        conn.execute(text(ask), {"a": "password_reset_requested", "k": "email_fp"})
    savepoint.rollback()
