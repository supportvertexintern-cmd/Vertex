#!/usr/bin/env sh
# MinIO's web console is off by default (exception E2: no published port,
# internal network only). Start it when you need to browse a development
# stack's files, stop it when you're done. Refuses any stack whose env file
# isn't APP_ENV=development.
#
#   ENV_FILE=.env.dev sh deploy/minio-console.sh vertex-dev up
#   ENV_FILE=.env.dev sh deploy/minio-console.sh vertex-dev down
#
# Log in with MINIO_ROOT_USER and MINIO_ROOT_PASSWORD from the env file.
# MinIO restarts on each switch (a few seconds without uploads).
set -eu

PROJECT="$1"
ACTION="${2:-up}"
ENV_FILE="${ENV_FILE:-.env}"
env_value() { grep -E "^$1=" "$ENV_FILE" | tail -n 1 | cut -d= -f2- | tr -d '\r'; }

[ "$(env_value APP_ENV)" = "development" ] || { echo "minio-console.sh: $ENV_FILE is not a development stack" >&2; exit 1; }
# The running stack's tag, so MinIO is recreated from the same image.
running="$(docker inspect -f '{{.Config.Image}}' "${PROJECT}-minio-1")"
export ENV_FILE IMAGE_TAG="${running##*:}"

compose() {
  docker compose -p "$PROJECT" --env-file "$ENV_FILE" -f docker-compose.deploy.yml "$@"
}

case "$ACTION" in
  up)
    compose -f docker-compose.minio-console.yml up -d --no-deps --wait minio
    # Same Compose network bug as pgadmin.sh: the recreated container can
    # come up on only one of its networks. Without `data` the services on
    # it can't reach MinIO by name; without `edge` the published port stays
    # dead. Attach whichever is missing (as "minio"), then restart.
    container="$(compose ps -q minio)"
    reattached=""
    for net in "${PROJECT}_data" "${PROJECT}_edge"; do
      if ! docker inspect -f '{{json .NetworkSettings.Networks}}' "$container" | grep -q "\"$net\""; then
        docker network connect --alias minio "$net" "$container"
        reattached=yes
      fi
    done
    [ -z "$reattached" ] || docker restart "$container" >/dev/null
    echo "MinIO console: http://localhost:$(env_value MINIO_CONSOLE_PORT | grep . || echo 9001)  (MINIO_ROOT_USER / MINIO_ROOT_PASSWORD in $ENV_FILE; stop it with: ... minio-console.sh $PROJECT down)"
    ;;
  down)
    # Recreated from the deploy file alone: no port, `data` only, console off.
    compose up -d --no-deps --wait --force-recreate minio
    echo "MinIO console stopped."
    ;;
  *)
    echo "usage: minio-console.sh <project> up|down" >&2
    exit 2
    ;;
esac
