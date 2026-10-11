#!/usr/bin/env bash
# DAST scan of a local stack with OWASP ZAP (Phase 8). Staging by default.
#
#   bash deploy/zap/scan-staging.sh [project] [env-file]    (from vertex_be/)
#   e.g. bash deploy/zap/scan-staging.sh vertex-staging .env.staging
#
# Only for stacks on this PC. ZAP joins the stack's `edge` network and
# targets nextjs:3000 and backend:8000 directly, so nothing new is exposed
# and ZAP can't reach the database network. Authenticated scans use a
# dedicated scan account (role admin) created here and removed afterwards;
# its 2-hour session token goes to ZAP through the environment, never argv
# or the host disk.
# Reports land in D:/VertexData/security-scans/<timestamp>/, with
# credentials stripped (sanitize_report.py).
set -euo pipefail
export MSYS_NO_PATHCONV=1

PROJECT="${1:-vertex-staging}"
ENV_FILE="${2:-.env.staging}"
# pwd -W: Git Bash gives /d/..., which Windows Python and Docker can't use.
HERE="$(cd "$(dirname "$0")" && { pwd -W 2>/dev/null || pwd; })"
v() { grep -E "^$1=" "$ENV_FILE" | tail -1 | cut -d= -f2- | tr -d '\r'; }
SU=$(v POSTGRES_USER); DB=$(v POSTGRES_DB)
STAMP=$(date +%Y%m%d-%H%M%S)
OUT="${ZAP_OUT_ROOT:-D:/VertexData/security-scans}/$PROJECT-$STAMP"
ZAP_IMAGE="${ZAP_IMAGE:-ghcr.io/zaproxy/zaproxy:stable}"
mkdir -p "$OUT"

case "$PROJECT" in
  vertex-main) echo "Refusing to scan vertex-main (it holds the real data)." >&2; exit 2 ;;
esac

psql_su() { docker exec "$PROJECT-db-1" psql -U "$SU" -d "$DB" -tAc "$1"; }

# The scan account goes however the script ends (including a failure).
cleanup() {
  unset ZAP_AUTH_TOKEN
  psql_su "delete from \"User\" where id = 'zap-scan-admin'" >/dev/null 2>&1 || echo "scan account kept (referenced by rows the scan created); its token expires in 2 hours"
}
trap cleanup EXIT

echo "== scan account"
psql_su "insert into \"User\" (id, full_name, email, role, updated_at) values ('zap-scan-admin', 'ZAP Scan', 'zap-scan@test.invalid', 'admin', now()) on conflict (id) do nothing" >/dev/null
ZAP_AUTH_TOKEN=$(docker exec -w /app "$PROJECT-nextjs-1" node -e '
  const c = require("crypto"), j = require("jsonwebtoken");
  const k = Buffer.from(c.hkdfSync("sha256", process.env.JWT_SECRET, "vertex-token-keys", "vertex/jwt/session/v1", 32));
  console.log(j.sign({ userId: "zap-scan-admin", email: "zap-scan@test.invalid", role: "admin" }, k,
    { expiresIn: 7200, algorithm: "HS256", issuer: "vertex-web", audience: "vertex:session" }));' | tail -1)
export ZAP_AUTH_TOKEN

python "$HERE/make_plans.py" "$HERE/routes.json" "$OUT"

run_plan() {
  echo "== $1"
  # ZAP 2.17 doesn't expand ${ENV} in replacer rules, so the plan holds a
  # placeholder. The token goes into a copy of the plan in the container's
  # own /tmp, which is removed with the container (--rm); it's never on the
  # host or on a command line.
  docker run --rm --network "${PROJECT}_edge" -e ZAP_AUTH_TOKEN -e PLAN="$1" \
    -v "$OUT:/zap/wrk:rw" --entrypoint sh "$ZAP_IMAGE" \
    -c 'sed "s|__ZAP_AUTH_TOKEN__|$ZAP_AUTH_TOKEN|g" "/zap/wrk/$PLAN" > /tmp/plan.yaml && exec zap.sh -cmd -autorun /tmp/plan.yaml' \
    > "$OUT/${1%.yaml}.log" 2>&1 || true
  tail -3 "$OUT/${1%.yaml}.log"
  if grep -q "Difference in response code values for message GET http://nextjs:3000/api/auth/me" "$OUT/${1%.yaml}.log"; then
    echo "!! $1: the /api/auth/me canary got the wrong status; this run's session handling is broken and its results don't count" >&2
    CANARY_FAILED=1
  fi
}
CANARY_FAILED=0
run_plan plan-unauthenticated.yaml
run_plan plan-authenticated.yaml

echo "== cleanup"
python "$HERE/sanitize_report.py" "$OUT"/zap-*.json "$OUT"/zap-*.md "$OUT"/*.log
echo "Reports: $OUT"
[ "$CANARY_FAILED" = 0 ] || exit 1
