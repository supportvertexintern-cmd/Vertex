#!/usr/bin/env bash
# Loads a staging or main stack's empty database with what it needs to be
# used: the reference data (scripts/seed/reference.py) and one admin. No test
# accounts: their password is public, so deploy/seed-dev.sh keeps them on
# development stacks. Safe to re-run: reference data upserts, and an existing
# admin is left as it is. Refuses any stack whose env file isn't
# APP_ENV=staging or APP_ENV=production.
#
#   ENV_FILE=.env.staging bash deploy/seed-staging.sh vertex-staging
#   ENV_FILE=.env.main    bash deploy/seed-staging.sh vertex-main
#
# The admin's address and generated password are SEED_ADMIN_EMAIL and
# SEED_ADMIN_PASSWORD in the env file, and are never printed. Everything runs
# inside the backend container as the schema owner, so Postgres stays unpublished
# (exception E2).
set -euo pipefail

PROJECT="${1:?usage: ENV_FILE=.env.staging $0 <project-name>}"
ENV_FILE="${ENV_FILE:-.env}"
env_value() { grep -E "^$1=" "$ENV_FILE" | tail -n 1 | cut -d= -f2- | tr -d '\r'; }

case "$(env_value APP_ENV)" in
  staging|production) ;;
  *) echo "seed-staging.sh: $ENV_FILE is not a staging or main stack" >&2; exit 1 ;;
esac

if [ -z "$(env_value SEED_ADMIN_PASSWORD)" ]; then
  umask 077
  {
    echo "SEED_ADMIN_EMAIL=admin@$PROJECT.test"
    echo "SEED_ADMIN_PASSWORD=$(od -An -N24 -tx1 /dev/urandom | tr -d ' \n')"
  } >> "$ENV_FILE"
fi

as_owner() { docker exec -i "$PROJECT-backend-1" sh -c 'DATABASE_URL="$MIGRATION_DATABASE_URL" exec python -m "$0"' "$1"; }
as_owner scripts.seed.reference </dev/null
printf '%s\n%s\n' "$(env_value SEED_ADMIN_EMAIL)" "$(env_value SEED_ADMIN_PASSWORD)" | as_owner scripts.seed.first_admin
echo "Seeded. Sign in at $(env_value NEXT_PUBLIC_APP_URL) as $(env_value SEED_ADMIN_EMAIL); the password is SEED_ADMIN_PASSWORD in $ENV_FILE."
