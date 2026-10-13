#!/usr/bin/env bash
# Restore drill (Phase 11): proves a backup can actually be restored and
# used, not just that the file exists.
#
#   bash deploy/backup/restore-drill.sh [project] [backup-dir]   (from vertex_be/)
#   default: vertex-main, its newest complete backup
#
# Everything happens in throwaway containers on a new internal Docker
# network (no published ports, no internet), removed at the end whatever
# happens. The live stack is only read: its image names, nothing else.
#
#   1. Checksums of the encrypted files match the manifest.
#   2. The database is decrypted straight into a fresh Postgres (no
#      plaintext on disk); its checksum matches the manifest.
#   3. Integrity: exact row counts per table, schema version, constraints
#      validated, audit-trail triggers present.
#   4. Roles provisioned as deploy.sh does (throwaway passwords).
#   5. Application compatibility, with the stack's current images (or
#      IMAGES_FROM=<project>'s, e.g. the release candidate on vertex-dev):
#      - backend: migrates the restored database to head (the real
#        recovery path), `alembic check` finds no model drift, /health ok
#        as vertex_api;
#      - Next.js: Prisma reads every row of every model as vertex_web.
#   6. Documents: the archive decrypts, its tree hash matches the manifest,
#      and every Document.storage_path in the database is in it.
#   7. Secrets: no env-file secret, private key, cloud/Stripe key,
#      credentialed URL or JWT in the dump; only expected files in the
#      backup and in the archive.
# Writes a report to $BACKUP_ROOT/drills/<project>-<stamp>.md and exits 1
# if any mandatory check fails. The elapsed time is the measured restore
# time (RTO evidence).
set -uo pipefail
export MSYS_NO_PATHCONV=1

P="${1:-vertex-main}"
ENV_FILE=".env.${P#vertex-}"
HERE="$(cd "$(dirname "$0")" && { pwd -W 2>/dev/null || pwd; })"
BE="$(cd "$HERE/../.." && { pwd -W 2>/dev/null || pwd; })"
ROOT="${BACKUP_ROOT:-D:/VertexData/backups}"
B="${2:-$(ls -d "$ROOT/$P"/*/ 2>/dev/null | while read -r d; do [ -f "$d/manifest.json" ] && echo "${d%/}"; done | sort | tail -1)}"
[ -n "$B" ] && [ -f "$B/manifest.json" ] || { echo "No complete backup for $P under $ROOT" >&2; exit 2; }
STAMP=$(date -u +%Y%m%dT%H%M%SZ); START=$(date +%s)
ID="vertex-drill-$(date +%s)"; NET="$ID-net"; DBC="$ID-db"; BEC="$ID-backend"
WORK=$(cygpath -m "$(mktemp -d)" 2>/dev/null || mktemp -d)
export GNUPGHOME=$(mktemp -d); chmod 700 "$GNUPGHOME"
REPORT_DIR="$ROOT/drills"; mkdir -p "$REPORT_DIR"; REPORT="$REPORT_DIR/$P-$STAMP.md"
cleanup() {
  docker rm -f "$DBC" "$BEC" >/dev/null 2>&1; docker network rm "$NET" >/dev/null 2>&1
  gpgconf --kill all >/dev/null 2>&1; rm -rf "$WORK" "$GNUPGHOME"
}
trap cleanup EXIT

