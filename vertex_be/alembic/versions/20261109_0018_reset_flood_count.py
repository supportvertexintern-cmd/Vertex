"""the reset_email_flood count (login protection, PR 2)

The monitor's reset_email_flood rule counts refused reset emails for one
address (reset_rate_limited by email_fp). vertex_security_count (0009)
answers only the pairs the rules use, so it can't be turned into a reader;
this adds that pair and changes nothing else. CREATE OR REPLACE keeps the
function's grants (db-roles.sql: EXECUTE to vertex_api alone).

Revision ID: 0018
Revises: 0017
Create Date: 2026-11-09
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0018"
down_revision: str | None = "0017"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _function(extra: str) -> str:
    return f"""
        CREATE OR REPLACE FUNCTION public.vertex_security_count(p_action text, p_key text, p_value text, p_since timestamp)
        RETURNS bigint
        LANGUAGE plpgsql STABLE SECURITY DEFINER
        SET search_path = pg_catalog, pg_temp
        AS $$
        BEGIN
          IF (p_action, p_key) = ('login_failed', 'email_fp') OR (p_action, p_key) = ('login_failed', 'ip'){extra} THEN
            RETURN (SELECT count(*) FROM public."AuditLog" a
                    WHERE a.action = p_action AND a.created_at >= p_since AND a.after ->> p_key = p_value);
          ELSIF (p_action, p_key) = ('access_denied', 'actor_id') THEN
            RETURN (SELECT count(*) FROM public."AuditLog" a
                    WHERE a.action = p_action AND a.created_at >= p_since AND a.actor_id = p_value);
          ELSIF (p_action, p_key) = ('alert_raised', 'entity_id') THEN
            RETURN (SELECT count(*) FROM public."AuditLog" a
                    WHERE a.action = p_action AND a.created_at >= p_since AND a.entity_id = p_value);
          END IF;
          RAISE EXCEPTION 'vertex_security_count: % by % is not a monitored count', p_action, p_key;
        END
        $$
        """


def upgrade() -> None:
    op.execute(_function("\n             OR (p_action, p_key) = ('reset_rate_limited', 'email_fp')"))


def downgrade() -> None:
    op.execute(_function(""))
