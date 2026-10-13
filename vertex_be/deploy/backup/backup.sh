#!/usr/bin/env bash
# Encrypted backup of one local stack (Phase 11).
#
#   bash deploy/backup/backup.sh <project> [env-file]     (from vertex_be/)
#   e.g. bash deploy/backup/backup.sh vertex-main .env.main
#
# Writes $BACKUP_ROOT/<project>/<UTC stamp>/ (default root D:/VertexData/backups):
#   db.dump.gpg         pg_dump (custom format) of the stack's database
#   documents.tar.gpg   every object in the stack's MinIO bucket
#   manifest.json       what a restore must reproduce: row counts per table,
#                       document count and tree hash, schema version, and
#                       checksums of the plaintext and encrypted files
#
# Both data files are streamed from the containers straight into gpg
# (AES-256, authenticated), so no plaintext copy is ever written. The key
# comes from backup-key.ps1 (DPAPI, this Windows account) through a file
# descriptor. The manifest holds no personal data or credentials. Then the
# retention policy is applied (prune.py) and, once off-site is configured
# (offsite.conf, E5), the backup is copied to the immutable off-site bucket
# (offsite.py push). A failed backup or a failed off-site copy raises an
# alert (alert.sh).
#
# Roles and their passwords are not in the dump (they're cluster-wide);
# deploy.sh recreates them from the env file on restore. Secrets, env files
# and keys are never part of a backup (checked by restore-drill.sh).
set -Eeuo pipefail
export MSYS_NO_PATHCONV=1

P="${1:?usage: backup.sh <project> [env-file]}"
ENV_FILE="${2:-.env.${P#vertex-}}"
HERE="$(cd "$(dirname "$0")" && { pwd -W 2>/dev/null || pwd; })"
ROOT="${BACKUP_ROOT:-D:/VertexData/backups}"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
OUT="$ROOT/$P/$STAMP"
v() { grep -E "^$1=" "$ENV_FILE" | tail -1 | cut -d= -f2- | tr -d '\r'; }
SU=$(v POSTGRES_USER); DB=$(v POSTGRES_DB); BUCKET=$(v S3_BUCKET)
case "$P" in vertex-main) POLICY=main ;; *) POLICY=staging ;; esac

log() { printf '%s %s\n' "$(date -u +%FT%TZ)" "$*"; }
# E5: a failed backup says so (email + audit trail), not only in a log.
trap 'bash "$HERE/alert.sh" "backup_failed_$P" "The backup of $P failed" "see $ROOT/logs/backup-$P.log" >/dev/null 2>&1' ERR
psql_su() { docker exec "$P-db-1" psql -U "$SU" -d "$DB" -tAc "$1" | tr -d '\r'; }

# Windows form (C:/...): Python and Docker here are Windows programs.
WORK=$(cygpath -m "$(mktemp -d)" 2>/dev/null || mktemp -d)
MCENV="$WORK/mc.env"
# A throwaway keyring, never the user's own. POSIX path: gpg is an MSYS
# program and its agent socket needs one.
export GNUPGHOME=$(mktemp -d)
cleanup() { gpgconf --kill all >/dev/null 2>&1 || true; rm -rf "$WORK" "$GNUPGHOME"; }
trap cleanup EXIT
mkdir -p "$OUT"; chmod 700 "$GNUPGHOME"

# Reads the key from fd 3 (backup-key.ps1 get), writes $1.
encrypt() {
  gpg --batch --yes --quiet --pinentry-mode loopback --passphrase-fd 3 \
    --symmetric --cipher-algo AES256 --s2k-digest-algo SHA512 --compress-algo none \
    -o "$1" 3< <(powershell -NoProfile -ExecutionPolicy Bypass -File "$HERE/backup-key.ps1" get)
}

