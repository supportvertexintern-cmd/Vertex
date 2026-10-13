#!/usr/bin/env bash
# Checks one running stack against the Phase 2 security properties and
# prints a markdown table (docs/security/phase2-verification.md):
#
#   LAN_IP=192.168.x.y bash deploy/verify-stack.sh <dev|staging>
#
# LAN_IP is this machine's LAN address; ports must NOT answer on it. Without
# it the LAN rows are skipped. Writes one draft Job row as the superuser and
# deletes it again (G11 check). Run from vertex_be/.
set -u
export MSYS_NO_PATHCONV=1
# pwd -W: Git Bash gives /d/..., which Docker (with MSYS_NO_PATHCONV) can't use.
E="$1"; P="vertex-$E"
BE="$(cd "$(dirname "$0")/.." && { pwd -W 2>/dev/null || pwd; })"; ENVF="$BE/.env.$E"
v() { grep -E "^$1=" "$ENVF" | tail -1 | cut -d= -f2- | tr -d '\r'; }
DB=$(v POSTGRES_DB); SU=$(v POSTGRES_USER)
BP=$(v BACKEND_PORT); NP=$(v NEXTJS_PORT); FP=$(v FLUTTER_PORT); GP=$(v PGADMIN_PORT)
LAN="${LAN_IP:-}"
ok() { if [ "$2" = "$3" ]; then echo "| $1 | $2 | ✅ |"; else echo "| $1 | $2 (expected $3) | ❌ |"; fi; }
code() { curl -s -o /dev/null -m 5 -w '%{http_code}' "$@"; }
net() { docker run --rm --network "${P}_data" -e PGPASSWORD="$2" postgres:15-alpine psql -h db -U "$1" -d "$DB" -tAc "$3" 2>&1 | tr -d '\n' | grep -oE 'permission denied|must be owner|^ *[0-9]+ *$' | head -1 | sed -E 's/^ +| +$//g'; }

