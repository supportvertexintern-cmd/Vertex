"""audit trail reads for FastAPI (reads handover R5)

Two pages show what the audit trail recorded: a case's history and the
rejected-submissions list (the date each submission was rejected). The
website read AuditLog for them through Prisma; FastAPI answers them now,
but vertex_api may append to the trail and not read it (Phase 10): its rows
hold before/after snapshots of personal data.

Owner's decision (2026-11-02): FastAPI gets narrow functions instead of a
grant, as vertex_session_is_live (0007) does for sessions. Each runs with
the table owner's rights and returns only what its page shows, never a
snapshot:

  vertex_case_trail(case_id): the case's rows and those of its stage
      events, contract, payments and retention follow-up: id, entity,
      action, actor and time.
  vertex_rejection_dates(entity_type, ids): when each PartnerCandidate or
      Candidate last became rejected (its status or lifecycle_status), as
      getRejectionDates() in the website's rejected-submissions route.

db-roles.sql grants EXECUTE to vertex_api alone.

Revision ID: 0008
Revises: 0007
Create Date: 2026-11-02
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0008"
down_revision: str | None = "0007"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # A fixed search_path and schema-qualified names, as every SECURITY
    # DEFINER function needs.
    op.execute(
        """
        CREATE FUNCTION public.vertex_case_trail(p_case_id text)
        RETURNS TABLE (id text, entity_type text, entity_id text, action text, actor_id text, created_at timestamp)
        LANGUAGE sql STABLE SECURITY DEFINER
        SET search_path = pg_catalog, pg_temp
        AS $$
          SELECT a.id, a.entity_type, a.entity_id, a.action, a.actor_id, a.created_at
          FROM public."AuditLog" a
          WHERE (a.entity_type = 'Case' AND a.entity_id = p_case_id)
             OR (a.entity_type = 'CaseStageEvent' AND a.entity_id IN (SELECT e.id FROM public."CaseStageEvent" e WHERE e.case_id = p_case_id))
             OR (a.entity_type = 'Contract' AND a.entity_id IN (SELECT c.id FROM public."Contract" c WHERE c.case_id = p_case_id))
             OR (a.entity_type = 'CasePayment' AND a.entity_id IN (SELECT p.id FROM public."CasePayment" p WHERE p.case_id = p_case_id))
             OR (a.entity_type = 'RetentionFollowUp' AND a.entity_id IN (SELECT r.id FROM public."RetentionFollowUp" r WHERE r.case_id = p_case_id))
          ORDER BY a.created_at, a.id
        $$
        """
    )
    # Only the two submission kinds, each with the field that holds its
    # status; any other entity_type returns nothing.
    op.execute(
        """
        CREATE FUNCTION public.vertex_rejection_dates(p_entity_type text, p_ids text[])
        RETURNS TABLE (entity_id text, rejected_at timestamp)
        LANGUAGE sql STABLE SECURITY DEFINER
        SET search_path = pg_catalog, pg_temp
        AS $$
          SELECT a.entity_id, max(a.created_at)
          FROM public."AuditLog" a
          JOIN (VALUES ('PartnerCandidate', 'status'), ('Candidate', 'lifecycle_status')) AS f(entity_type, field)
            ON f.entity_type = a.entity_type
          WHERE a.entity_type = p_entity_type
            AND a.entity_id = ANY (p_ids)
            AND a.action = 'update'
            AND a.after ->> f.field = 'rejected'
            AND (a.before ->> f.field) IS DISTINCT FROM 'rejected'
          GROUP BY a.entity_id
        $$
        """
    )
    # Functions are executable by PUBLIC by default.
    op.execute("REVOKE ALL ON FUNCTION public.vertex_case_trail(text) FROM PUBLIC")
    op.execute("REVOKE ALL ON FUNCTION public.vertex_rejection_dates(text, text[]) FROM PUBLIC")


def downgrade() -> None:
    op.execute("DROP FUNCTION public.vertex_rejection_dates(text, text[])")
    op.execute("DROP FUNCTION public.vertex_case_trail(text)")
