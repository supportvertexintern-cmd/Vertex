-- Least-privilege database roles. Idempotent: deploy.sh runs it as the
-- superuser on every deploy, so grants can't drift.
--
--   vertex_migrator  owns the schema; used only by `alembic upgrade` (DDL)
--   vertex_api       FastAPI runtime: read/write rows, no DDL
--   vertex_web       Next.js/Prisma runtime: read/write rows, no DDL
--   vertex_readonly  people browsing data (pgAdmin): SELECT on allowlisted columns only
--
-- Neither runtime role can create/alter/drop objects, create roles or
-- databases, truncate tables, touch migration bookkeeping, or change/delete
-- audit log rows. The superuser (POSTGRES_USER) is for administration only.
--
-- psql variables (set by deploy.sh; an empty password leaves it unchanged,
-- which is how the test suite runs this without touching real credentials):
--   :migrator_pw  :api_pw  :web_pw  :readonly_pw

\set ON_ERROR_STOP on

SELECT set_config('vertex.migrator_pw', :'migrator_pw', false),
       set_config('vertex.api_pw', :'api_pw', false),
       set_config('vertex.web_pw', :'web_pw', false),
       set_config('vertex.readonly_pw', :'readonly_pw', false);

DO $$
DECLARE
  r record;
  pw text;
