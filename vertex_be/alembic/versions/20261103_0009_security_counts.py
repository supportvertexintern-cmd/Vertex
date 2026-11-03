"""security event counts for FastAPI's alert monitor (reads handover R7a)

The alert monitor moves from the website to FastAPI (D3 A). Its rules
count recent audit rows (failed sign-ins for one account or address,
denials for one user) and check that an alert wasn't just raised by
another process. vertex_api may append to the trail and not read it
(Phase 10); as for a case's history (0008, owner's decision 2026-11-02),
it gets a function with the owner's rights that answers only a number.

vertex_security_count(action, key, value, since): how many rows of that
action since that time carry that value, for the four pairs the rules
use. Any other pair is refused, so it can't be turned into a reader.

db-roles.sql grants EXECUTE to vertex_api alone.

Revision ID: 0009
Revises: 0008
Create Date: 2026-11-03
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0009"
down_revision: str | None = "0008"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # A fixed search_path and schema-qualified names, as every SECURITY
    # DEFINER function needs.
    op.execute(
        """
        CREATE FUNCTION public.vertex_security_count(p_action text, p_key text, p_value text, p_since timestamp)
        RETURNS bigint
        LANGUAGE plpgsql STABLE SECURITY DEFINER
        SET search_path = pg_catalog, pg_temp
        AS $$
        BEGIN
          IF (p_action, p_key) = ('login_failed', 'email_fp') OR (p_action, p_key) = ('login_failed', 'ip') THEN
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
    )
    # Functions are executable by PUBLIC by default.
    op.execute("REVOKE ALL ON FUNCTION public.vertex_security_count(text, text, text, timestamp) FROM PUBLIC")


def downgrade() -> None:
    op.execute("DROP FUNCTION public.vertex_security_count(text, text, text, timestamp)")
