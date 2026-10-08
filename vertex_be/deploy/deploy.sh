#!/usr/bin/env sh
# Pulls one build of every image and (re)starts the stack with
# docker-compose.deploy.yml, provisioning least-privilege database roles
# (db-roles.sql) along the way, then waits until all containers are healthy.
#
#   ENV_FILE=.env.staging deploy.sh <project-name> <image-tag>
#   e.g. ENV_FILE=.env.dev deploy.sh vertex-dev dev-1a2b3c4
#   SKIP_PULL=1 uses images already on this machine (testing local builds).
#
# Run from the dir holding docker-compose.deploy.yml (vertex_be/ locally, the
# deploy path on a server). ENV_FILE defaults to .env.
set -eu

PROJECT="$1"
export IMAGE_TAG="$2"
export ENV_FILE="${ENV_FILE:-.env}"
HERE="$(cd "$(dirname "$0")" && pwd)"
# A function, not a string, so paths with spaces survive.
compose() { docker compose -p "$PROJECT" --env-file "$ENV_FILE" -f docker-compose.deploy.yml "$@"; }
# Reads KEY from the env file without sourcing it (values may contain JSON).
env_value() { grep -E "^$1=" "$ENV_FILE" | tail -n 1 | cut -d= -f2- | tr -d '\r'; }

[ -f "$ENV_FILE" ] || { echo "Missing $ENV_FILE in $(pwd) — copy it from .env.<env>.example" >&2; exit 1; }

# Runs db-roles.sql as the superuser. Passwords travel over stdin, never argv.
provision_roles() {
  {
    printf "\\set migrator_pw '%s'\n\\set api_pw '%s'\n\\set web_pw '%s'\n" \
      "$(env_value DB_MIGRATOR_PASSWORD)" "$(env_value DB_API_PASSWORD)" "$(env_value DB_WEB_PASSWORD)"
    cat "$HERE/db-roles.sql"
  } | compose exec -T db psql -q -U "$(env_value POSTGRES_USER)" -d "$(env_value POSTGRES_DB)" >/dev/null
}

fail() {
  echo "Deploy of $IMAGE_TAG to $PROJECT failed: $1" >&2
  compose ps >&2 || true
  compose logs --tail=60 >&2 || true
  exit 1
}

[ "${SKIP_PULL:-}" = 1 ] || compose pull --quiet || {
  echo "Pull failed — run 'docker login ghcr.io' (PAT with read:packages) and check tag '$IMAGE_TAG' exists." >&2
  exit 1
}

# 1. Database first, so the roles exist before anything connects.
compose up -d --wait --wait-timeout 120 db || fail "database did not become healthy"
provision_roles || fail "provisioning database roles"

# 2. Backend: runs `alembic upgrade head` as vertex_migrator, then serves as
#    vertex_api. Re-provision afterwards so tables a migration just created
#    (e.g. AuditLog on a fresh database) get their carve-outs immediately.
compose up -d --wait --wait-timeout 180 backend || fail "backend did not become healthy"
provision_roles || fail "re-provisioning database roles"

# 3. Everything else.
compose up -d --remove-orphans --wait --wait-timeout 240 || fail "not all services became healthy"

echo "Deployed $IMAGE_TAG to $PROJECT — all services healthy"
docker image prune -f >/dev/null
