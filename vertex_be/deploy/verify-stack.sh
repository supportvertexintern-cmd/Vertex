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
net() { docker run --rm --network "${P}_data" -e PGPASSWORD="$2" postgres:15-alpine psql -h db -U "$1" -d "$DB" -tAc "$3" 2>&1 | tr -d '\n' | grep -oE 'permission denied|^ *[0-9]+ *$' | head -1 | sed -E 's/^ +| +$//g'; }

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
ok "vertex_api: CREATE TABLE" "$(net vertex_api "$(v DB_API_PASSWORD)" 'create table probe(i int)')" "permission denied"
ok "GET /api/admin/emails, no login (G1)" "$(code http://127.0.0.1:$NP/api/admin/emails)" 401
ok "GET /api/admin/knowledge, no login (G2)" "$(code http://127.0.0.1:$NP/api/admin/knowledge)" 401
tok() { docker exec -w /app ${P}-nextjs-1 node -e "$1" 2>/dev/null | tail -1; }
CIF=$(tok 'const c=require("crypto"),j=require("jsonwebtoken");const k=Buffer.from(c.hkdfSync("sha256",process.env.JWT_SECRET,"vertex-token-keys","vertex/jwt/cif_upload/v1",32));console.log(j.sign({candidateId:"probe",type:"cif_upload"},k,{expiresIn:300,algorithm:"HS256",issuer:"vertex-web",audience:"vertex:cif_upload"}))')
LEGACY=$(tok 'const j=require("jsonwebtoken");console.log(j.sign({userId:"probe",email:"p@test.invalid",role:"admin"},process.env.JWT_SECRET,{expiresIn:300,algorithm:"HS256"}))')
ok "Upload token used as a session (G17)" "$(code -H "Cookie: auth_token=$CIF" http://127.0.0.1:$NP/api/auth/me)" 401
ok "Pre-G17 single-key session token (G17)" "$(code -H "Cookie: auth_token=$LEGACY" http://127.0.0.1:$NP/api/auth/me)" 401
docker exec ${P}-db-1 psql -U "$SU" -d "$DB" -qc "insert into \"Job\" (id,title,country,city,job_description,requirements,status,updated_at) values ('ctest-verify-draft','verify draft','X','X','d','r','draft',now())" >/dev/null
ok "Draft job via API (G11)" "$(code http://127.0.0.1:$NP/api/jobs/ctest-verify-draft)" 404
docker exec ${P}-db-1 psql -U "$SU" -d "$DB" -qc "delete from \"Job\" where id='ctest-verify-draft'" >/dev/null
last=""; for i in 1 2 3 4 5 6; do last=$(code -X POST -H 'content-type: application/json' -H "x-forwarded-for: 203.0.113.$RANDOM" -d '{}' http://127.0.0.1:$NP/api/auth/forgot-password); done
ip="203.0.113.250"; for i in 1 2 3 4 5 6; do last=$(code -X POST -H 'content-type: application/json' -H "x-forwarded-for: $ip-$E" -d '{}' http://127.0.0.1:$NP/api/auth/forgot-password); done
ok "6th forgot-password from one client (G10)" "$last" 429
echo
