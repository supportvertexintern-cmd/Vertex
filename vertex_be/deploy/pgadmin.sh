#!/usr/bin/env sh
# pgAdmin is off by default. Start it when you need to browse a stack's data,
# stop it when you're done.
#
#   ENV_FILE=.env.dev sh deploy/pgadmin.sh vertex-dev up
#   ENV_FILE=.env.dev sh deploy/pgadmin.sh vertex-dev down
#
# It connects as vertex_readonly (SELECT only); its password is
# DB_READONLY_PASSWORD in the env file.
set -eu

PROJECT="$1"
ACTION="${2:-up}"
ENV_FILE="${ENV_FILE:-.env}"
export ENV_FILE IMAGE_TAG="${IMAGE_TAG:-unused}"  # pgAdmin doesn't use the app images

compose() {
  docker compose -p "$PROJECT" --env-file "$ENV_FILE" -f docker-compose.deploy.yml --profile pgadmin "$@"
}

case "$ACTION" in
  up)
    compose up -d --no-deps --wait pgadmin
    # Same Compose network bug as in deploy.sh: make sure it can reach the db.
    container="$(compose ps -q pgadmin)"
    reattached=""
    for net in "${PROJECT}_data" "${PROJECT}_edge"; do
      if ! docker inspect -f '{{json .NetworkSettings.Networks}}' "$container" | grep -q "\"$net\""; then
        docker network connect --alias pgadmin "$net" "$container"
        reattached=yes
      fi
    done
    # A port published while the container was only on the internal network
    # stays dead (empty reply) until the container restarts with both.
    [ -z "$reattached" ] || docker restart "$container" >/dev/null
    port="$(grep -E '^PGADMIN_PORT=' "$ENV_FILE" | cut -d= -f2 | tr -d '\r')"
    echo "pgAdmin: http://localhost:${port:-5151}  (stop it with: ... pgadmin.sh $PROJECT down)"
    ;;
  down)
    compose stop pgadmin
    compose rm -f pgadmin
    ;;
  *)
    echo "usage: pgadmin.sh <project> up|down" >&2
    exit 2
    ;;
esac
