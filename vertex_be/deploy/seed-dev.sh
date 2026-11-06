#!/usr/bin/env sh
# Loads a development stack's database with the reference data
# (scripts/seed/reference.py: regions, countries, sectors, document requirements,
# job programmes) and the test accounts (scripts/seed/test_accounts.py:
# one per staff role plus a partner, all with password TestPassword123!).
# Safe to re-run: both upsert. Refuses any stack whose env file isn't
# APP_ENV=development.
#
#   ENV_FILE=.env.dev sh deploy/seed-dev.sh vertex-dev
#
# Postgres has no published port (exception E2), so for the seed only it is
# published on 127.0.0.1:SEED_DB_PORT (default 15434) with
# docker-compose.db-port.yml, then recreated without it, also on failure.
# The seed writes as vertex_migrator, the schema owner, outside FastAPI:
# test data only (docs/architecture/data-ownership.md).
set -eu

PROJECT="$1"
ENV_FILE="${ENV_FILE:-.env}"
SEED_DB_PORT="${SEED_DB_PORT:-15434}"
env_value() { grep -E "^$1=" "$ENV_FILE" | tail -n 1 | cut -d= -f2- | tr -d '\r'; }

[ "$(env_value APP_ENV)" = "development" ] || { echo "seed-dev.sh: $ENV_FILE is not a development stack" >&2; exit 1; }
running="$(docker inspect -f '{{.Config.Image}}' "${PROJECT}-backend-1")"
export ENV_FILE IMAGE_TAG="${running##*:}" POSTGRES_HOST_PORT="$SEED_DB_PORT"

compose() {
  docker compose -p "$PROJECT" --env-file "$ENV_FILE" -f docker-compose.deploy.yml "$@"
}
unpublish() {
  compose up -d --no-deps --wait --force-recreate db >/dev/null
  echo "Postgres is unpublished again."
}

compose -f docker-compose.db-port.yml up -d --no-deps --wait db >/dev/null
trap unpublish EXIT

export DATABASE_URL="postgresql://vertex_migrator:$(env_value DB_MIGRATOR_PASSWORD)@localhost:$SEED_DB_PORT/$(env_value POSTGRES_DB)"
PYTHON="env/Scripts/python.exe"
[ -x "$PYTHON" ] || PYTHON="env/bin/python"
"$PYTHON" -m scripts.seed.reference
"$PYTHON" -m scripts.seed.test_accounts
echo "Seeded. Sign in at $(env_value NEXT_PUBLIC_APP_URL) as e.g. admin@test.local / TestPassword123!"