# Exact row counts for every table, as JSON, in one statement.
COUNTS_SQL="select json_object_agg(table_name, n order by table_name) from (
  select table_name, (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from public.%I', table_name), false, true, '')))[1]::text::bigint as n
  from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE') t"

log "backup $P -> $OUT"
log "database"
before=$(psql_su "$COUNTS_SQL")
docker exec "$P-db-1" pg_dump -U "$SU" -d "$DB" -Fc -Z 6 \
  | python "$HERE/streamstat.py" "$WORK/db.json" | encrypt "$OUT/db.dump.gpg"
after=$(psql_su "$COUNTS_SQL")
# pg_dump reads one snapshot; equal counts before and after mean the
# manifest describes exactly what was dumped.
[ "$before" = "$after" ] && consistent=true || consistent=false

log "documents"
MI=$(docker inspect -f '{{.Config.Image}}' "$P-minio-1")
printf 'MC_HOST_app=http://%s:%s@minio:9000\nMC_CONFIG_DIR=/tmp/.mc\n' "$(v S3_ACCESS_KEY_ID)" "$(v S3_SECRET_ACCESS_KEY)" > "$MCENV"
docker run --rm --network "${P}_data" --env-file "$(cygpath -w "$MCENV" 2>/dev/null || echo "$MCENV")" --entrypoint sh "$MI" \
  -c "mkdir -p /tmp/d && mc mirror --quiet app/$BUCKET /tmp/d >/dev/null && tar -C /tmp/d -cf - ." \
  | python "$HERE/streamstat.py" "$WORK/docs.json" --tar | encrypt "$OUT/documents.tar.gpg"
rm -f "$MCENV"

log "manifest"
python - "$OUT" "$WORK" "$P" "$STAMP" "$after" "$consistent" \
  "$(psql_su 'select version_num from alembic_version')" \
  "$(psql_su 'show server_version')" \
  "$(docker inspect -f '{{.Config.Image}}' "$P-backend-1")" <<'PY'
import hashlib, json, sys
from pathlib import Path
out, work, project, stamp, counts, consistent, alembic, pg, image = sys.argv[1:]
def sha(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""): h.update(b)
    return h.hexdigest()
db, docs = (json.load(open(Path(work) / n)) for n in ("db.json", "docs.json"))
manifest = {
    "format": 1, "project": project, "created_at": stamp,
    "alembic_version": alembic, "postgres_version": pg, "backend_image": image,
    "tables": json.loads(counts), "counts_consistent": consistent == "true",
    "database": {"file": "db.dump.gpg", "plain_bytes": db["bytes"], "plain_sha256": db["sha256"],
                 "encrypted_sha256": sha(Path(out) / "db.dump.gpg")},
    "documents": {"file": "documents.tar.gpg", "files": docs["files"], "file_bytes": docs["file_bytes"],
                  "tree_sha256": docs["tree_sha256"], "plain_sha256": docs["sha256"],
                  "encrypted_sha256": sha(Path(out) / "documents.tar.gpg")},
    "encryption": "gpg symmetric AES-256 (SHA-512 S2K), key: backup-key.ps1 (DPAPI)",
}
# Written last: a directory without a manifest is an incomplete backup.
(Path(out) / "manifest.json").write_text(json.dumps(manifest, indent=2))
print(f"{sum(manifest['tables'].values())} rows in {len(manifest['tables'])} tables, {docs['files']} documents")
PY

log "retention ($POLICY)"
python "$HERE/prune.py" "$ROOT/$P" "$POLICY" --apply

if [ -f "${OFFSITE_CONF:-D:/VertexData/backup-keys/offsite.conf}" ]; then
  log "off-site copy"
  # The local backup stands either way; a failed copy alerts, and the
  # health check alerts again if no copy succeeds for 26 hours.
  python "$HERE/offsite.py" push "$OUT" \
    || bash "$HERE/alert.sh" "offsite_failed_$P" "Copying the backup of $P off-site failed" "$OUT"
fi
log "done: $OUT"