FAILED=0; ROWS=""
check() {  # name, result, expected
  if [ "$2" = "$3" ]; then ROWS+="| $1 | $2 | ✅ |"$'\n'; else ROWS+="| $1 | $2 (expected $3) | ❌ |"$'\n'; FAILED=1; fi
  printf '%s: %s\n' "$1" "$2"
}
info() { ROWS+="| $1 | $2 | |"$'\n'; printf '%s: %s\n' "$1" "$2"; }
m() { python -c "import json,sys; d=json.load(open(sys.argv[1])); v=d
for k in sys.argv[2].split('.'): v=v[k]
print(v if not isinstance(v,(dict,list)) else json.dumps(v, sort_keys=True))" "$B/manifest.json" "$1"; }
decrypt() {
  gpg --batch --quiet --pinentry-mode loopback --passphrase-fd 3 --decrypt "$1" \
    3< <(powershell -NoProfile -ExecutionPolicy Bypass -File "$HERE/backup-key.ps1" get)
}
sha() { sha256sum "$1" | cut -d' ' -f1; }
sqlr() { docker exec "$DBC" psql -U postgres -d drill -tAc "$1" | tr -d '\r'; }

echo "== drill: $B"
info "Backup" "\`$(basename "$B")\` ($P, schema $(m alembic_version))"

# 1. Files and checksums
check "Files in the backup" "$(ls "$B" | sort | tr '\n' ' ' | sed 's/ $//')" "db.dump.gpg documents.tar.gpg manifest.json"
check "db.dump.gpg checksum" "$( [ "$(sha "$B/db.dump.gpg")" = "$(m database.encrypted_sha256)" ] && echo match || echo mismatch)" match
check "documents.tar.gpg checksum" "$( [ "$(sha "$B/documents.tar.gpg")" = "$(m documents.encrypted_sha256)" ] && echo match || echo mismatch)" match

# 2. Disposable database, then restore
PGMAJOR=$(m postgres_version | cut -d. -f1)
docker network create --internal "$NET" >/dev/null
docker run -d --name "$DBC" --network "$NET" --tmpfs /var/lib/postgresql/data \
  -e POSTGRES_HOST_AUTH_METHOD=trust -e POSTGRES_DB=drill "postgres:${PGMAJOR}-alpine" >/dev/null
until docker exec "$DBC" pg_isready -U postgres -d drill -q 2>/dev/null; do sleep 1; done; sleep 2
decrypt "$B/db.dump.gpg" | python "$HERE/streamstat.py" "$WORK/db.json" \
  | docker exec -i "$DBC" pg_restore -U postgres -d drill --no-owner --no-privileges --exit-on-error 2>"$WORK/restore.err"
check "Database restore (pg_restore)" "$( [ -s "$WORK/restore.err" ] && echo "errors: $(head -c 200 "$WORK/restore.err")" || echo ok)" ok
check "Decrypted dump checksum" "$(python -c "import json,sys; print('match' if json.load(open(sys.argv[1]))['sha256']==sys.argv[2] else 'mismatch')" "$WORK/db.json" "$(m database.plain_sha256)")" match

# 3. Integrity
COUNTS_SQL="select json_object_agg(table_name, n order by table_name) from (
  select table_name, (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from public.%I', table_name), false, true, '')))[1]::text::bigint as n
  from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE') t"
restored=$(sqlr "$COUNTS_SQL")
diffs=$(python -c "import json,sys; a=json.loads(sys.argv[1]); b=json.loads(sys.argv[2]); d=[k for k in set(a)|set(b) if a.get(k)!=b.get(k)]; print(', '.join(sorted(d)) or 'none')" "$restored" "$(m tables)")
check "Row counts per table vs manifest" "$diffs" none
info "Rows restored" "$(python -c "import json,sys; d=json.loads(sys.argv[1]); print(f'{sum(d.values())} in {len(d)} tables')" "$restored")"
check "Schema version" "$(sqlr 'select version_num from alembic_version')" "$(m alembic_version)"
check "Unvalidated constraints" "$(sqlr "select count(*) from pg_constraint where not convalidated")" 0
check "Audit-trail immutability triggers" "$(sqlr "select count(*) from pg_trigger where tgname in ('audit_log_no_update','audit_log_no_delete')")" 2

# 4. Roles, as deploy.sh provisions them (throwaway passwords, this drill only)
# db-roles.sql also hands every object to vertex_migrator, as on a stack.
pw() { python -c "import secrets; print(secrets.token_hex(16))"; }
MIG_PW=$(pw); API_PW=$(pw); WEB_PW=$(pw)
{ printf "\\set migrator_pw '%s'\n\\set api_pw '%s'\n\\set web_pw '%s'\n\\set readonly_pw ''\n" "$MIG_PW" "$API_PW" "$WEB_PW"
  cat "$BE/deploy/readonly-columns.sql" "$BE/deploy/db-roles.sql"; } | docker exec -i "$DBC" psql -q -U postgres -d drill >/dev/null 2>"$WORK/roles.err"
check "Roles provisioned (db-roles.sql)" "$(grep -c ERROR "$WORK/roles.err")" 0

# 5. Application compatibility with the stack's current images
# IMAGES_FROM picks the stack whose images are tested, e.g. vertex-dev to
# check main's data against the release candidate.
IMGS="${IMAGES_FROM:-$P}"
BIMG=$(docker inspect -f '{{.Config.Image}}' "$IMGS-backend-1"); NIMG=$(docker inspect -f '{{.Config.Image}}' "$IMGS-nextjs-1")
info "Images tested" "\`${BIMG##*/}\`, \`${NIMG##*/}\`"
docker run -d --name "$BEC" --network "$NET" \
  -e APP_ENV=development -e DATABASE_URL="postgresql://vertex_api:$API_PW@$DBC:5432/drill" \
  -e MIGRATION_DATABASE_URL="postgresql://vertex_migrator:$MIG_PW@$DBC:5432/drill" "$BIMG" >/dev/null
for i in $(seq 1 60); do
  h=$(docker exec "$BEC" python -c "import urllib.request,json; print(json.load(urllib.request.urlopen('http://localhost:8000/api/v1/health'))['database'])" 2>/dev/null) && break; sleep 2
done
check "Backend migrated the restore to head and is healthy" "${h:-no answer}" ok
info "Schema version after upgrade" "$(sqlr 'select version_num from alembic_version')"
check "Backend models vs restored schema (alembic check)" "$(docker exec -e DATABASE_URL="postgresql://postgres@$DBC:5432/drill" "$BEC" alembic check >/dev/null 2>&1 && echo "no drift" || echo drift)" "no drift"
docker run --rm --network "$NET" --entrypoint node -e DATABASE_URL="postgresql://vertex_web:$WEB_PW@$DBC:5432/drill" "$NIMG" -e '
  const { PrismaClient, Prisma } = require("/app/node_modules/@prisma/client");
  const prisma = new PrismaClient();
  (async () => {
    const bad = [];
    let rows = 0;
    for (const m of Prisma.dmmf.datamodel.models) {
      const d = m.name.charAt(0).toLowerCase() + m.name.slice(1);
      try { rows += (await prisma[d].findMany()).length; } catch (e) { bad.push(`${m.name}: ${String(e.message).split("\n").filter(Boolean).pop().slice(0, 120)}`); }
    }
    console.log(JSON.stringify({ models: Prisma.dmmf.datamodel.models.length, rows, bad }));
    await prisma.$disconnect();
  })();' 2>/dev/null | tail -1 > "$WORK/prisma.json"
check "Next.js (Prisma) reads every model" "$(python -c "import json,sys; d=json.load(open(sys.argv[1])); print('all %d models' % d['models'] if not d['bad'] else 'unreadable: ' + '; '.join(d['bad']))" "$WORK/prisma.json" 2>/dev/null || echo "no answer")" "all $(python -c "import json,sys; print(json.load(open(sys.argv[1]))['models'])" "$WORK/prisma.json" 2>/dev/null || echo '?') models"

# 6. Documents
decrypt "$B/documents.tar.gpg" | python "$HERE/streamstat.py" "$WORK/docs.json" --tar --quiet
check "Documents archive tree hash" "$(python -c "import json,sys; print('match' if json.load(open(sys.argv[1]))['tree_sha256']==sys.argv[2] else 'mismatch')" "$WORK/docs.json" "$(m documents.tree_sha256)")" match
sqlr 'select storage_path from "Document" where storage_path is not null' > "$WORK/paths.txt"
check "Database documents missing from the archive" "$(python -c "
import json,sys
names=set(json.load(open(sys.argv[1]))['names'])
paths=[l.strip() for l in open(sys.argv[2]) if l.strip()]
print(sum(1 for p in paths if p not in names))" "$WORK/docs.json" "$WORK/paths.txt")" 0
info "Documents" "$(python -c "import json,sys; d=json.load(open(sys.argv[1])); print(f\"{d['files']} files, {d['file_bytes']} bytes\")" "$WORK/docs.json")"
check "Unexpected files in the archive" "$(python -c "
import json,re,sys
ok=re.compile(r'^[a-z0-9_]+/[0-9a-f-]{36}\.(pdf|jpe?g|png)$')
print(sum(1 for n in json.load(open(sys.argv[1]))['names'] if not ok.match(n)))" "$WORK/docs.json")" 0

# 7. Secrets
decrypt "$B/db.dump.gpg" | docker exec -i "$DBC" pg_restore -f - 2>/dev/null | python "$HERE/scan_secrets.py" "$BE/$ENV_FILE" "$WORK/secrets.json"
check "Env-file secrets found in the dump" "$(python -c "import json,sys; d=json.load(open(sys.argv[1])); print(len(d['env_secrets']) if d['env_secrets_checked'] else 'none checked')" "$WORK/secrets.json")" 0
check "Credential patterns in the dump" "$(python -c "import json,sys; d=json.load(open(sys.argv[1]))['patterns']; print(', '.join(f'{k}={v}' for k,v in d.items() if v) or 'none')" "$WORK/secrets.json")" none
info "Password hashes (expected: needed to sign in after restore)" "$(python -c "import json,sys; print(json.load(open(sys.argv[1]))['expected']['bcrypt_hash'])" "$WORK/secrets.json")"
check "Credential patterns in the manifest" "$(python "$HERE/scan_secrets.py" "$BE/$ENV_FILE" "$WORK/mf.json" < "$B/manifest.json"; python -c "import json,sys; d=json.load(open(sys.argv[1])); print('none' if d['clean'] else 'found')" "$WORK/mf.json")" none

ELAPSED=$(( $(date +%s) - START ))
info "Elapsed (decrypt, restore, migrate, verify)" "${ELAPSED}s"
{
  echo "# Restore drill: $P"
  echo
  echo "Run $STAMP from \`$B\`. Result: $([ $FAILED = 0 ] && echo '**PASSED**' || echo '**FAILED**')."
  echo
  echo "| Check | Result | |"; echo "|---|---|---|"; printf '%s' "$ROWS"
} > "$REPORT"
echo "== $([ $FAILED = 0 ] && echo PASSED || echo FAILED) in ${ELAPSED}s; report: $REPORT"
exit $FAILED
