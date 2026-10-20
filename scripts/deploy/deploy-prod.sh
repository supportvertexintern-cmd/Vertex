#!/usr/bin/env bash
# Production deploy, run by the prod-ops runner on ops-server.
# Usage: deploy-prod.sh <image tag, e.g. main-<sha>>
#
# Expects on ops-server:
#   ~/.ssh/config with "Host app-server" -> private IP, User deploy, IdentityFile ~/.ssh/deploy_app
# Expects on app-server (/opt/app):
#   docker-compose.prod.yml using ${IMAGE_TAG} for all three images, a "migrate"
#   one-off service (alembic upgrade head as vertex_migrator), .env (mode 600),
#   and a GHCR read token already logged in for the deploy user.
set -euo pipefail

TAG="${1:?image tag required}"
HOST="${DEPLOY_HOST:-app-server}"
DIR="${DEPLOY_DIR:-/opt/app}"
HEALTH_URLS="${HEALTH_URLS:-http://localhost:8000/api/v1/health http://localhost:3000/}"

ssh "$HOST" bash -s -- "$TAG" "$DIR" "$HEALTH_URLS" <<'REMOTE'
set -euo pipefail
TAG="$1"; DIR="$2"; HEALTH_URLS="$3"
cd "$DIR"
PREV="$(cat .current_tag 2>/dev/null || echo none)"
echo "Current: $PREV -> new: $TAG"

export IMAGE_TAG="$TAG"
docker compose -f docker-compose.prod.yml pull

# Schema first; migrations stay backward compatible for one release.
docker compose -f docker-compose.prod.yml run --rm migrate

docker compose -f docker-compose.prod.yml up -d --remove-orphans

healthy=true
for url in $HEALTH_URLS; do
  ok=false
  for i in $(seq 1 30); do
    if curl -fsS -o /dev/null "$url"; then ok=true; break; fi
    sleep 5
  done
  $ok || { echo "Health check failed: $url"; healthy=false; }
done

if $healthy; then
  echo "$TAG" > .current_tag
  echo "$PREV" > .previous_tag
  docker image prune -f >/dev/null
  echo "Deployed $TAG"
else
  if [ "$PREV" != "none" ]; then
    echo "Rolling back to $PREV"
    export IMAGE_TAG="$PREV"
    docker compose -f docker-compose.prod.yml up -d --remove-orphans
  fi
  docker compose -f docker-compose.prod.yml logs --tail=100
  exit 1
fi
REMOTE
