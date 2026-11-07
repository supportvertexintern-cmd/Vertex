"""the audit trail viewer and the monitoring counts (admin monitoring, phases 4 and 5)

vertex_api may append to AuditLog and not read it (Phase 10). As for a
case's history (0008) and the sign-ins (0012), each read the admin's
monitoring pages need is a function with the owner's rights that answers
only that:

  vertex_audit_trail(actor, action, entity_type, entity_id, from, to, limit,
      offset): the Audit Trail page, newest first, filtered, at most 200
      rows a call, with the total. An entity_id also matches its security
      events ("user:<id>"). FastAPI records every call (audit_trail_viewed).
  vertex_monitoring_counts(since): how many sign-ins, refused sign-ins and
      password resets since a time, for the Security Overview.
  vertex_sign_in_accounts_from(ip, since): how many accounts signed in
      from one address since a time (the shared-address check).
  vertex_new_address_after_reset(user_id, ip, since): whether the account
      reset its password since that time and has never signed in from this
      address before the reset (the reset-then-new-address check).

db-roles.sql grants EXECUTE to vertex_api alone.

Revision ID: 0015
Revises: 0014
Create Date: 2026-11-07
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0015"
down_revision: str | None = "0014"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SIGNATURES = (
    "vertex_audit_trail(text, text, text, text, timestamp, timestamp, integer, integer)",
    "vertex_monitoring_counts(timestamp)",
    "vertex_sign_in_accounts_from(text, timestamp)",
    "vertex_new_address_after_reset(text, text, timestamp)",
)


def upgrade() -> None:
    op.execute(
        """
        CREATE FUNCTION public.vertex_audit_trail(
            p_actor text, p_action text, p_entity_type text, p_entity_id text,
            p_from timestamp, p_to timestamp, p_limit integer, p_offset integer)
        RETURNS TABLE (id text, created_at timestamp, actor_id text, action text, entity_type text, entity_id text,
                       before jsonb, after jsonb, request_id text, total bigint)
        LANGUAGE sql STABLE SECURITY DEFINER
        SET search_path = pg_catalog, pg_temp
        AS $$
          SELECT a.id, a.created_at, a.actor_id, a.action, a.entity_type, a.entity_id, a.before, a.after, a.request_id,
                 count(*) OVER ()
          FROM public."AuditLog" a
          WHERE (p_actor IS NULL OR a.actor_id = p_actor)
            AND (p_action IS NULL OR a.action = p_action)
            AND (p_entity_type IS NULL OR a.entity_type = p_entity_type)
            AND (p_entity_id IS NULL OR a.entity_id = p_entity_id OR a.entity_id = 'user:' || p_entity_id)
            AND (p_from IS NULL OR a.created_at >= p_from)
            AND (p_to IS NULL OR a.created_at < p_to)
          ORDER BY a.created_at DESC, a.id DESC
          LIMIT least(greatest(p_limit, 1), 200) OFFSET greatest(p_offset, 0)
        $$
        """
    )
    op.execute(
        """
        CREATE FUNCTION public.vertex_monitoring_counts(p_since timestamp)
        RETURNS TABLE (action text, n bigint)
        LANGUAGE sql STABLE SECURITY DEFINER
        SET search_path = pg_catalog, pg_temp
        AS $$
          SELECT a.action, count(*)
          FROM public."AuditLog" a
          WHERE a.action IN ('login_succeeded', 'login_failed', 'password_reset_completed') AND a.created_at >= p_since
          GROUP BY a.action
        $$
        """
    )
    op.execute(
        """
        CREATE FUNCTION public.vertex_sign_in_accounts_from(p_ip text, p_since timestamp)
        RETURNS integer
        LANGUAGE sql STABLE SECURITY DEFINER
        SET search_path = pg_catalog, pg_temp
        AS $$
          SELECT count(DISTINCT a.entity_id)::integer
          FROM public."AuditLog" a
          WHERE a.action = 'login_succeeded' AND a.entity_type = 'Auth' AND a.after ->> 'ip' = p_ip AND a.created_at >= p_since
        $$
        """
    )
    op.execute(
        """
        CREATE FUNCTION public.vertex_new_address_after_reset(p_user_id text, p_ip text, p_since timestamp)
        RETURNS boolean
        LANGUAGE sql STABLE SECURITY DEFINER
        SET search_path = pg_catalog, pg_temp
        AS $$
          WITH reset AS (
            SELECT max(r.created_at) AS at
            FROM public."AuditLog" r
            WHERE r.action = 'password_reset_completed' AND r.entity_id = 'user:' || p_user_id
              AND r.after ->> 'outcome' = 'password_changed' AND r.created_at >= p_since
          )
          SELECT reset.at IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM public."AuditLog" s
            WHERE s.action = 'login_succeeded' AND s.entity_type = 'Auth' AND s.entity_id = 'user:' || p_user_id
              AND s.after ->> 'ip' = p_ip AND s.created_at < reset.at
          )
          FROM reset
        $$
        """
    )
    for signature in SIGNATURES:  # executable by PUBLIC by default
        op.execute(f"REVOKE ALL ON FUNCTION public.{signature} FROM PUBLIC")


def downgrade() -> None:
    for signature in SIGNATURES:
        op.execute(f"DROP FUNCTION public.{signature}")
