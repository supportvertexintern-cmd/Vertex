"""account status: deactivation, who created an account, sign-in reads (admin monitoring, phase 1)

User.deactivated_at, deactivated_by, deactivation_reason: an admin can
deactivate any login instead of deleting it. A deactivated account can't
sign in (password or Google), refresh, or use a setup or reset link, and
its sessions end; reactivating clears the three and leaves activated_at
and welcomed_at as they were, so a partner never sees the welcome twice.

User.created_by: who created the account, from now on, and for existing
accounts from the audit trail's create row where it names someone.

activated_at now counts for every account, not only partners': the first
successful sign-in. Accounts that signed in before this migration get their
first recorded sign-in (partners already have theirs, from 0011).

Two functions for the admin's User Accounts page, as for a case's history
(0008, owner's decision 2026-11-02): vertex_api may append to AuditLog and
not read it, so each runs with the owner's rights and returns only what the
page shows, never a snapshot:

  vertex_last_sign_ins(user_ids): each account's latest successful sign-in,
      with the address it came from.
  vertex_sign_in_history(user_id, limit): an account's recent sign-ins and
      refused sign-ins: time, outcome, method, reason, address and device.

db-roles.sql grants EXECUTE to vertex_api alone.

Revision ID: 0012
Revises: 0011
Create Date: 2026-11-07
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import TIMESTAMP

from alembic import op

revision: str = "0012"
down_revision: str | None = "0011"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


# A successful sign-in is recorded as login_succeeded on entity "user:<id>".
ACTIVATED = """
        UPDATE "User" u
        SET activated_at = f.first_at
        FROM (
            SELECT substr(entity_id, 6) AS user_id, min(created_at) AS first_at
            FROM "AuditLog"
            WHERE action = 'login_succeeded' AND entity_type = 'Auth' AND entity_id LIKE 'user:%'
            GROUP BY 1
        ) f
        WHERE u.id = f.user_id AND u.activated_at IS NULL
        """

# The row audit's create, where the actor is an account that still exists.
CREATED_BY = """
        UPDATE "User" u
        SET created_by = a.actor_id
        FROM "AuditLog" a
        WHERE a.entity_type = 'User' AND a.action = 'create' AND a.entity_id = u.id
          AND a.actor_id IS NOT NULL AND a.actor_id <> u.id
          AND EXISTS (SELECT 1 FROM "User" x WHERE x.id = a.actor_id)
        """


def upgrade() -> None:
    op.add_column("User", sa.Column("deactivated_at", TIMESTAMP(precision=3), nullable=True))
    op.add_column("User", sa.Column("deactivated_by", sa.Text(), nullable=True))
    op.add_column("User", sa.Column("deactivation_reason", sa.Text(), nullable=True))
    op.add_column("User", sa.Column("created_by", sa.Text(), nullable=True))
    for column in ("deactivated_by", "created_by"):
        op.create_foreign_key(
            f"User_{column}_fkey", "User", "User", [column], ["id"], ondelete="SET NULL", onupdate="CASCADE"
        )
    op.execute(ACTIVATED)
    op.execute(CREATED_BY)

    # A fixed search_path and schema-qualified names, as every SECURITY
    # DEFINER function needs.
    op.execute(
        """
        CREATE FUNCTION public.vertex_last_sign_ins(p_user_ids text[])
        RETURNS TABLE (user_id text, signed_in_at timestamp, ip text)
        LANGUAGE sql STABLE SECURITY DEFINER
        SET search_path = pg_catalog, pg_temp
        AS $$
          SELECT u.id, l.created_at, l.ip
          FROM unnest(p_user_ids) AS u(id)
          CROSS JOIN LATERAL (
            SELECT a.created_at, a.after ->> 'ip' AS ip
            FROM public."AuditLog" a
            WHERE a.entity_type = 'Auth' AND a.entity_id = 'user:' || u.id AND a.action = 'login_succeeded'
            ORDER BY a.created_at DESC
            LIMIT 1
          ) l
        $$
        """
    )
    op.execute(
        """
        CREATE FUNCTION public.vertex_sign_in_history(p_user_id text, p_limit integer)
        RETURNS TABLE (created_at timestamp, action text, method text, reason text, ip text, device text)
        LANGUAGE sql STABLE SECURITY DEFINER
        SET search_path = pg_catalog, pg_temp
        AS $$
          SELECT a.created_at, a.action, a.after ->> 'method', a.after ->> 'reason', a.after ->> 'ip', a.after ->> 'device'
          FROM public."AuditLog" a
          WHERE a.entity_type = 'Auth' AND a.entity_id = 'user:' || p_user_id
            AND a.action IN ('login_succeeded', 'login_failed')
          ORDER BY a.created_at DESC, a.id DESC
          LIMIT least(greatest(p_limit, 1), 200)
        $$
        """
    )
    # Functions are executable by PUBLIC by default.
    op.execute("REVOKE ALL ON FUNCTION public.vertex_last_sign_ins(text[]) FROM PUBLIC")
    op.execute("REVOKE ALL ON FUNCTION public.vertex_sign_in_history(text, integer) FROM PUBLIC")


def downgrade() -> None:
    op.execute("DROP FUNCTION public.vertex_sign_in_history(text, integer)")
    op.execute("DROP FUNCTION public.vertex_last_sign_ins(text[])")
    for column in ("created_by", "deactivated_by"):
        op.drop_constraint(f"User_{column}_fkey", "User", type_="foreignkey")
    op.drop_column("User", "created_by")
    op.drop_column("User", "deactivation_reason")
    op.drop_column("User", "deactivated_by")
    op.drop_column("User", "deactivated_at")
