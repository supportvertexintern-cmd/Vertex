#!/usr/bin/env bash
# Checks one running stack against the Phase 2 security properties and
# prints a markdown table (docs/security/phase2-verification.md):
#
#   LAN_IP=192.168.x.y bash deploy/verify-stack.sh <dev|staging>
#
# ENV_FILE overrides the env file (default vertex_be/.env.<stack>). Exits 1
# when any check fails, so a deploy can stop on it.
#
# LAN_IP is this machine's LAN address; ports must NOT answer on it. Without
# it the LAN rows are skipped. Writes one draft Job row as the superuser and
# deletes it again (G11 check). Run from vertex_be/.
set -u
export MSYS_NO_PATHCONV=1
# pwd -W: Git Bash gives /d/..., which Docker (with MSYS_NO_PATHCONV) can't use.
E="$1"; P="vertex-$E"
BE="$(cd "$(dirname "$0")/.." && { pwd -W 2>/dev/null || pwd; })"; ENVF="${ENV_FILE:-$BE/.env.$E}"
# Docker on Windows reads D:/..., not Git Bash's /d/... (MSYS_NO_PATHCONV is on).
ENVF=$(cygpath -m "$ENVF" 2>/dev/null || printf '%s' "$ENVF")
v() { grep -E "^$1=" "$ENVF" | tail -1 | cut -d= -f2- | tr -d '\r'; }
DB=$(v POSTGRES_DB); SU=$(v POSTGRES_USER)
BP=$(v BACKEND_PORT); NP=$(v NEXTJS_PORT); FP=$(v FLUTTER_PORT); GP=$(v PGADMIN_PORT)
LAN="${LAN_IP:-}"
FAILED=0
ok() { if [ "$2" = "$3" ]; then echo "| $1 | $2 | ✅ |"; else echo "| $1 | $2 (expected $3) | ❌ |"; FAILED=1; fi; }
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
ok "\`stores\` network internal" "$(docker network inspect -f '{{.Internal}}' ${P}_stores)" true
ok "Database container → internet" "$(docker exec ${P}-db-1 nc -z -w 5 1.1.1.1 443 >/dev/null 2>&1 && echo yes || echo no)" no
# Reads handover R8: the website has no way to the database and no login for it.
ok "Next.js → database" "$(docker exec ${P}-nextjs-1 nc -z -w 3 db 5432 >/dev/null 2>&1 && echo yes || echo no)" no
ok "Next.js on the \`data\` network" "$(docker inspect -f '{{json .NetworkSettings.Networks}}' ${P}-nextjs-1 | grep -c "\"${P}_data\"")" 0
ok "Next.js has a database URL" "$(docker exec ${P}-nextjs-1 printenv DATABASE_URL | wc -l | tr -d ' ')" 0
ok "vertex_web role exists" "$(docker exec ${P}-db-1 psql -U "$SU" -d "$DB" -tAc "select count(*) from pg_roles where rolname = 'vertex_web'" | tr -d '\r')" 0
ok "Next.js → FastAPI" "$(docker exec ${P}-nextjs-1 nc -z -w 3 backend 8000 >/dev/null 2>&1 && echo yes || echo no)" yes
ok "Next.js → MinIO" "$(docker exec ${P}-nextjs-1 nc -z -w 3 minio 9000 >/dev/null 2>&1 && echo yes || echo no)" yes
ok "Next.js → internet (best of 3)" "$(for i in 1 2 3; do docker exec ${P}-nextjs-1 nc -z -w 5 1.1.1.1 443 >/dev/null 2>&1 && { echo yes; break; }; done | grep -q yes && echo yes || echo no)" yes
ok "Flutter → database" "$(docker exec ${P}-flutter-web-1 nc -z -w 3 db 5432 >/dev/null 2>&1 && echo yes || echo no)" no
# Fails closed: if the comparison itself errors, report it rather than 0.
missing=$(set -o pipefail; cd "$BE" && IMAGE_TAG=x docker compose -p "$P" --env-file "$ENVF" -f docker-compose.deploy.yml config --format json | python deploy/verify_networks.py "$P" | tr -d '\r' | { grep -c . || true; }) || missing="check failed"
ok "Containers missing a network" "$missing" 0
ok "Backend connects as" "$(docker exec ${P}-backend-1 printenv DATABASE_URL | sed -E 's#postgresql://([^:]+):.*#\1#')" vertex_api
# Workstream B: Next.js only behind the edge proxy; Redis internal and locked.
ok "Next.js published to host (edge proxy only)" "$(docker port ${P}-nextjs-1 2>/dev/null | wc -l | tr -d ' ')" 0
ok "Next.js trusts the proxy's address" "$(docker exec ${P}-nextjs-1 printenv TRUST_PROXY_HEADERS)" true
# E3: the page policy the env file asks for. Enforced means the nonce
# policy is the Content-Security-Policy header itself, not report-only.
CSP_WANT=$( [ "$(v CSP_MODE)" = enforce ] && echo enforced || echo report-only )
CSP_GOT=$(curl -s -D - -o /dev/null -m 5 http://127.0.0.1:$NP/auth/login | tr -d '\r' | grep -i '^content-security-policy:' | grep -q "'nonce-" && echo enforced || echo report-only)
ok "Page CSP (E3)" "$CSP_GOT" "$CSP_WANT"
ok "Redis published to host" "$(docker port ${P}-redis-1 2>/dev/null | wc -l | tr -d ' ')" 0
ok "Redis without its password" "$(docker exec ${P}-redis-1 redis-cli ping 2>&1 | grep -oE '^NOAUTH')" NOAUTH
ok "Next.js → Redis" "$(docker exec ${P}-nextjs-1 nc -z -w 3 redis 6379 >/dev/null 2>&1 && echo yes || echo no)" yes
ok "Backend → Redis" "$(docker exec ${P}-backend-1 python -c 'import socket; socket.create_connection(("redis", 6379), 3)' >/dev/null 2>&1 && echo yes || echo no)" yes
ok "vertex_readonly: SELECT id FROM User" "$( [ -n "$(net vertex_readonly "$(v DB_READONLY_PASSWORD)" 'select count(id) from "User"')" ] && echo allowed)" allowed
ok "vertex_readonly: SELECT password_hash" "$(net vertex_readonly "$(v DB_READONLY_PASSWORD)" 'select password_hash from "User" limit 1')" "permission denied"
ok "vertex_readonly: SELECT email (personal data)" "$(net vertex_readonly "$(v DB_READONLY_PASSWORD)" 'select email from "User" limit 1')" "permission denied"
ok "vertex_readonly: read AuditLog" "$(net vertex_readonly "$(v DB_READONLY_PASSWORD)" 'select count(*) from "AuditLog"')" "permission denied"
ok "vertex_api: UPDATE AuditLog" "$(net vertex_api "$(v DB_API_PASSWORD)" 'update "AuditLog" set action = action')" "permission denied"
ok "vertex_api: TRUNCATE AuditLog" "$(net vertex_api "$(v DB_API_PASSWORD)" 'truncate "AuditLog"')" "permission denied"
ok "vertex_api: read AuditLog (Phase 10)" "$(net vertex_api "$(v DB_API_PASSWORD)" 'select count(*) from "AuditLog"')" "permission denied"
# Reads handover R5: a case's history through a function, without the snapshots.
ok "vertex_api: a case's trail (0008)" "$( [ -n "$(net vertex_api "$(v DB_API_PASSWORD)" "select count(*) from public.vertex_case_trail('none')")" ] && echo allowed)" allowed
ok "vertex_api: the alert monitor's counts (0009)" "$(net vertex_api "$(v DB_API_PASSWORD)" "select public.vertex_security_count('access_denied', 'actor_id', 'none', now()::timestamp)")" 0
ok "vertex_api: disable AuditLog triggers" "$(net vertex_api "$(v DB_API_PASSWORD)" 'alter table "AuditLog" disable trigger audit_log_no_update')" "must be owner"
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
# Signed by FastAPI, the session issuer (with its private key once the stack
# has one, session-keys-handover.md K2), so the row tests the live-session
# check, not the signature.
NOSESSION=$(docker exec ${P}-backend-1 python -c 'from app.core.tokens import sign_session_token as s; print(s(user_id="probe", email="p@test.invalid", role="admin", sid="probe", ver=0, ttl_seconds=300))' 2>/dev/null | tail -1)
ok "Signed session token, no live session (G19)" "$(code -H "Cookie: auth_token=$NOSESSION" http://127.0.0.1:$NP/api/auth/me)" 401
ok "Refresh without a refresh token (G19)" "$(code -X POST http://127.0.0.1:$NP/api/auth/refresh)" 401
# E8 (closed by session keys K3): on a live session, a token the website
# could mint (keyed from JWT_SECRET, which it holds) is refused, and the same
# session signed by FastAPI is accepted, so the refusal is the signature's.
psql_e8() { docker exec ${P}-db-1 psql -U "$SU" -d "$DB" -qc "$1" >/dev/null; }
psql_e8 "insert into \"User\" (id,full_name,email,role,updated_at) values ('ctest-verify-e8','verify e8','verify-e8@test.invalid','admin',now())"
psql_e8 "insert into \"RefreshToken\" (id,user_id,family_id,token_hash,token_version,expires_at) values ('ctest-verify-e8','ctest-verify-e8','verify-e8',md5(random()::text),0,now() + interval '5 minutes')"
SHARED=$(tok 'const c=require("crypto"),j=require("jsonwebtoken");const k=Buffer.from(c.hkdfSync("sha256",process.env.JWT_SECRET,"vertex-token-keys","vertex/jwt/session/v1",32));console.log(j.sign({userId:"ctest-verify-e8",email:"verify-e8@test.invalid",role:"admin",sid:"verify-e8",ver:0},k,{expiresIn:300,algorithm:"HS256",issuer:"vertex-web",audience:"vertex:session"}))')
ISSUED=$(docker exec ${P}-backend-1 python -c 'from app.core.tokens import sign_session_token as s; print(s(user_id="ctest-verify-e8", email="verify-e8@test.invalid", role="admin", sid="verify-e8", ver=0, ttl_seconds=300))' 2>/dev/null | tail -1)
ok "Live session, token the website could mint (E8)" "$(code -H "Cookie: auth_token=$SHARED" http://127.0.0.1:$NP/api/auth/me)" 401
ok "Same session, token FastAPI signed (E8 control)" "$(code -H "Cookie: auth_token=$ISSUED" http://127.0.0.1:$NP/api/auth/me)" 200
psql_e8 "delete from \"RefreshToken\" where id='ctest-verify-e8'"
psql_e8 "delete from \"User\" where id='ctest-verify-e8'"
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
# Since users step 8.2 the website passes sign-in on to FastAPI, which
# records the failure and its request line; the website adds no line of its
# own. The same request id on both proves the website passed it on.
ok "Trace: FastAPI's failed-sign-in event for that request" "$(docker logs --since 2m ${P}-backend-1 2>&1 | grep -E "\"request_id\": ?\"$RID-t\"" | grep -c '"event": "security.login_failed"' | tr -d ' ')" 1
ok "Trace: backend log line for its request" "$(docker logs --since 2m ${P}-backend-1 2>&1 | grep -cE "\"request_id\": ?\"$RID-b\"" | tr -d ' ')" 1
ok "Logs are JSON (backend access line)" "$(docker logs --since 2m ${P}-backend-1 2>&1 | grep "$RID-b" | python -c "import sys,json; print(json.loads(sys.stdin.readline())['event'])" 2>/dev/null)" http.request
# Counts only: a match is never printed.
ok "Credentials in container logs" "$(for c in nextjs backend; do docker logs ${P}-$c-1 2>&1; done | grep -cE 'eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}|[a-z]+://[^:@/ ]+:[^@/ ]+@|password_hash\":\"\$2' | tr -d ' ')" 0
ok "Log rotation (all containers)" "$(docker ps --filter "label=com.docker.compose.project=$P" -q | xargs docker inspect -f '{{index .HostConfig.LogConfig.Config "max-size"}}' | sort -u | tr '
' ' ' | sed 's/ $//')" 10m
# FastAPI sends every email, the backup alert's included (reads handover R7b).
ok "FastAPI → Mailpit (email)" "$(docker exec ${P}-backend-1 python -c "import socket; socket.create_connection(('mailpit', 1025), 3)" >/dev/null 2>&1 && echo yes || echo no)" yes
# Uploads are accepted unscanned when the scanner is down (the owner's fail-open
# policy), so nothing else shows it's missing. docker-compose.av.yml starts it.
ok "FastAPI → malware scanner" "$(docker exec ${P}-backend-1 python -c 'import os, socket; s = socket.create_connection((os.environ["CLAMD_HOST"], int(os.environ["CLAMD_PORT"])), 5); s.send(b"zPING" + bytes(1)); print(s.recv(16).split(bytes(1))[0].decode())' 2>/dev/null | tail -1 | tr -d "\r")" PONG
ok "Next.js has no mail settings" "$(docker exec ${P}-nextjs-1 printenv SMTP_HOST >/dev/null 2>&1 && echo yes || echo no)" no
ok "Mailpit UI on localhost" "$(code http://127.0.0.1:$MP/)" 200
# Phase 11: only dev is backed up since 2026-11-06, daily.
case "$E" in dev) MAXH=26 ;; *) MAXH="" ;; esac
if [ -n "$MAXH" ]; then
  newest=$(ls -d "${BACKUP_ROOT:-D:/VertexData/backups}/$P"/*/manifest.json 2>/dev/null | sort | tail -1)
  age=$( [ -n "$newest" ] && echo $(( ($(date +%s) - $(date -r "$newest" +%s)) / 3600 )) || echo none)
  ok "Newest backup within ${MAXH}h" "$( [ "$age" != none ] && [ "$age" -le "$MAXH" ] && echo yes || echo "no (age: ${age}h)")" yes
fi
echo
exit $FAILED
