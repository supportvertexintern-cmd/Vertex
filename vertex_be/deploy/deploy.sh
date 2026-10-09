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
# Reads KEY from the env file without sourcing it (values may contain JSON).
env_value() { grep -E "^$1=" "$ENV_FILE" | tail -n 1 | cut -d= -f2- | tr -d '\r'; }

[ -f "$ENV_FILE" ] || { echo "Missing $ENV_FILE in $(pwd) — create it (see docs/secrets.md)" >&2; exit 1; }

# Postgres is published on localhost only for stacks that ask for it.
DB_PORT_FILE=""
[ -n "$(env_value POSTGRES_HOST_PORT)" ] && DB_PORT_FILE="docker-compose.db-port.yml"

# A function, not a string, so paths with spaces survive.
compose() {
  docker compose -p "$PROJECT" --env-file "$ENV_FILE" -f docker-compose.deploy.yml \
    ${DB_PORT_FILE:+-f "$DB_PORT_FILE"} "$@"
}

# Runs db-roles.sql as the superuser. Passwords travel over stdin, never argv.
provision_roles() {
  {
    printf "\\set migrator_pw '%s'\n\\set api_pw '%s'\n\\set web_pw '%s'\n\\set readonly_pw '%s'\n" \
      "$(env_value DB_MIGRATOR_PASSWORD)" "$(env_value DB_API_PASSWORD)" "$(env_value DB_WEB_PASSWORD)" \
      "$(env_value DB_READONLY_PASSWORD)"
    cat "$HERE/readonly-columns.sql" "$HERE/db-roles.sql"
  } | compose exec -T db psql -q -U "$(env_value POSTGRES_USER)" -d "$(env_value POSTGRES_DB)" >/dev/null
}

fail() {
  echo "Deploy of $IMAGE_TAG to $PROJECT failed: $1" >&2
  compose ps >&2 || true
  compose logs --tail=60 >&2 || true
  exit 1
}

# Retry the pull with backoff: a slow link to the registry shouldn't fail a
# deploy. PULL_ATTEMPTS overrides the number of tries (default 4).
pull_images() {
  attempts="${PULL_ATTEMPTS:-4}"
  attempt=1
  while ! compose pull --quiet; do
    if [ "$attempt" -ge "$attempts" ]; then
      echo "Pull failed after $attempts attempts — check 'docker login ghcr.io' (PAT with read:packages) and that tag '$IMAGE_TAG' exists." >&2
      return 1
    fi
    wait=$((attempt * 15))
    echo "Pull attempt $attempt failed; retrying in ${wait}s" >&2
    sleep "$wait"
    attempt=$((attempt + 1))
  done
}

# Docker 24 / Compose 2.19 can leave a stale endpoint in a network, after
# which Compose silently fails to attach a recreated container to it (seen:
# backend on `edge` only, so it couldn't resolve `db` and crash-looped in
# migrations; earlier, backend on `data` only, so its port was dead). After
# every `up`, compare each container with the config, repair missing
# attachments in place (clear the stale endpoint, re-attach with the
# service's DNS alias), and fail if any remain. Python is needed to compare;
# without it, fail closed.
PY=""
for candidate in python3 python; do
  "$candidate" -c 'import sys' >/dev/null 2>&1 && { PY="$candidate"; break; }
done
[ -n "$PY" ] || { echo "python is required to verify network attachments" >&2; exit 1; }
# tr: Python on Windows ends each line with a carriage return, which would
# otherwise end up in the network name ("network ...edge not found").
missing_networks() { compose config --format json | "$PY" "$HERE/verify_networks.py" "$PROJECT" | tr -d '\r'; }
repair_networks() {
  missing="$(missing_networks)" || fail "could not verify network attachments"
  [ -n "$missing" ] || return 0
  # A for-loop over lines (not `| while read`): no subshell hiding failures,
  # and docker can't swallow the remaining lines from stdin.
  old_ifs="$IFS"
  IFS='
'
  for entry in $missing; do
    IFS="$old_ifs"
    set -- $entry  # service container network
    echo "Re-attaching $2 to $3" >&2
    docker network disconnect --force "$3" "$2" </dev/null >/dev/null 2>&1 || true
    docker network connect --alias "$1" "$3" "$2" </dev/null || fail "re-attaching $2 to $3"
  done
  IFS="$old_ifs"
  missing="$(missing_networks)" || fail "could not verify network attachments"
  [ -z "$missing" ] || fail "containers still missing networks: $(echo "$missing" | tr '\n' ';')"
}

# Starts services, repairs their networks, then waits for health. The second
# `up` recreates nothing; it starts anything stopped and waits.
up_and_wait() {
  timeout="$1"; shift
  compose up -d "$@" || true
  repair_networks
  compose up -d --wait --wait-timeout "$timeout" "$@"
}

[ "${SKIP_PULL:-}" = 1 ] || pull_images || exit 1

# Compose reuses an existing network even when its definition has changed,
# so a `data` network created before it was made internal would silently
# stay open. Recreate the stack's networks (volumes are kept) when it drifts.
DATA_NET="${PROJECT}_data"
if [ "$(docker network inspect -f '{{.Internal}}' "$DATA_NET" 2>/dev/null)" = "false" ]; then
  echo "$DATA_NET is not internal; recreating the stack's networks (data volumes are kept)" >&2
  compose down --remove-orphans
fi

# 1. Database first, so the roles exist before anything connects.
up_and_wait 120 db || fail "database did not become healthy"
provision_roles || fail "provisioning database roles"

# 2. Backend: runs `alembic upgrade head` as vertex_migrator, then serves as
#    vertex_api. Re-provision afterwards so tables a migration just created
#    (e.g. AuditLog on a fresh database) get their carve-outs immediately.
up_and_wait 180 backend || fail "backend did not become healthy"
provision_roles || fail "re-provisioning database roles"

# 3. Everything else.
up_and_wait 240 --remove-orphans || fail "not all services became healthy"

# Fail closed if the database network ended up able to reach the internet.
[ "$(docker network inspect -f '{{.Internal}}' "$DATA_NET" 2>/dev/null)" = "true" ] \
  || fail "$DATA_NET is not an internal network"

echo "Deployed $IMAGE_TAG to $PROJECT — all services healthy"
docker image prune -f >/dev/null
