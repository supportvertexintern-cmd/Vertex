"""where an account signed in from before (admin monitoring, new-country check)

vertex_sign_in_places(user_id, before): the distinct addresses, the country
recorded with each (sign-ins record one from 2026-11-07 on) and how many
sign-ins came from each, of the account's successful sign-ins before a time,
at most 500 places. The count lets the monitor leave out the sign-in it is
checking, which is already on the trail. The monitor
compares a sign-in's country with them. As 0008, 0012 and 0015: the owner's
rights, only this answer; db-roles.sql grants EXECUTE to vertex_api alone.

Revision ID: 0016
Revises: 0015
Create Date: 2026-11-07
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0016"
down_revision: str | None = "0015"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        CREATE FUNCTION public.vertex_sign_in_places(p_user_id text, p_before timestamp)
        RETURNS TABLE (ip text, country text, n bigint)
        LANGUAGE sql STABLE SECURITY DEFINER
        SET search_path = pg_catalog, pg_temp
        AS $$
          SELECT a.after ->> 'ip', a.after ->> 'country', count(*)
          FROM public."AuditLog" a
          WHERE a.action = 'login_succeeded' AND a.entity_type = 'Auth' AND a.entity_id = 'user:' || p_user_id
            AND a.created_at < p_before
          GROUP BY 1, 2
          LIMIT 500
        $$
        """
    )
    op.execute("REVOKE ALL ON FUNCTION public.vertex_sign_in_places(text, timestamp) FROM PUBLIC")


def downgrade() -> None:
    op.execute("DROP FUNCTION public.vertex_sign_in_places(text, timestamp)")
