#!/usr/bin/env sh
# Runs the Playwright journeys the way CI's `e2e` job does: a production
# build (`next build`, then `next start`) against throwaway services on this
# machine, never a stack's database, bucket or mail:
#   - Postgres (password-less), schema from the backend's Alembic migrations,
#     then the Prisma seed;
#   - this stack's MinIO image, with a test bucket;
#   - Mailpit, catching the invite and notification emails;
#   - FastAPI (uvicorn) on the same database, which Next.js calls with
#     callBackend() for the areas it owns (backend plan step 2.0).
#
#   sh scripts/test-e2e.sh            # extra args go to playwright, e.g. e2e/rbac.spec.ts
#
# Needs the backend venv (vertex_be/env) and `npm ci`. Ports default outside
# the ranges Windows reserves for Hyper-V on some machines; override with
# TEST_PG_PORT, TEST_S3_PORT, TEST_SMTP_PORT, TEST_API_PORT and E2E_PORT. MINIO_IMAGE
# defaults to the published dev image. Failures leave screenshots and traces
# in test-results/.
set -eu

cd "$(dirname "$0")/.."

# Same reason as scripts/test.sh: keep this machine's real credentials in
# vertex/.env away from Prisma, the build and the journeys (CI has no .env).
HIDDEN=".env.hidden-during-tests"
[ -f "$HIDDEN" ] && [ ! -f .env ] && mv "$HIDDEN" .env   # left by an interrupted run
[ ! -f "$HIDDEN" ] || { echo "Both .env and $HIDDEN exist; resolve that first." >&2; exit 1; }
[ -f .env ] && mv .env "$HIDDEN"
restore_env() { [ -f "$HIDDEN" ] && mv "$HIDDEN" .env; return 0; }

ID=$$
PG="vertex-e2e-db-$ID"
S3="vertex-e2e-s3-$ID"
MAIL="vertex-e2e-mail-$ID"
PG_PORT="${TEST_PG_PORT:-15437}"
S3_PORT="${TEST_S3_PORT:-19001}"
SMTP_PORT="${TEST_SMTP_PORT:-11025}"
API_PORT="${TEST_API_PORT:-18100}"
API_LOG="$(mktemp)"
API_PID=""
export E2E_PORT="${E2E_PORT:-3100}"
MINIO_IMAGE="${MINIO_IMAGE:-ghcr.io/supportvertexintern-cmd/vertex-minio:dev}"
S3_SECRET="minio-local-e2e-$ID"

cleanup() {
  [ -z "$API_PID" ] || kill "$API_PID" 2>/dev/null || true
  docker rm -f "$PG" "$S3" "$MAIL" >/dev/null 2>&1 || true
  restore_env
}
trap cleanup EXIT INT TERM

docker run -d --rm --name "$PG" \
  -e POSTGRES_HOST_AUTH_METHOD=trust -e POSTGRES_DB=vertex_e2e \
  -p "127.0.0.1:$PG_PORT:5432" postgres:15-alpine >/dev/null
docker run -d --rm --name "$S3" \
  -e MINIO_ROOT_USER=ci-root -e MINIO_ROOT_PASSWORD="$S3_SECRET" -e MINIO_BROWSER=off \
  -p "127.0.0.1:$S3_PORT:9000" "$MINIO_IMAGE" >/dev/null
docker run -d --rm --name "$MAIL" -p "127.0.0.1:$SMTP_PORT:1025" axllent/mailpit:v1.31.4 >/dev/null

until docker exec "$PG" pg_isready -U postgres -q >/dev/null 2>&1; do sleep 1; done

# The environment CI's e2e job sets.
export DATABASE_URL="postgresql://postgres@localhost:$PG_PORT/vertex_e2e"
export S3_ENDPOINT="http://localhost:$S3_PORT" S3_BUCKET=vertex-e2e
export S3_ACCESS_KEY_ID=ci-root S3_SECRET_ACCESS_KEY="$S3_SECRET"
export SMTP_HOST=localhost SMTP_PORT="$SMTP_PORT" SMTP_SECURE=false EMAIL_FROM=e2e@test.local
export NEXT_PUBLIC_APP_URL="http://localhost:$E2E_PORT"
# The journeys log in many times from one machine (default limit: 10/min).
export LOGIN_RATE_LIMIT_MAX=1000
export E2E_WEB_SERVER="npx next start -p $E2E_PORT"
# A fresh signing key per run, so no secret-looking value lives here.
JWT_SECRET="$(node -e 'process.stdout.write(require("crypto").randomBytes(32).toString("hex"))')"
SERVICE_AUTH_SECRET="$(node -e 'process.stdout.write(require("crypto").randomBytes(32).toString("hex"))')"
export JWT_SECRET SERVICE_AUTH_SECRET
export BACKEND_URL="http://127.0.0.1:$API_PORT"

PYTHON="../vertex_be/env/Scripts/python.exe"
[ -x "$PYTHON" ] || PYTHON="../vertex_be/env/bin/python"
(cd ../vertex_be && MIGRATION_DATABASE_URL="$DATABASE_URL" "${PYTHON#../vertex_be/}" -m alembic upgrade head)
npx prisma db seed

# FastAPI, as in CI's e2e job. It verifies Next.js's sessions (JWT_SECRET)
# and service token (SERVICE_AUTH_SECRET); its log is printed if it fails.
(cd ../vertex_be && APP_ENV=development exec "${PYTHON#../vertex_be/}" -m uvicorn app.main:app --host 127.0.0.1 --port "$API_PORT") >"$API_LOG" 2>&1 &
API_PID=$!
n=0
until curl -fsS "$BACKEND_URL/api/v1/health" >/dev/null 2>&1; do
  n=$((n + 1))
  if [ "$n" -gt 60 ] || ! kill -0 "$API_PID" 2>/dev/null; then cat "$API_LOG" >&2; echo "FastAPI didn't start" >&2; exit 1; fi
  sleep 1
done

until docker exec "$S3" sh -c 'export MC_CONFIG_DIR=/tmp/.mc; mc alias set l http://127.0.0.1:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD"' >/dev/null 2>&1; do sleep 1; done
docker exec "$S3" sh -c 'export MC_CONFIG_DIR=/tmp/.mc; mc mb --ignore-existing l/vertex-e2e' >/dev/null

npx next build
npx playwright install chromium
npx playwright test --reporter=line "$@"
