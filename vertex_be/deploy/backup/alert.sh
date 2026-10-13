#!/usr/bin/env bash
# Raises a backup alert (E5), the same way the app raises security alerts
# (Phase 10): a log line, an `alert_raised` row in the audit trail, and an
# email to SECURITY_ALERT_EMAILS (default: every admin), sent through the
# stack's own Next.js container so it uses that stack's SMTP settings
# (Mailpit locally, a real relay in production).
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
VIA="${ALERT_VIA:-vertex-main}"
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
  if [ "$(docker inspect -f '{{.State.Running}}' "$p-nextjs-1" 2>/dev/null)" = true ]; then VIA="$p"; break; fi
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
docker exec -e ALERT_SUBJECT="$SUBJECT" -e ALERT_TEXT="$TEXT" -e ALERT_TO="${ALERT_TO:-}" -w /app "$VIA-nextjs-1" node -e '
const nodemailer = require("nodemailer");
const { PrismaClient } = require("@prisma/client");
(async () => {
  let to = (process.env.ALERT_TO || process.env.SECURITY_ALERT_EMAILS || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!to.length) {
    const prisma = new PrismaClient();
    to = (await prisma.user.findMany({ where: { role: "admin" }, select: { email: true } })).map((u) => u.email);
    await prisma.$disconnect();
  }
  if (!to.length || !process.env.SMTP_HOST) { console.log("alert email skipped (no recipients or SMTP)"); return; }
  const t = nodemailer.createTransport({
    host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT) || 587, secure: process.env.SMTP_SECURE === "true",
    ...(process.env.SMTP_USER ? { auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } } : {}),
  });
  await t.sendMail({ from: process.env.EMAIL_FROM || "Vertex <noreply@vertex.invalid>", to, subject: process.env.ALERT_SUBJECT, text: process.env.ALERT_TEXT });
  console.log(`alert email sent to ${to.length} recipient(s)`);
})().catch((e) => { console.log("alert email failed: " + e.message); });
' 2>&1 | tail -1 || echo "alert: email not sent"
exit 0
