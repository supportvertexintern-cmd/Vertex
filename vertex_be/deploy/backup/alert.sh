#!/usr/bin/env bash
# Raises a backup alert (E5), the same way the app raises security alerts
# (Phase 10): a log line, an `alert_raised` row in the audit trail, and an
# email to SECURITY_ALERT_EMAILS (default: every admin), sent through the
# stack's own backend container so it uses that stack's SMTP settings
# (Mailpit locally, a real relay in production) and the same recipients as
# a security alert (app/services/security_monitor.py; the website sent it
# before reads handover R7b).
#
#   bash deploy/backup/alert.sh <rule> "<summary>" [detail...]     (from vertex_be/)
#
# ALERT_TO overrides the recipients (tests). Each rule alerts at most once
# per ALERT_WINDOW_HOURS (default 6), so an
# hourly health check doesn't send an email every hour. Never fails: an
# alert that can't be delivered is still logged.
set -u
export MSYS_NO_PATHCONV=1
RULE="${1:?rule}"; SUMMARY="${2:?summary}"; shift 2; DETAIL="$*"
ROOT="${BACKUP_ROOT:-D:/VertexData/backups}"
VIA="${ALERT_VIA:-vertex-dev}"
WINDOW_H="${ALERT_WINDOW_HOURS:-6}"
STATE="$ROOT/logs/alert-state"; mkdir -p "$STATE"
NOW=$(date -u +%s); TS=$(date -u +%FT%TZ)

line=$(python -c 'import json,sys; print(json.dumps({"ts":sys.argv[1],"level":"alert","event":"alert.raised","rule":sys.argv[2],"summary":sys.argv[3],"detail":sys.argv[4]}))' "$TS" "$RULE" "$SUMMARY" "$DETAIL")
echo "$line" >> "$ROOT/logs/alerts.log"
echo "$line"

last=$(cat "$STATE/$RULE" 2>/dev/null || echo 0)
if [ $((NOW - last)) -lt $((WINDOW_H * 3600)) ]; then
  echo "alert $RULE already sent within ${WINDOW_H} h; not repeated"
  exit 0
fi
echo "$NOW" > "$STATE/$RULE"

# The stack to send through: ALERT_VIA, else any running stack.
for p in "$VIA" vertex-main vertex-staging vertex-dev; do
  if [ "$(docker inspect -f '{{.State.Running}}' "$p-backend-1" 2>/dev/null)" = true ]; then VIA="$p"; break; fi
done

BE="$(cd "$(dirname "$0")/../.." && { pwd -W 2>/dev/null || pwd; })"
ENVF="$BE/.env.${VIA#vertex-}"
if [ -f "$ENVF" ]; then
  v() { grep -E "^$1=" "$ENVF" | tail -1 | cut -d= -f2- | tr -d '\r'; }
  docker exec -i "$VIA-db-1" psql -U "$(v POSTGRES_USER)" -d "$(v POSTGRES_DB)" -v ON_ERROR_STOP=1 -q \
    -v rule="$RULE" -v summary="$SUMMARY" -v detail="$DETAIL" >/dev/null 2>&1 <<'SQL' || echo "alert: audit row not written"
INSERT INTO "AuditLog" (id, entity_type, entity_id, action, after)
VALUES ('calert' || md5(random()::text || clock_timestamp()::text), 'SecurityAlert', 'backup:' || :'rule', 'alert_raised',
        jsonb_build_object('rule', :'rule', 'severity', 'high', 'summary', :'summary', 'detail', :'detail', 'source', 'backup'));
SQL
fi

SUBJECT="[Vertex ${VIA#vertex-}] Backup alert: $SUMMARY"
TEXT="$SUMMARY.

Rule:    $RULE
Time:    $TS
Details: ${DETAIL:-none}

Runbook: docs/security/backup-recovery.md. Logs: $ROOT/logs/."
docker exec -e ALERT_SUBJECT="$SUBJECT" -e ALERT_TEXT="$TEXT" -e ALERT_TO="${ALERT_TO:-}" "$VIA-backend-1" python -c '
import os
from app.core.mailer import send_mail
from app.services.security_monitor import alert_recipients
to = [a.strip() for a in os.environ["ALERT_TO"].split(",") if a.strip()] or alert_recipients()
try:
    sent = bool(to) and send_mail(to, os.environ["ALERT_SUBJECT"], os.environ["ALERT_TEXT"])
    print(f"alert email sent to {len(to)} recipient(s)" if sent else "alert email skipped (no recipients or SMTP)")
except Exception as e:
    print(f"alert email failed: {e}")
' 2>&1 | tail -1 || echo "alert: email not sent"
exit 0
