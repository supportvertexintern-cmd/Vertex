"""session liveness check for FastAPI (gap G9)

FastAPI verifies the sessions the Next.js app issues (it stays the issuer
until users and sessions move, data-ownership.md §5). After the token's
signature it must check what Next.js's loadSession() checks: the session
(refresh-token family) is still live. Sessions belong to Next.js, so
vertex_api has no grants on RefreshToken (db-roles.sql) and must not read
token hashes or session rows.

vertex_session_is_live(user_id, family_id) answers only that yes/no, with
the table owner's rights. db-roles.sql grants EXECUTE to vertex_api alone.

Revision ID: 0007
Revises: 0006
Create Date: 2026-10-24
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0007"
down_revision: str | None = "0006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Same conditions as loadSession() in vertex/src/lib/session.ts. Prisma
    # stores timestamps as UTC without a time zone, so compare with UTC now.
    # A fixed search_path and schema-qualified names, as every SECURITY
    # DEFINER function needs.
    op.execute(
        """
        CREATE FUNCTION public.vertex_session_is_live(p_user_id text, p_family_id text)
        RETURNS boolean
        LANGUAGE sql STABLE SECURITY DEFINER
        SET search_path = pg_catalog, pg_temp
        AS $$
          SELECT EXISTS (
            SELECT 1 FROM public."RefreshToken"
            WHERE user_id = p_user_id
              AND family_id = p_family_id
              AND revoked_at IS NULL
              AND used_at IS NULL
              AND expires_at > (now() AT TIME ZONE 'UTC')
          )
        $$
        """
    )
    # Functions are executable by PUBLIC by default.
    op.execute("REVOKE ALL ON FUNCTION public.vertex_session_is_live(text, text) FROM PUBLIC")


def downgrade() -> None:
    op.execute("DROP FUNCTION public.vertex_session_is_live(text, text)")
