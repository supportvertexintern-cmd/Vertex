"""refused reset emails on the Security Overview (login protection, PR 3)

vertex_monitoring_counts (0015) answers how many sign-ins, refused sign-ins
and password resets the trail holds since a time. The Overview's new card
counts reset and setup emails refused by the per-email limit
(reset_rate_limited) too. Only that action is added; the function still
answers counts by action, nothing else. CREATE OR REPLACE keeps its grants
(db-roles.sql: EXECUTE to vertex_api alone).

Revision ID: 0019
Revises: 0018
Create Date: 2026-11-09
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0019"
down_revision: str | None = "0018"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _function(actions: str) -> str:
    return f"""
        CREATE OR REPLACE FUNCTION public.vertex_monitoring_counts(p_since timestamp)
        RETURNS TABLE (action text, n bigint)
        LANGUAGE sql STABLE SECURITY DEFINER
        SET search_path = pg_catalog, pg_temp
        AS $$
          SELECT a.action, count(*)
          FROM public."AuditLog" a
          WHERE a.action IN ({actions}) AND a.created_at >= p_since
          GROUP BY a.action
        $$
        """


def upgrade() -> None:
    op.execute(_function("'login_succeeded', 'login_failed', 'password_reset_completed', 'reset_rate_limited'"))


def downgrade() -> None:
    op.execute(_function("'login_succeeded', 'login_failed', 'password_reset_completed'"))
