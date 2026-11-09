"""Sign-in Activity and Reset Email Activity reads (login protection, PR 4)

vertex_api may append to the trail and not read it (Phase 10); each page
that shows part of it gets a function with the owner's rights that answers
only that part (as 0012, 0015). Three here:

  vertex_sign_in_events(...): sign-in attempts (login_succeeded,
      login_failed, login_rate_limited) with their result, account, address,
      country, device and method, filtered and paged; total in each row.
  vertex_sign_in_failure_stats(since): failed sign-ins per hour, and the 10
      addresses and 10 accounts with the most.
  vertex_account_email_events(...): password-reset, setup and verification
      emails sent or refused (password_reset_requested, account_email_sent,
      reset_rate_limited), filtered and paged; total in each row.
  vertex_account_email_refusals(since, min): addresses refused at least
      that many reset or setup emails since then (the flooding flag).

Each has a fixed search_path, is revoked from PUBLIC, and db-roles.sql
grants EXECUTE to vertex_api alone.

Revision ID: 0020
Revises: 0019
Create Date: 2026-11-09
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0020"
down_revision: str | None = "0019"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

FUNCTIONS = (
    "vertex_sign_in_events(timestamp, timestamp, text[], text[], text[], text, text, integer, integer)",
    "vertex_sign_in_failure_stats(timestamp)",
    "vertex_account_email_events(timestamp, timestamp, text[], text[], text[], text[], integer, integer)",
    "vertex_account_email_refusals(timestamp, integer)",
)


def upgrade() -> None:
    op.execute(
        """
        CREATE FUNCTION public.vertex_sign_in_events(
            p_since timestamp, p_until timestamp, p_results text[], p_user_ids text[], p_email_fps text[],
            p_ip text, p_country text, p_limit integer, p_offset integer)
        RETURNS TABLE (id text, created_at timestamp, result text, user_id text, email_fp text, reason text,
                       method text, client text, ip text, country text, device text, total bigint)
        LANGUAGE sql STABLE SECURITY DEFINER
        SET search_path = pg_catalog, pg_temp
        AS $$
          WITH ev AS (
            SELECT a.id, a.created_at,
              CASE
                WHEN a.action = 'login_succeeded' THEN 'success'
                WHEN a.action = 'login_rate_limited' AND a.after ->> 'scope' = 'account' THEN 'locked'
                WHEN a.action = 'login_rate_limited' THEN 'address_limited'
                WHEN a.after ->> 'reason' = 'deactivated' THEN 'deactivated'
                WHEN a.after ->> 'reason' = 'email_unverified' THEN 'not_activated'
                WHEN a.after ->> 'reason' IN ('bad_password', 'unknown_account', 'no_password_set') THEN 'wrong_password'
                ELSE 'refused'
              END AS result,
              CASE WHEN a.entity_id LIKE 'user:%' THEN substr(a.entity_id, 6) ELSE a.actor_id END AS user_id,
              a.after ->> 'email_fp' AS email_fp, a.after ->> 'reason' AS reason, a.after ->> 'method' AS method,
              a.after ->> 'client' AS client, a.after ->> 'ip' AS ip, a.after ->> 'country' AS country,
              a.after ->> 'device' AS device
            FROM public."AuditLog" a
            WHERE a.action IN ('login_succeeded', 'login_failed', 'login_rate_limited')
              AND a.created_at >= p_since AND (p_until IS NULL OR a.created_at < p_until)
          )
          SELECT ev.*, count(*) OVER () AS total
          FROM ev
          WHERE (p_results IS NULL OR ev.result = ANY (p_results))
            AND ((p_user_ids IS NULL AND p_email_fps IS NULL)
                 OR ev.user_id = ANY (coalesce(p_user_ids, '{}')) OR ev.email_fp = ANY (coalesce(p_email_fps, '{}')))
            AND (p_ip IS NULL OR ev.ip = p_ip)
            AND (p_country IS NULL OR ev.country = p_country)
          ORDER BY ev.created_at DESC, ev.id
          LIMIT least(greatest(p_limit, 1), 200) OFFSET greatest(p_offset, 0)
        $$
        """
    )
    op.execute(
        """
        CREATE FUNCTION public.vertex_sign_in_failure_stats(p_since timestamp)
        RETURNS TABLE (kind text, key text, user_id text, n bigint)
        LANGUAGE sql STABLE SECURITY DEFINER
        SET search_path = pg_catalog, pg_temp
        AS $$
          (SELECT 'hour', to_char(date_trunc('hour', a.created_at), 'YYYY-MM-DD"T"HH24:00:00'), NULL::text, count(*)
           FROM public."AuditLog" a WHERE a.action = 'login_failed' AND a.created_at >= p_since
           GROUP BY 2)
          UNION ALL
          (SELECT 'ip', a.after ->> 'ip', NULL::text, count(*)
           FROM public."AuditLog" a WHERE a.action = 'login_failed' AND a.created_at >= p_since AND a.after ->> 'ip' IS NOT NULL
           GROUP BY 2 ORDER BY 4 DESC, 2 LIMIT 10)
          UNION ALL
          (SELECT 'account', a.after ->> 'email_fp',
                  max(CASE WHEN a.entity_id LIKE 'user:%' THEN substr(a.entity_id, 6) END), count(*)
           FROM public."AuditLog" a WHERE a.action = 'login_failed' AND a.created_at >= p_since AND a.after ->> 'email_fp' IS NOT NULL
           GROUP BY 2 ORDER BY 4 DESC, 2 LIMIT 10)
        $$
        """
    )
    op.execute(
        """
        CREATE FUNCTION public.vertex_account_email_events(
            p_since timestamp, p_until timestamp, p_kinds text[], p_results text[], p_user_ids text[], p_email_fps text[],
            p_limit integer, p_offset integer)
        RETURNS TABLE (id text, created_at timestamp, kind text, result text, user_id text, email_fp text, ip text,
                       manual boolean, total bigint)
        LANGUAGE sql STABLE SECURITY DEFINER
        SET search_path = pg_catalog, pg_temp
        AS $$
          WITH ev AS (
            SELECT a.id, a.created_at,
              CASE WHEN a.action = 'password_reset_requested' THEN 'password_reset'
                   ELSE coalesce(a.after ->> 'kind', 'password_reset') END AS kind,
              CASE
                WHEN a.action = 'account_email_sent' THEN 'sent'
                WHEN a.action = 'reset_rate_limited' AND a.after ->> 'scope' = 'address' THEN 'refused_address_limit'
                WHEN a.action = 'reset_rate_limited' THEN 'refused_email_limit'
                WHEN a.after ->> 'refused' = 'email_limit' THEN 'refused_email_limit'
                WHEN a.after ->> 'email_sent' = 'true' THEN 'sent'
                ELSE 'not_sent'
              END AS result,
              CASE WHEN a.entity_id LIKE 'user:%' THEN substr(a.entity_id, 6) END AS user_id,
              a.after ->> 'email_fp' AS email_fp, a.after ->> 'ip' AS ip,
              coalesce((a.after ->> 'manual')::boolean, false) AS manual
            FROM public."AuditLog" a
            WHERE a.created_at >= p_since AND (p_until IS NULL OR a.created_at < p_until)
              AND (a.action IN ('password_reset_requested', 'account_email_sent')
                   -- A visitor's refused reset is on password_reset_requested
                   -- already; a refused setup email, an admin's refused
                   -- reset link and the website's per-address refusals are
                   -- only here.
                   OR (a.action = 'reset_rate_limited'
                       AND (a.after ->> 'scope' = 'address' OR a.after ->> 'kind' IS DISTINCT FROM 'password_reset'
                            OR a.actor_id IS NOT NULL)))
          )
          SELECT ev.*, count(*) OVER () AS total
          FROM ev
          WHERE (p_kinds IS NULL OR ev.kind = ANY (p_kinds))
            AND (p_results IS NULL OR ev.result = ANY (p_results))
            AND ((p_user_ids IS NULL AND p_email_fps IS NULL)
                 OR ev.user_id = ANY (coalesce(p_user_ids, '{}')) OR ev.email_fp = ANY (coalesce(p_email_fps, '{}')))
          ORDER BY ev.created_at DESC, ev.id
          LIMIT least(greatest(p_limit, 1), 200) OFFSET greatest(p_offset, 0)
        $$
        """
    )
    op.execute(
        """
        CREATE FUNCTION public.vertex_account_email_refusals(p_since timestamp, p_min integer)
        RETURNS TABLE (email_fp text, user_id text, n bigint)
        LANGUAGE sql STABLE SECURITY DEFINER
        SET search_path = pg_catalog, pg_temp
        AS $$
          SELECT a.after ->> 'email_fp', max(CASE WHEN a.entity_id LIKE 'user:%' THEN substr(a.entity_id, 6) END), count(*)
          FROM public."AuditLog" a
          WHERE a.action = 'reset_rate_limited' AND a.created_at >= p_since AND a.after ->> 'email_fp' IS NOT NULL
          GROUP BY 1
          HAVING count(*) >= p_min
          ORDER BY 3 DESC
          LIMIT 100
        $$
        """
    )
    for fn in FUNCTIONS:
        op.execute(f"REVOKE ALL ON FUNCTION public.{fn} FROM PUBLIC")


def downgrade() -> None:
    for fn in FUNCTIONS:
        op.execute(f"DROP FUNCTION public.{fn}")
