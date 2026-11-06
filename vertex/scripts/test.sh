#!/usr/bin/env sh
# Runs the Next.js unit and integration tests (Vitest) the way CI's `nextjs`
# job does, against throwaway services on this machine, never a stack's
# bucket. The website has no database (reads handover R8), so neither do these:
#   - this stack's MinIO image, with a test bucket;
#
#   sh scripts/test.sh            # extra args go to vitest, e.g. -t audit
#
# Needs `npm ci`. Ports default outside the ranges Windows reserves for Hyper-V
# on some machines (5366-5465 here); override with TEST_S3_PORT.
# MINIO_IMAGE defaults to the published dev image.
set -eu

cd "$(dirname "$0")/.."

# vertex/.env holds this machine's real credentials and CI has no .env at
# all, so whatever a test or tool might load, it can't be those: move it aside
# for the run and put it back on any exit. Blanking the keys instead isn't
# equivalent: an empty value defeats `??` fallbacks.
HIDDEN=".env.hidden-during-tests"
[ -f "$HIDDEN" ] && [ ! -f .env ] && mv "$HIDDEN" .env   # left by an interrupted run
[ ! -f "$HIDDEN" ] || { echo "Both .env and $HIDDEN exist; resolve that first." >&2; exit 1; }
[ -f .env ] && mv .env "$HIDDEN"
restore_env() { [ -f "$HIDDEN" ] && mv "$HIDDEN" .env; return 0; }

ID=$$
S3="vertex-web-test-s3-$ID"
S3_PORT="${TEST_S3_PORT:-19000}"
MINIO_IMAGE="${MINIO_IMAGE:-ghcr.io/supportvertexintern-cmd/vertex-minio:dev}"
# Per run, like CI's, so nothing here looks like a reusable credential.
S3_SECRET="minio-local-test-$ID"

cleanup() { docker rm -f "$S3" >/dev/null 2>&1 || true; restore_env; }
trap cleanup EXIT INT TERM

docker run -d --rm --name "$S3" \
  -e MINIO_ROOT_USER=ci-root -e MINIO_ROOT_PASSWORD="$S3_SECRET" -e MINIO_BROWSER=off \
  -p "127.0.0.1:$S3_PORT:9000" "$MINIO_IMAGE" >/dev/null

until docker exec "$S3" sh -c 'export MC_CONFIG_DIR=/tmp/.mc; mc alias set l http://127.0.0.1:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD"' >/dev/null 2>&1; do sleep 1; done
docker exec "$S3" sh -c 'export MC_CONFIG_DIR=/tmp/.mc; mc mb --ignore-existing l/vertex-ci' >/dev/null

S3_ENDPOINT="http://localhost:$S3_PORT" S3_BUCKET=vertex-ci \
S3_ACCESS_KEY_ID=ci-root S3_SECRET_ACCESS_KEY="$S3_SECRET" \
  npx vitest run "$@"