BEGIN
  -- Roles: login only, no special powers.
  FOR r IN SELECT * FROM (VALUES ('vertex_migrator', 'vertex.migrator_pw'),
                                 ('vertex_api', 'vertex.api_pw'),
                                 ('vertex_web', 'vertex.web_pw'),
                                 ('vertex_readonly', 'vertex.readonly_pw')) AS t(role, setting)
  LOOP
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = r.role) THEN
      EXECUTE format('CREATE ROLE %I', r.role);
    END IF;
    IF (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN
      EXECUTE format('ALTER ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT', r.role);
    ELSE
      -- Managed Postgres (the demo database on Neon): the owner isn't a
      -- superuser, so it may not even name SUPERUSER, REPLICATION or
      -- BYPASSRLS, and it can't grant them either: roles it creates never
      -- have them. Refuse if one somehow does.
      IF EXISTS (SELECT FROM pg_roles WHERE rolname = r.role AND (rolsuper OR rolreplication OR rolbypassrls)) THEN
        RAISE EXCEPTION 'role % has superuser, replication or bypassrls', r.role;
      END IF;
      EXECUTE format('ALTER ROLE %I LOGIN NOCREATEDB NOCREATEROLE NOINHERIT', r.role);
    END IF;
    pw := current_setting(r.setting);
    IF pw <> '' THEN
      EXECUTE format('ALTER ROLE %I PASSWORD %L', r.role, pw);
    END IF;
  END LOOP;

  -- Database: nobody connects by default.
  EXECUTE format('REVOKE ALL ON DATABASE %I FROM PUBLIC', current_database());
  EXECUTE format('GRANT CONNECT, TEMPORARY ON DATABASE %I TO vertex_migrator, vertex_api, vertex_web', current_database());
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO vertex_readonly', current_database());
END $$;

-- Schema: only the migrator may create objects.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE, CREATE ON SCHEMA public TO vertex_migrator;
GRANT USAGE ON SCHEMA public TO vertex_api, vertex_web, vertex_readonly;

-- Hand every existing object in public to the migrator, so migrations can
-- alter tables first created by the superuser (or by Prisma, historically).
DO $$
DECLARE
  r record;
BEGIN
  -- Tables, views and foreign tables (their owned sequences/indexes follow).
  FOR r IN SELECT c.oid::regclass AS obj, c.relkind FROM pg_class c
           WHERE c.relnamespace = 'public'::regnamespace
             AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
             AND c.relowner <> 'vertex_migrator'::regrole
  LOOP
    EXECUTE format('ALTER %s %s OWNER TO vertex_migrator',
                   CASE r.relkind WHEN 'v' THEN 'VIEW' WHEN 'm' THEN 'MATERIALIZED VIEW'
                                  WHEN 'f' THEN 'FOREIGN TABLE' ELSE 'TABLE' END, r.obj);
  END LOOP;
  -- Standalone sequences not owned by a table column.
  FOR r IN SELECT c.oid::regclass AS obj FROM pg_class c
           WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'S'
             AND c.relowner <> 'vertex_migrator'::regrole
             AND NOT EXISTS (SELECT FROM pg_depend d WHERE d.objid = c.oid AND d.deptype IN ('a', 'i'))
  LOOP
    EXECUTE format('ALTER SEQUENCE %s OWNER TO vertex_migrator', r.obj);
  END LOOP;
  -- Enums and domains.
  FOR r IN SELECT t.oid::regtype AS obj, t.typtype FROM pg_type t
           WHERE t.typnamespace = 'public'::regnamespace AND t.typtype IN ('e', 'd')
             AND t.typowner <> 'vertex_migrator'::regrole
  LOOP
    EXECUTE format('ALTER %s %s OWNER TO vertex_migrator',
                   CASE r.typtype WHEN 'd' THEN 'DOMAIN' ELSE 'TYPE' END, r.obj);
  END LOOP;
  -- Functions (e.g. the audit log trigger function).
  FOR r IN SELECT p.oid::regprocedure AS obj FROM pg_proc p
           WHERE p.pronamespace = 'public'::regnamespace
             AND p.proowner <> 'vertex_migrator'::regrole
  LOOP
    EXECUTE format('ALTER ROUTINE %s OWNER TO vertex_migrator', r.obj);
  END LOOP;
END $$;

-- Runtime roles: row access only.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO vertex_api, vertex_web;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO vertex_api, vertex_web;

-- Objects created by future migrations get the same grants automatically.
ALTER DEFAULT PRIVILEGES FOR ROLE vertex_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO vertex_api, vertex_web;
ALTER DEFAULT PRIVILEGES FOR ROLE vertex_migrator IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO vertex_api, vertex_web;

-- Read-only browsing role (pgAdmin): an ALLOWLIST. Every deploy revokes all
-- its access and default privileges, then grants SELECT only on columns
-- marked 'grant' in readonly-columns.sql (loaded before this file). Columns
-- that aren't classified stay hidden, and CI fails until they are.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM vertex_readonly;  -- also clears column grants
ALTER DEFAULT PRIVILEGES FOR ROLE vertex_migrator IN SCHEMA public REVOKE ALL ON TABLES FROM vertex_readonly;
DO $$
DECLARE
  t record;
BEGIN
  IF to_regclass('pg_temp.readonly_columns') IS NULL THEN
    RAISE EXCEPTION 'readonly-columns.sql must be loaded before db-roles.sql';
  END IF;
  FOR t IN SELECT r.tbl, string_agg(quote_ident(r.col), ', ' ORDER BY r.col) AS cols
           FROM readonly_columns r
           JOIN information_schema.columns ic
             ON ic.table_schema = 'public' AND ic.table_name = r.tbl AND ic.column_name = r.col
           WHERE r.decision = 'grant'
           GROUP BY r.tbl
  LOOP
    EXECUTE format('GRANT SELECT (%s) ON public.%I TO vertex_readonly', t.cols, t.tbl);
  END LOOP;
END $$;

-- Carve-outs: the audit trail is append-only (triggers block UPDATE/DELETE,
-- this also covers TRUNCATE and the trigger-free path), and migration
-- bookkeeping is the migrator's alone.
DO $$
BEGIN
  IF to_regclass('public."AuditLog"') IS NOT NULL THEN
    REVOKE UPDATE, DELETE, TRUNCATE ON "AuditLog" FROM vertex_api, vertex_web;
    -- Phase 10: reading the trail is limited to the service that shows it
    -- (Next.js: case history, security monitor). FastAPI may append, not read.
    REVOKE SELECT ON "AuditLog" FROM vertex_api;
  END IF;
  -- G19: sessions belong to the service that signs users in (Next.js).
  IF to_regclass('public."RefreshToken"') IS NOT NULL THEN
    REVOKE ALL ON "RefreshToken" FROM vertex_api;
  END IF;
  -- G9: FastAPI verifies those sessions, so it may ask whether one is live
  -- (yes/no, migration 0007) without reading any session row.
  IF to_regprocedure('public.vertex_session_is_live(text, text)') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.vertex_session_is_live(text, text) FROM PUBLIC, vertex_web, vertex_readonly;
    GRANT EXECUTE ON FUNCTION public.vertex_session_is_live(text, text) TO vertex_api;
  END IF;
  IF to_regclass('public.alembic_version') IS NOT NULL THEN
    REVOKE ALL ON alembic_version FROM vertex_api, vertex_web;
  END IF;
  IF to_regclass('public._prisma_migrations') IS NOT NULL THEN
    REVOKE ALL ON _prisma_migrations FROM vertex_api, vertex_web;
  END IF;
END $$;

-- One writer per table (docs/architecture/data-ownership.md): tables handed
-- over to FastAPI. Next.js keeps reading them (vertex_web SELECT) but may no
-- longer change them; its handlers write through callBackend() instead.
-- Foreign-key actions (a deleted country setting country_id to null) still
-- work: Postgres runs them as the table's owner. tests/test_db_roles.py
-- reads this list and checks each table.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[  -- FastAPI-owned tables
    'FeePolicy',  -- reference data, step 1.2 (2026-10-24)
    'Region',     -- reference data, step 2.1
    'Country',    -- reference data, step 2.1
    'Sector',     -- reference data, step 2.2
    'CountryDocumentRequirement'  -- reference data, step 2.2
  ] LOOP
    IF to_regclass(format('public.%I', t)) IS NOT NULL THEN
      EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.%I FROM vertex_web', t);
    END IF;
  END LOOP;
END $$;
