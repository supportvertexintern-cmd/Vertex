#!/usr/bin/env bash
# Emergency kill switch for sessions (G19 / E6, docs/security/session-management.md):
# signs every user of one stack out at once. Their next request is refused
# (every API call checks the session in the database), and no refresh token
# can renew it. Takes effect immediately; no restart.
#
#   bash deploy/sessions-kill-switch.sh <dev|staging|main> "<reason>"
#
# If JWT_SECRET itself may be compromised, rotate it as well (runbook §5):
# forged access tokens still need a live session id, but email, invite and
# document links are signed with keys derived from the same secret.
# Run from vertex_be/.
set -euo pipefail
export MSYS_NO_PATHCONV=1
E="${1:?usage: sessions-kill-switch.sh <dev|staging|main> \"<reason>\"}"
REASON="${2:?give a reason; it is recorded in the audit trail}"
P="vertex-$E"
BE="$(cd "$(dirname "$0")/.." && { pwd -W 2>/dev/null || pwd; })"; ENVF="$BE/.env.$E"
[ -f "$ENVF" ] || { echo "no env file for $E" >&2; exit 1; }
v() { grep -E "^$1=" "$ENVF" | tail -1 | cut -d= -f2- | tr -d '\r'; }
DB=$(v POSTGRES_DB); SU=$(v POSTGRES_USER)

if [ "$E" = "main" ] && [ "${CONFIRM_MAIN:-}" != "yes" ]; then
  echo "Refusing to sign out every user of vertex-main without CONFIRM_MAIN=yes" >&2
  exit 1
fi

# One transaction: revoke every live refresh token and record who/why.
# The reason goes in as a psql variable, so it is quoted safely.
docker exec -i "$P-db-1" psql -U "$SU" -d "$DB" -v ON_ERROR_STOP=1 -v reason="$REASON" -qtA <<'SQL' | tr -d '\r'
BEGIN;
WITH ended AS (
  UPDATE "RefreshToken" SET revoked_at = now(), revoke_reason = 'kill_switch'
  WHERE revoked_at IS NULL
  RETURNING user_id, family_id, used_at, expires_at
), counts AS (
  SELECT count(DISTINCT family_id) FILTER (WHERE used_at IS NULL AND expires_at > now()) AS sessions,
         count(DISTINCT user_id) AS users
  FROM ended
)
INSERT INTO "AuditLog" (id, entity_type, entity_id, action, after)
SELECT 'ckill' || md5(random()::text || clock_timestamp()::text), 'Session', 'all', 'sessions_revoked',
       jsonb_build_object('reason', 'kill_switch', 'note', :'reason', 'sessions', sessions, 'users', users)
FROM counts
RETURNING 'ended ' || (after->>'sessions') || ' live session(s) of ' || (after->>'users') || ' user(s)';
COMMIT;
SQL
remaining=$(docker exec "$P-db-1" psql -U "$SU" -d "$DB" -tAc 'SELECT count(*) FROM "RefreshToken" WHERE revoked_at IS NULL' | tr -d '\r ')
echo "live refresh tokens left: $remaining"
[ "$remaining" = "0" ]
