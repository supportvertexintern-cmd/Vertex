#!/usr/bin/env sh
# Starts a prebuilt backend image with docker-compose.deploy.yml.
#   [ENV_FILE=.env.staging] deploy.sh <project-name> <image>
# Run from the dir holding docker-compose.deploy.yml: vertex_be/ for local
# staging, or the deploy path on a server (where the workflow copies it).
# ENV_FILE defaults to .env.
set -eu

PROJECT="$1"
IMAGE="$2"
export ENV_FILE="${ENV_FILE:-.env}"
COMPOSE="docker compose -p $PROJECT --env-file $ENV_FILE -f docker-compose.deploy.yml"

[ -f "$ENV_FILE" ] || { echo "Missing $ENV_FILE in $(pwd) — copy it from .env.<env>.example" >&2; exit 1; }

export BACKEND_IMAGE="$IMAGE"
$COMPOSE pull web || {
  echo "Pull failed — run 'docker login ghcr.io' (PAT with read:packages) and check the tag exists." >&2
  exit 1
}
# The image runs `alembic upgrade head` before starting uvicorn.
$COMPOSE up -d --remove-orphans

# Wait for the web container's healthcheck (≈80s max).
CONTAINER="$($COMPOSE ps -q web)"
i=0
while [ $i -lt 40 ]; do
  STATUS="$(docker inspect -f '{{.State.Health.Status}}' "$CONTAINER")"
  [ "$STATUS" = "healthy" ] && { echo "Deployed $IMAGE ($PROJECT) — healthy"; docker image prune -f >/dev/null; exit 0; }
  [ "$STATUS" = "unhealthy" ] && break
  i=$((i + 1))
  sleep 2
done

echo "Deploy failed: web container is ${STATUS:-not running}" >&2
$COMPOSE logs --tail=80 web >&2
exit 1
