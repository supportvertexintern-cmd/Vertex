#!/usr/bin/env sh
# Loads the local stack's database (docker-compose.yml) with the reference
# data (vertex/prisma/seed.ts: regions, countries, sectors, document
# requirements, job programmes) and the test accounts
# (vertex/scripts/seed-test-accounts.ts: one per staff role plus a partner,
# all with password TestPassword123!). Safe to re-run: both upsert.
#
#   sh scripts/local-seed.sh       # after `docker compose up -d --wait`
set -eu

cd "$(dirname "$0")/.."
[ -f .env ] || { echo "No .env here: run scripts/local-env.sh first." >&2; exit 1; }
env_value() { grep -E "^$1=" .env | tail -n 1 | cut -d= -f2- | tr -d '\r'; }

# The schema owner: seeding writes rows only, never DDL.
export DATABASE_URL="postgresql://vertex_migrator:$(env_value DB_MIGRATOR_PASSWORD)@localhost:$(env_value POSTGRES_HOST_PORT)/$(env_value POSTGRES_DB)"
# Prisma fills unset variables from vertex/.env (this machine's real
# credentials). The seed's only outside call is the Stripe pricing sync,
# which an empty key skips, so set it here.
export STRIPE_SECRET_KEY=

cd vertex
[ -d node_modules ] || npm ci
npx prisma db seed
npx tsx scripts/seed-test-accounts.ts
echo "Seeded. Log in at $(grep -E '^NEXT_PUBLIC_APP_URL=' ../.env | cut -d= -f2- | tr -d '\r') as e.g. admin@test.local / TestPassword123!"
