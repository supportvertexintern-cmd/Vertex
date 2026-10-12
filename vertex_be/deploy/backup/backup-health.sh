#!/usr/bin/env bash
# Hourly backup health check (E5). Alerts (alert.sh) when:
#   - vertex-main's newest complete local backup is older than 7 h
#     (6-hourly schedule, RPO 6 h), vertex-staging's older than 8 days;
#   - the newest off-site push of vertex-main is older than 26 h
#     (only once off-site is configured; until then it says so in the log);
#   - the newest restore drill report is older than 35 days.
#
#   bash deploy/backup/backup-health.sh        (from vertex_be/)
set -u
export MSYS_NO_PATHCONV=1
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="${BACKUP_ROOT:-D:/VertexData/backups}"
CONF="${OFFSITE_CONF:-D:/VertexData/backup-keys/offsite.conf}"
NOW=$(date -u +%s)
problems=0

age_h() { python -c "import sys,datetime as d; t=d.datetime.strptime(sys.argv[1],'%Y%m%dT%H%M%SZ').replace(tzinfo=d.timezone.utc); print(int((d.datetime.now(d.timezone.utc)-t).total_seconds()//3600))" "$1"; }
newest() { ls -d "$ROOT/$1"/*/ 2>/dev/null | while read -r d; do [ -f "$d/manifest.json" ] && basename "$d"; done | sort | tail -1; }

for spec in vertex-main:7 vertex-staging:192; do
  p=${spec%%:*}; max=${spec##*:}
  n=$(newest "$p")
  if [ -z "$n" ]; then
    echo "$p: no complete backup"; bash "$HERE/alert.sh" "backup_missing_$p" "No complete backup of $p" "root $ROOT"; problems=1; continue
  fi
  h=$(age_h "$n")
  echo "$p: newest backup $n (${h} h old, limit ${max} h)"
  if [ "$h" -gt "$max" ]; then bash "$HERE/alert.sh" "backup_stale_$p" "The newest backup of $p is ${h} hours old" "newest $n; limit ${max} h"; problems=1; fi
done

if [ -f "$CONF" ]; then
  st="$ROOT/offsite-state/vertex-main.json"
  if [ ! -f "$st" ]; then
    echo "off-site: vertex-main never pushed"; bash "$HERE/alert.sh" offsite_missing "vertex-main has never been copied off-site" "config $CONF"; problems=1
  else
    h=$(python -c "import json,sys,datetime as d; s=json.load(open(sys.argv[1])); print(int((d.datetime.now(d.timezone.utc)-d.datetime.fromisoformat(s['pushed_at'])).total_seconds()//3600))" "$st")
    echo "off-site: newest vertex-main push ${h} h ago (limit 26 h)"
    if [ "$h" -gt 26 ]; then bash "$HERE/alert.sh" offsite_stale "No off-site copy of vertex-main for ${h} hours" "state $st"; problems=1; fi
  fi
else
  echo "off-site: not configured ($CONF missing; exception E5 still open)"
fi

d=$(ls "$ROOT/drills"/vertex-main-*.md 2>/dev/null | sort | tail -1)
if [ -n "$d" ]; then
  s=$(basename "$d" .md); s=${s#vertex-main-}
  h=$(age_h "$s"); echo "drill: newest $s (${h} h old, limit 840 h)"
  if [ "$h" -gt 840 ]; then bash "$HERE/alert.sh" drill_overdue "No restore drill of vertex-main for $((h / 24)) days" "newest report $d"; problems=1; fi
fi
exit $problems
