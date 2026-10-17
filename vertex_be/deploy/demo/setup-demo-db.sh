#!/usr/bin/env bash
# Customer demo site (docs/demo-site.md): the cloud database and Vercel's
# settings. Demo data only; no secret is ever printed.
#
#   bash deploy/demo/setup-demo-db.sh db          # schema, roles, demo data on the Neon database
#   bash deploy/demo/setup-demo-db.sh vercel-env  # push DATABASE_URL, JWT_SECRET and the rest to Vercel
#
# Run from vertex_be/. First: powershell -File deploy/demo/demo-creds.ps1 set owner
#
# `db` mirrors deploy.sh: roles first (db-roles.sql), then the schema from
# the Alembic migrations as vertex_migrator, then the roles again; the data
# is loaded as vertex_web, the role the site uses. The Neon owner is used
# only here, never by the site. Every run sets fresh role passwords, so run
# `vercel-env` after it.
set -euo pipefail
export MSYS_NO_PATHCONV=1
BE="$(cd "$(dirname "$0")/../.." && pwd)"
ROOT="$(dirname "$BE")"
CREDS="$(cygpath -w "$BE/deploy/demo/demo-creds.ps1" 2>/dev/null || echo "$BE/deploy/demo/demo-creds.ps1")"
ACCOUNTS="${DEMO_ACCOUNTS_FILE:-D:/VertexData/demo/demo-accounts.txt}"
PY="$BE/env/Scripts/python.exe"; [ -x "$PY" ] || PY=python3
creds() { powershell -NoProfile -ExecutionPolicy Bypass -File "$CREDS" "$@"; }

# Swap the user and password in a connection string; keep host, db, options.
as_role() {
  ROLE="$1" PW="$2" URL="$3" "$PY" -c '
import os, urllib.parse as u
e = os.environ
p = u.urlsplit(e["URL"])
host = p.hostname + (":%d" % p.port if p.port else "")
print(u.urlunsplit((p.scheme, "%s:%s@%s" % (e["ROLE"], u.quote(e["PW"], safe=""), host), p.path, p.query, "")))'
}

db() {
  local owner; owner="$(creds get owner)"
  case "$owner" in *-pooler.*) echo "Use Neon's direct connection string (without -pooler) for setup" >&2; exit 1;; esac
  local mig api web ro
  mig=$(openssl rand -hex 24); api=$(openssl rand -hex 24); web=$(openssl rand -hex 24); ro=$(openssl rand -hex 24)

  provision() {
    { printf "\\set migrator_pw '%s'\n\\set api_pw '%s'\n\\set web_pw '%s'\n\\set readonly_pw '%s'\n" "$mig" "$api" "$web" "$ro"
      cat "$BE/deploy/readonly-columns.sql" "$BE/deploy/db-roles.sql"
    } | PGURL="$owner" docker run --rm -i --network host -e PGURL postgres:17-alpine sh -c 'psql "$PGURL" -q -v ON_ERROR_STOP=1' >/dev/null
  }

  echo "1/4 roles"; provision
  echo "2/4 schema (Alembic, as vertex_migrator)"
  local log; log="$(mktemp)"
  if ! (cd "$BE" && DATABASE_URL="$(as_role vertex_migrator "$mig" "$owner")" "$PY" -m alembic upgrade head) >"$log" 2>&1; then
    grep -E "Error|error" "$log" | tail -3 >&2; rm -f "$log"; echo "schema setup failed" >&2; exit 1
  fi
  grep -E "Running upgrade" "$log" || echo "   already at the latest revision"; rm -f "$log"
  echo "3/4 roles again (grants on the new tables)"; provision

  local web_url; web_url="$(as_role vertex_web "$web" "$owner")"
  echo "4/4 data (as vertex_web): reference data, then demo data"
  mkdir -p "$(dirname "$ACCOUNTS")"
  (cd "$ROOT/vertex" && DATABASE_URL="$web_url" npx tsx prisma/seed.ts >/dev/null 2>&1 || { echo "base seed failed" >&2; exit 1; })
  (cd "$ROOT/vertex" && DATABASE_URL="$web_url" DEMO_SEED=yes DEMO_ACCOUNTS_FILE="$ACCOUNTS" npx tsx prisma/demo-seed.ts)

  # Serverless functions open many short connections: keep each one small.
  case "$web_url" in *"?"*) web_url="${web_url}&connection_limit=3" ;; *) web_url="${web_url}?connection_limit=3" ;; esac
  printf '%s\n' "$web_url" | creds set web >/dev/null
  echo "Done. Demo accounts: $ACCOUNTS. Next: setup-demo-db.sh vercel-env"
}

vercel_env() {
  : "${DEMO_URL:?set DEMO_URL to the site address, e.g. https://vertex-demo.vercel.app}"
  cd "$ROOT/vertex"
  [ -f .vercel/project.json ] || { echo "Run 'npx vercel link' in vertex/ first" >&2; exit 1; }
  put() {  # name, value on stdin; replaces any existing value for production
    npx vercel env rm "$1" production -y >/dev/null 2>&1 || true
    npx vercel env add "$1" production >/dev/null
    echo "set $1"
  }
  creds get web | put DATABASE_URL
  openssl rand -hex 32 | put JWT_SECRET
  printf '%s' "$DEMO_URL" | put NEXT_PUBLIC_APP_URL
  printf 'demo' | put APP_ENV
  printf 'report-only' | put CSP_MODE
  echo "Vercel settings updated. They apply to the next deployment of main."
}

case "${1:-}" in
  db) db ;;
  vercel-env) vercel_env ;;
  *) echo "usage: setup-demo-db.sh db | vercel-env" >&2; exit 1 ;;
esac
