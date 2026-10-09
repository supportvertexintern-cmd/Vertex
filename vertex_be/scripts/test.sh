#!/usr/bin/env sh
# Runs the backend tests against a throwaway Postgres, never a stack's real
# database (dev and staging Postgres aren't published to the host). Mirrors
# CI, which also uses a disposable, password-less database.
#
#   sh scripts/test.sh            # any extra args go to pytest, e.g. -k roles
set -eu

cd "$(dirname "$0")/.."
NAME="vertex-be-test-db-$$"
PORT="${TEST_DB_PORT:-5435}"

docker run -d --rm --name "$NAME" \
  -e POSTGRES_HOST_AUTH_METHOD=trust -e POSTGRES_DB=vertexdb_test \
  -p "127.0.0.1:$PORT:5432" postgres:15-alpine >/dev/null
trap 'docker stop "$NAME" >/dev/null 2>&1 || true' EXIT INT TERM

until docker exec "$NAME" pg_isready -U postgres -q >/dev/null 2>&1; do sleep 1; done

PYTHON="env/Scripts/python.exe"
[ -x "$PYTHON" ] || PYTHON="env/bin/python"
TEST_DATABASE_URL="postgresql://postgres@localhost:$PORT/vertexdb_test" "$PYTHON" -m pytest "$@"