echo "### $P"
echo
echo "| Check | Result | |"
echo "|---|---|---|"
imgs=$(docker ps --filter "label=com.docker.compose.project=$P" --format '{{.Image}}' | grep -oE "$E-[0-9a-f]{7}" | sort -u | tr '\n' ' ')
echo "| App images | \`$imgs\` | |"
unhealthy=$(docker ps --filter "label=com.docker.compose.project=$P" --format '{{.Names}} {{.Status}}' | grep -vc healthy)
ok "Containers not healthy" "$unhealthy" 0
for p in $BP $NP $FP; do ok "Port $p from localhost" "$(code http://127.0.0.1:$p/)" 200; [ -z "$LAN" ] || ok "Port $p from the LAN" "$(code http://$LAN:$p/)" 000; done
ok "Postgres published to host" "$(docker port ${P}-db-1 5432 2>/dev/null | wc -l | tr -d ' ')" 0
ok "pgAdmin running (off by default)" "$(docker ps -q --filter name=${P}-pgadmin-1 | wc -l | tr -d ' ')" 0
ok "\`data\` network internal" "$(docker network inspect -f '{{.Internal}}' ${P}_data)" true
ok "Database container → internet" "$(docker exec ${P}-db-1 nc -z -w 5 1.1.1.1 443 >/dev/null 2>&1 && echo yes || echo no)" no
ok "Next.js → database" "$(docker exec ${P}-nextjs-1 nc -z -w 3 db 5432 >/dev/null 2>&1 && echo yes || echo no)" yes
ok "Next.js → internet (best of 3)" "$(for i in 1 2 3; do docker exec ${P}-nextjs-1 nc -z -w 5 1.1.1.1 443 >/dev/null 2>&1 && { echo yes; break; }; done | grep -q yes && echo yes || echo no)" yes
ok "Flutter → database" "$(docker exec ${P}-flutter-web-1 nc -z -w 3 db 5432 >/dev/null 2>&1 && echo yes || echo no)" no
# Fails closed: if the comparison itself errors, report it rather than 0.
missing=$(set -o pipefail; cd "$BE" && IMAGE_TAG=x docker compose -p "$P" --env-file "$ENVF" -f docker-compose.deploy.yml config --format json | python deploy/verify_networks.py "$P" | tr -d '\r' | { grep -c . || true; }) || missing="check failed"
ok "Containers missing a network" "$missing" 0
ok "Backend connects as" "$(docker exec ${P}-backend-1 printenv DATABASE_URL | sed -E 's#postgresql://([^:]+):.*#\1#')" vertex_api
ok "Next.js connects as" "$(docker exec ${P}-nextjs-1 printenv DATABASE_URL | sed -E 's#postgresql://([^:]+):.*#\1#')" vertex_web
ok "vertex_readonly: SELECT id FROM User" "$( [ -n "$(net vertex_readonly "$(v DB_READONLY_PASSWORD)" 'select count(id) from "User"')" ] && echo allowed)" allowed
ok "vertex_readonly: SELECT password_hash" "$(net vertex_readonly "$(v DB_READONLY_PASSWORD)" 'select password_hash from "User" limit 1')" "permission denied"
ok "vertex_readonly: SELECT email (personal data)" "$(net vertex_readonly "$(v DB_READONLY_PASSWORD)" 'select email from "User" limit 1')" "permission denied"
ok "vertex_readonly: read AuditLog" "$(net vertex_readonly "$(v DB_READONLY_PASSWORD)" 'select count(*) from "AuditLog"')" "permission denied"
ok "vertex_web: UPDATE AuditLog" "$(net vertex_web "$(v DB_WEB_PASSWORD)" 'update "AuditLog" set action = action')" "permission denied"
ok "vertex_web: TRUNCATE AuditLog" "$(net vertex_web "$(v DB_WEB_PASSWORD)" 'truncate "AuditLog"')" "permission denied"
ok "vertex_api: read AuditLog (Phase 10)" "$(net vertex_api "$(v DB_API_PASSWORD)" 'select count(*) from "AuditLog"')" "permission denied"
ok "vertex_web: disable AuditLog triggers" "$(net vertex_web "$(v DB_WEB_PASSWORD)" 'alter table "AuditLog" disable trigger audit_log_no_update')" "must be owner"
ok "vertex_api: CREATE TABLE" "$(net vertex_api "$(v DB_API_PASSWORD)" 'create table probe(i int)')" "permission denied"
# Object storage (MinIO). The app's key is handed to a throwaway `mc` through
# an env file, never argv; every probe runs on the internal network.
B=$(v S3_BUCKET)
ok "MinIO published to host" "$(docker port ${P}-minio-1 2>/dev/null | wc -l | tr -d ' ')" 0
src=$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Source}}{{end}}{{end}}' ${P}-minio-1 2>/dev/null)
ok "MinIO files on D:" "$(printf '%s' "$src" | grep -qiE '^(d:|/run/desktop/mnt/host/d/)' && echo yes || echo "no ($src)")" yes
ok "MinIO → internet" "$(docker exec ${P}-minio-1 wget -q -T 5 --spider https://1.1.1.1 >/dev/null 2>&1 && echo yes || echo no)" no
ok "Flutter → MinIO" "$(docker exec ${P}-flutter-web-1 nc -z -w 3 minio 9000 >/dev/null 2>&1 && echo yes || echo no)" no
MI=$(docker inspect -f '{{.Config.Image}}' ${P}-minio-1 2>/dev/null)
MCENV=$(mktemp); printf 'MC_HOST_app=http://%s:%s@minio:9000\nMC_CONFIG_DIR=/tmp/.mc\n' "$(v S3_ACCESS_KEY_ID)" "$(v S3_SECRET_ACCESS_KEY)" > "$MCENV"
# Docker on Windows needs the Windows form of the temp file's path.
MCENV_ARG=$(cygpath -w "$MCENV" 2>/dev/null || printf '%s' "$MCENV")
mcapp() { docker run --rm --network "${P}_data" --env-file "$MCENV_ARG" --entrypoint sh "$MI" -c "$1" 2>&1 | tail -1; }
ok "App key: write, read, delete in its bucket" "$(mcapp "echo probe | mc pipe app/$B/verify-probe.txt >/dev/null && mc cat app/$B/verify-probe.txt >/dev/null && mc rm app/$B/verify-probe.txt >/dev/null && echo ok")" ok
# MinIO filters the bucket list to the key's own buckets rather than refusing.
ok "App key: buckets it can see" "$(mcapp "mc ls app 2>/dev/null | awk '{print \$NF}' | tr '\n' ' ' | sed 's/ *\$//'")" "$B/"
ok "App key: create a bucket" "$(mcapp 'mc mb app/verify-probe-bucket >/dev/null 2>&1 && echo allowed || echo denied')" denied
ok "App key: admin API" "$(mcapp 'mc admin info app >/dev/null 2>&1 && echo allowed || echo denied')" denied
# Denials alone would also pass for a key with no permissions at all (that
# hid a missing policy once); these test the edge inside its own bucket.
ok "App key: make its bucket public" "$(mcapp "mc anonymous set download app/$B >/dev/null 2>&1 && echo allowed || echo denied")" denied
ok "App key: delete its bucket" "$(mcapp "mc rb app/$B >/dev/null 2>&1 && echo allowed || echo denied")" denied
rm -f "$MCENV"
ok "GET /api/admin/emails, no login (G1)" "$(code http://127.0.0.1:$NP/api/admin/emails)" 401
ok "GET /api/admin/knowledge, no login (G2)" "$(code http://127.0.0.1:$NP/api/admin/knowledge)" 401
tok() { docker exec -w /app ${P}-nextjs-1 node -e "$1" 2>/dev/null | tail -1; }
CIF=$(tok 'const c=require("crypto"),j=require("jsonwebtoken");const k=Buffer.from(c.hkdfSync("sha256",process.env.JWT_SECRET,"vertex-token-keys","vertex/jwt/cif_upload/v1",32));console.log(j.sign({candidateId:"probe",type:"cif_upload"},k,{expiresIn:300,algorithm:"HS256",issuer:"vertex-web",audience:"vertex:cif_upload"}))')
LEGACY=$(tok 'const j=require("jsonwebtoken");console.log(j.sign({userId:"probe",email:"p@test.invalid",role:"admin"},process.env.JWT_SECRET,{expiresIn:300,algorithm:"HS256"}))')
ok "Upload token used as a session (G17)" "$(code -H "Cookie: auth_token=$CIF" http://127.0.0.1:$NP/api/auth/me)" 401
ok "Pre-G17 single-key session token (G17)" "$(code -H "Cookie: auth_token=$LEGACY" http://127.0.0.1:$NP/api/auth/me)" 401
# G19: a correctly signed session token is not enough; the session must be
# live in the database.
NOSESSION=$(tok 'const c=require("crypto"),j=require("jsonwebtoken");const k=Buffer.from(c.hkdfSync("sha256",process.env.JWT_SECRET,"vertex-token-keys","vertex/jwt/session/v1",32));console.log(j.sign({userId:"probe",email:"p@test.invalid",role:"admin",sid:"probe",ver:0},k,{expiresIn:300,algorithm:"HS256",issuer:"vertex-web",audience:"vertex:session"}))')
ok "Signed session token, no live session (G19)" "$(code -H "Cookie: auth_token=$NOSESSION" http://127.0.0.1:$NP/api/auth/me)" 401
ok "Refresh without a refresh token (G19)" "$(code -X POST http://127.0.0.1:$NP/api/auth/refresh)" 401
docker exec ${P}-db-1 psql -U "$SU" -d "$DB" -qc "insert into \"Job\" (id,title,country,city,job_description,requirements,status,updated_at) values ('ctest-verify-draft','verify draft','X','X','d','r','draft',now())" >/dev/null
ok "Draft job via API (G11)" "$(code http://127.0.0.1:$NP/api/jobs/ctest-verify-draft)" 404
docker exec ${P}-db-1 psql -U "$SU" -d "$DB" -qc "delete from \"Job\" where id='ctest-verify-draft'" >/dev/null
last=""; for i in 1 2 3 4 5 6; do last=$(code -X POST -H 'content-type: application/json' -H "x-forwarded-for: 203.0.113.$RANDOM" -d '{}' http://127.0.0.1:$NP/api/auth/forgot-password); done
ip="203.0.113.250"; for i in 1 2 3 4 5 6; do last=$(code -X POST -H 'content-type: application/json' -H "x-forwarded-for: $ip-$E" -d '{}' http://127.0.0.1:$NP/api/auth/forgot-password); done
ok "6th forgot-password from one client (G10)" "$last" 429
# Phase 10: logging, correlation and alert plumbing. The trace writes one
# login_failed audit row for an address that can't exist (test.invalid).
MP=$(v MAIL_UI_PORT)
RID="verify-$E-$(date +%s)"
hdr() { curl -s -o /dev/null -m 5 -D - "$@" | tr -d '\r' | sed -n 's/^[Xx]-[Rr]equest-[Ii][Dd]: //p'; }
ok "Next.js echoes X-Request-ID" "$(hdr -H "X-Request-ID: $RID-a" http://127.0.0.1:$NP/api/auth/me)" "$RID-a"
ok "Backend echoes X-Request-ID" "$(hdr -H "X-Request-ID: $RID-b" http://127.0.0.1:$BP/api/v1/health)" "$RID-b"
ok "Forged X-Request-ID replaced" "$(hdr -H 'X-Request-ID: bad id' http://127.0.0.1:$NP/api/auth/me | grep -cE '^[0-9a-f-]{36}$')" 1
ok "Trace: failed login → 401" "$(code -X POST -H 'content-type: application/json' -H "X-Request-ID: $RID-t" -H "x-forwarded-for: 203.0.113.99" -d '{"email":"verify-trace@test.invalid","password":"not-a-real-password"}' http://127.0.0.1:$NP/api/auth/login)" 401
sleep 1
ok "Trace: audit row for that request" "$(docker exec ${P}-db-1 psql -U "$SU" -d "$DB" -tAc "select action from \"AuditLog\" where request_id = '$RID-t'" | tr -d '\r')" login_failed
ok "Trace: Next.js log line for that request" "$(docker logs --since 2m ${P}-nextjs-1 2>&1 | grep -cE "\"request_id\": ?\"$RID-t\"" | tr -d ' ')" 1
ok "Trace: backend log line for its request" "$(docker logs --since 2m ${P}-backend-1 2>&1 | grep -cE "\"request_id\": ?\"$RID-b\"" | tr -d ' ')" 1
ok "Logs are JSON (backend access line)" "$(docker logs --since 2m ${P}-backend-1 2>&1 | grep "$RID-b" | python -c "import sys,json; print(json.loads(sys.stdin.readline())['event'])" 2>/dev/null)" http.request
# Counts only: a match is never printed.
ok "Credentials in container logs" "$(for c in nextjs backend; do docker logs ${P}-$c-1 2>&1; done | grep -cE 'eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}|[a-z]+://[^:@/ ]+:[^@/ ]+@|password_hash\":\"\$2' | tr -d ' ')" 0
ok "Log rotation (all containers)" "$(docker ps --filter "label=com.docker.compose.project=$P" -q | xargs docker inspect -f '{{index .HostConfig.LogConfig.Config "max-size"}}' | sort -u | tr '
' ' ' | sed 's/ $//')" 10m
ok "Next.js → Mailpit (alert email)" "$(docker exec ${P}-nextjs-1 nc -z -w 3 mailpit 1025 >/dev/null 2>&1 && echo yes || echo no)" yes
ok "Mailpit UI on localhost" "$(code http://127.0.0.1:$MP/)" 200
# Phase 11: main every 6 hours, staging weekly (dev isn't backed up).
case "$E" in main) MAXH=7 ;; staging) MAXH=192 ;; *) MAXH="" ;; esac
if [ -n "$MAXH" ]; then
  newest=$(ls -d "${BACKUP_ROOT:-D:/VertexData/backups}/$P"/*/manifest.json 2>/dev/null | sort | tail -1)
  age=$( [ -n "$newest" ] && echo $(( ($(date +%s) - $(date -r "$newest" +%s)) / 3600 )) || echo none)
  ok "Newest backup within ${MAXH}h" "$( [ "$age" != none ] && [ "$age" -le "$MAXH" ] && echo yes || echo "no (age: ${age}h)")" yes
fi
echo
