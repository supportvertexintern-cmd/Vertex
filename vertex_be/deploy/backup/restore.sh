#!/usr/bin/env bash
# Restores a stack from one of its backups (Phase 11 recovery procedure).
# DESTRUCTIVE: replaces the stack's database and documents.
#
#   bash deploy/backup/restore.sh <project> <backup-dir> --yes-replace-<project>
#   e.g. bash deploy/backup/restore.sh vertex-staging \
#          D:/VertexData/backups/vertex-staging/20261011T103439Z --yes-replace-vertex-staging
#
# Steps (docs/security/backup-recovery.md §6):
#   1. Verify the backup's checksums.
#   2. Stop the app containers (nothing writes during the restore).
#   3. Safety backup of the current state, unless the database is unreadable.
#   4. Recreate the database and restore the dump into it (decrypted in a
#      pipe, never on disk).
#   5. Re-provision roles and ownership (deploy/db-roles.sql via deploy.sh's
#      method); the backend migrates to head when it starts.
#   6. Replace the bucket's documents with the backup's.
#   7. Start the stack and wait for health; row counts must equal the
#      manifest (before any migration changed nothing but schema).
set -euo pipefail
export MSYS_NO_PATHCONV=1

P="${1:?usage: restore.sh <project> <backup-dir> --yes-replace-<project>}"
B="${2:?backup dir}"
[ "${3:-}" = "--yes-replace-$P" ] || { echo "Refusing: pass --yes-replace-$P to confirm replacing $P's data" >&2; exit 2; }
ENV_FILE=".env.${P#vertex-}"
HERE="$(cd "$(dirname "$0")" && { pwd -W 2>/dev/null || pwd; })"
BE="$(cd "$HERE/../.." && { pwd -W 2>/dev/null || pwd; })"
cd "$BE"
v() { grep -E "^$1=" "$ENV_FILE" | tail -1 | cut -d= -f2- | tr -d '\r'; }
SU=$(v POSTGRES_USER); DB=$(v POSTGRES_DB); BUCKET=$(v S3_BUCKET)
log() { printf '%s %s\n' "$(date -u +%FT%TZ)" "$*"; }
export GNUPGHOME=$(mktemp -d); chmod 700 "$GNUPGHOME"
WORK=$(cygpath -m "$(mktemp -d)" 2>/dev/null || mktemp -d)
trap 'gpgconf --kill all >/dev/null 2>&1; rm -rf "$GNUPGHOME" "$WORK"' EXIT
decrypt() {
  gpg --batch --quiet --pinentry-mode loopback --passphrase-fd 3 --decrypt "$1" \
    3< <(powershell -NoProfile -ExecutionPolicy Bypass -File "$HERE/backup-key.ps1" get)
}
m() { python -c "import json,sys; v=json.load(open(sys.argv[1]))
for k in sys.argv[2].split('.'): v=v[k]
print(json.dumps(v, sort_keys=True) if isinstance(v,(dict,list)) else v)" "$B/manifest.json" "$1"; }
psql_su() { docker exec "$P-db-1" psql -U "$SU" -d "$1" -tAc "$2" | tr -d '\r'; }
COUNTS_SQL="select json_object_agg(table_name, n order by table_name) from (
  select table_name, (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from public.%I', table_name), false, true, '')))[1]::text::bigint as n
  from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE') t"

log "1. verify $B"
[ "$(m project)" = "$P" ] || { echo "Backup is for $(m project), not $P" >&2; exit 2; }
[ "$(sha256sum "$B/db.dump.gpg" | cut -d' ' -f1)" = "$(m database.encrypted_sha256)" ] || { echo "db.dump.gpg checksum mismatch" >&2; exit 1; }
[ "$(sha256sum "$B/documents.tar.gpg" | cut -d' ' -f1)" = "$(m documents.encrypted_sha256)" ] || { echo "documents.tar.gpg checksum mismatch" >&2; exit 1; }

log "2. stop app containers"
docker stop "$P-nextjs-1" "$P-backend-1" >/dev/null

log "3. safety backup of the current state"
if bash "$HERE/backup.sh" "$P" "$ENV_FILE" > "$WORK/safety.log" 2>&1; then
  log "   $(grep 'done:' "$WORK/safety.log" | sed 's/.*done: //')"
else
  log "   skipped (current database unreadable); see the log below"; tail -3 "$WORK/safety.log"
fi

log "4. recreate database $DB and restore"
psql_su postgres "select pg_terminate_backend(pid) from pg_stat_activity where datname = '$DB' and pid <> pg_backend_pid()" >/dev/null
psql_su postgres "drop database \"$DB\"" >/dev/null
psql_su postgres "create database \"$DB\"" >/dev/null
decrypt "$B/db.dump.gpg" | docker exec -i "$P-db-1" pg_restore -U "$SU" -d "$DB" --no-owner --no-privileges --exit-on-error
restored=$(psql_su "$DB" "$COUNTS_SQL")
python -c "import json,sys; a=json.loads(sys.argv[1]); b=json.loads(sys.argv[2]); d=[k for k in set(a)|set(b) if a.get(k)!=b.get(k)]; sys.exit('row counts differ: '+', '.join(d) if d else 0)" "$restored" "$(m tables)"
log "   row counts match the manifest ($(python -c "import json,sys; print(sum(json.loads(sys.argv[1]).values()))" "$restored") rows)"

log "5. roles and ownership"
{
  printf "\\set migrator_pw '%s'\n\\set api_pw '%s'\n\\set web_pw '%s'\n\\set readonly_pw '%s'\n" \
    "$(v DB_MIGRATOR_PASSWORD)" "$(v DB_API_PASSWORD)" "$(v DB_WEB_PASSWORD)" "$(v DB_READONLY_PASSWORD)"
  cat "$BE/deploy/readonly-columns.sql" "$BE/deploy/db-roles.sql"
} | docker exec -i "$P-db-1" psql -q -v ON_ERROR_STOP=1 -U "$SU" -d "$DB" >/dev/null

log "6. documents"
MI=$(docker inspect -f '{{.Config.Image}}' "$P-minio-1")
printf 'MC_HOST_app=http://%s:%s@minio:9000\nMC_CONFIG_DIR=/tmp/.mc\n' "$(v S3_ACCESS_KEY_ID)" "$(v S3_SECRET_ACCESS_KEY)" > "$WORK/mc.env"
decrypt "$B/documents.tar.gpg" | docker run --rm -i --network "${P}_data" --env-file "$WORK/mc.env" --entrypoint sh "$MI" \
  -c "mkdir -p /tmp/d && tar -C /tmp/d -xf - && mc mirror --quiet --overwrite --remove /tmp/d app/$BUCKET >/dev/null && find /tmp/d -type f | wc -l"
rm -f "$WORK/mc.env"

log "7. start and wait for health"
docker start "$P-backend-1" >/dev/null
until [ "$(docker inspect -f '{{.State.Health.Status}}' "$P-backend-1")" = healthy ]; do sleep 2; done
docker start "$P-nextjs-1" >/dev/null
until [ "$(docker inspect -f '{{.State.Health.Status}}' "$P-nextjs-1")" = healthy ]; do sleep 2; done
log "   schema $(psql_su "$DB" 'select version_num from alembic_version'); restored from $(m created_at) (schema $(m alembic_version))"
log "done. Next: bash deploy/verify-stack.sh ${P#vertex-}"
