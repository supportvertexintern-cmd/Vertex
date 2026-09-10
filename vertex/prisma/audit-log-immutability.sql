-- Enforces SRS FR-3.6 ("immutable audit trail") at the database level, not
-- just by the app's own discipline of never calling .update()/.delete() on
-- AuditLog. Run once against any new database (dev, test, staging,
-- production) — Prisma's db-push workflow doesn't track raw SQL like
-- triggers, so this isn't applied automatically and must be re-run after
-- any operation that recreates the schema from scratch (e.g. a fresh
-- `prisma db push` against an empty database).
--
-- Usage: psql "$DATABASE_URL" -f prisma/audit-log-immutability.sql

CREATE OR REPLACE FUNCTION reject_audit_log_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'AuditLog rows are immutable — % is not permitted (SRS FR-3.6)', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_log_no_update ON "AuditLog";
CREATE TRIGGER audit_log_no_update
  BEFORE UPDATE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION reject_audit_log_mutation();

DROP TRIGGER IF EXISTS audit_log_no_delete ON "AuditLog";
CREATE TRIGGER audit_log_no_delete
  BEFORE DELETE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION reject_audit_log_mutation();
