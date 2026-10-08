#!/usr/bin/env sh
# Pulls one build of every image and (re)starts the stack with
# docker-compose.deploy.yml, then waits until all containers are healthy.
#
#   ENV_FILE=.env.staging deploy.sh <project-name> <image-tag>
#   e.g. ENV_FILE=.env.dev deploy.sh vertex-dev dev-1a2b3c4
#
# Run from the dir holding docker-compose.deploy.yml (vertex_be/ locally, the
# deploy path on a server). ENV_FILE defaults to .env.
set -eu

PROJECT="$1"
export IMAGE_TAG="$2"
export ENV_FILE="${ENV_FILE:-.env}"
COMPOSE="docker compose -p $PROJECT --env-file $ENV_FILE -f docker-compose.deploy.yml"

[ -f "$ENV_FILE" ] || { echo "Missing $ENV_FILE in $(pwd) — copy it from .env.<env>.example" >&2; exit 1; }

$COMPOSE pull --quiet || {
  echo "Pull failed — run 'docker login ghcr.io' (PAT with read:packages) and check tag '$IMAGE_TAG' exists." >&2
  exit 1
}

# The backend runs `alembic upgrade head` before serving; Next.js waits for it.
if $COMPOSE up -d --remove-orphans --wait --wait-timeout 240; then
  echo "Deployed $IMAGE_TAG to $PROJECT — all services healthy"
  docker image prune -f >/dev/null
  exit 0
fi

echo "Deploy of $IMAGE_TAG to $PROJECT failed:" >&2
$COMPOSE ps >&2
$COMPOSE logs --tail=60 >&2
exit 1
