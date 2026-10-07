#!/usr/bin/env sh
# Runs on the target server (copied there by the deploy workflow).
#   deploy.sh <project-name> <image>
# Expects docker-compose.deploy.yml and a filled-in .env in the current dir.
set -eu

PROJECT="$1"
IMAGE="$2"
COMPOSE="docker compose -p $PROJECT -f docker-compose.deploy.yml"

[ -f .env ] || { echo "Missing .env in $(pwd) — copy it from .env.<env>.example" >&2; exit 1; }

export BACKEND_IMAGE="$IMAGE"
$COMPOSE pull web
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
