#!/usr/bin/env sh
# Runs the Next.js unit and integration tests (Vitest) the way CI's `nextjs`
# job does, against throwaway services on this machine, never a stack's
# database or bucket:
#   - Postgres (password-less), schema from the backend's Alembic migrations,
#     then the Prisma seed;
#   - this stack's MinIO image, with a test bucket;
#   - ClamAV, for the malware-scanning tests.
#
#   sh scripts/test.sh            # extra args go to vitest, e.g. -t audit
#
# Needs the backend venv (vertex_be/env, see vertex_be/scripts/test.sh) and
# `npm ci`. Ports default outside the ranges Windows reserves for Hyper-V on
# some machines (5366-5465 here); override with TEST_PG_PORT, TEST_S3_PORT and
# TEST_CLAMD_PORT. MINIO_IMAGE defaults to the published dev image.
set -eu

cd "$(dirname "$0")/.."

# Prisma (client and CLI) loads vertex/.env for every variable not already
# set, which would hand the tests and the seed this machine's real SMTP,
# Stripe, PayPal and storage credentials. CI has no .env at all, so move it
# aside for the run and put it back on any exit. Blanking the keys instead
# isn't equivalent: an empty value defeats `??` fallbacks.
HIDDEN=".env.hidden-during-tests"
[ -f "$HIDDEN" ] && [ ! -f .env ] && mv "$HIDDEN" .env   # left by an interrupted run
[ ! -f "$HIDDEN" ] || { echo "Both .env and $HIDDEN exist; resolve that first." >&2; exit 1; }
[ -f .env ] && mv .env "$HIDDEN"
restore_env() { [ -f "$HIDDEN" ] && mv "$HIDDEN" .env; return 0; }

ID=$$
PG="vertex-web-test-db-$ID"
S3="vertex-web-test-s3-$ID"
AV="vertex-web-test-av-$ID"
PG_PORT="${TEST_PG_PORT:-15436}"
S3_PORT="${TEST_S3_PORT:-19000}"
AV_PORT="${TEST_CLAMD_PORT:-13310}"
MINIO_IMAGE="${MINIO_IMAGE:-ghcr.io/supportvertexintern-cmd/vertex-minio:dev}"
# Per run, like CI's, so nothing here looks like a reusable credential.
S3_SECRET="minio-local-test-$ID"

cleanup() { docker rm -f "$PG" "$S3" "$AV" >/dev/null 2>&1 || true; restore_env; }
trap cleanup EXIT INT TERM

docker run -d --rm --name "$PG" \
  -e POSTGRES_HOST_AUTH_METHOD=trust -e POSTGRES_DB=vertex_next_test \
  -p "127.0.0.1:$PG_PORT:5432" postgres:15-alpine >/dev/null
docker run -d --rm --name "$S3" \
  -e MINIO_ROOT_USER=ci-root -e MINIO_ROOT_PASSWORD="$S3_SECRET" -e MINIO_BROWSER=off \
  -p "127.0.0.1:$S3_PORT:9000" "$MINIO_IMAGE" >/dev/null
docker run -d --rm --name "$AV" -p "127.0.0.1:$AV_PORT:3310" clamav/clamav:stable >/dev/null

until docker exec "$PG" pg_isready -U postgres -q >/dev/null 2>&1; do sleep 1; done

export DATABASE_URL="postgresql://postgres@localhost:$PG_PORT/vertex_next_test"

# The schema comes from the Alembic migrations, exactly as every deployed
# stack gets it (see ci.yml). Both URLs are set so a MIGRATION_DATABASE_URL
# in vertex_be/.env can't point the migration at a real database.
PYTHON="../vertex_be/env/Scripts/python.exe"
[ -x "$PYTHON" ] || PYTHON="../vertex_be/env/bin/python"
(cd ../vertex_be && MIGRATION_DATABASE_URL="$DATABASE_URL" "${PYTHON#../vertex_be/}" -m alembic upgrade head)
npx prisma db seed

until docker exec "$S3" sh -c 'export MC_CONFIG_DIR=/tmp/.mc; mc alias set l http://127.0.0.1:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD"' >/dev/null 2>&1; do sleep 1; done
docker exec "$S3" sh -c 'export MC_CONFIG_DIR=/tmp/.mc; mc mb --ignore-existing l/vertex-ci' >/dev/null

# clamd loads its signatures before it reports healthy (a minute or two).
echo "Waiting for ClamAV to load its signatures..."
until [ "$(docker inspect -f '{{.State.Health.Status}}' "$AV" 2>/dev/null)" = healthy ]; do sleep 5; done

S3_ENDPOINT="http://localhost:$S3_PORT" S3_BUCKET=vertex-ci \
S3_ACCESS_KEY_ID=ci-root S3_SECRET_ACCESS_KEY="$S3_SECRET" \
CLAMD_HOST=localhost CLAMD_PORT="$AV_PORT" \
  npx vitest run "$@"
