# Vertex International Recruitment Platform

A modern, full-stack recruitment platform built for international job placements.

## Tech Stack
- **Frontend:** Next.js 16, React 19, TypeScript, TailwindCSS v4
- **Backend:** FastAPI (`vertex_be`); the Next.js API routes check the session and pass requests on
- **Database:** PostgreSQL, owned by FastAPI (SQLAlchemy models, Alembic migrations)
- **Authentication:** Custom JWT-based auth + bcrypt hashing
- **Email:** SMTP
- **File storage:** Private S3-compatible object storage
- **Validation:** Zod

## Local Setup Instructions

One stack runs on this PC: **`vertex-dev`**, the `dev` branch as CI built
it (images `dev-<commit>` from GitHub's registry). Backend (`vertex_be/`),
web (`vertex/`) and app (`vertex_app/`), plus Postgres, Redis, MinIO, the
edge proxy and Mailpit, from `vertex_be/docker-compose.deploy.yml`. Commands
run from `vertex_be/` in Git Bash (from PowerShell: `& "C:\Program
Files\Git\bin\bash.exe" -c "cd '/d/Django Projects/vertex_main/vertex_be' && ..."`).

1. **Environment** (once): `vertex_be/.env.dev`, gitignored and never
   committed in any form. Its settings are listed in
   `vertex_be/deploy/README.md` ("Env files"); the session keys come from
   `bash deploy/session-keys.sh .env.dev`.

2. **Deploy** a `dev` commit that CI has built (or update to a newer one):
   ```bash
   ENV_FILE=.env.dev bash deploy/deploy.sh vertex-dev dev-<full commit sha>
   ```
   It pulls the images, applies the migrations, sets the database roles and
   waits until every service is healthy.

   | Service | URL |
   |---|---|
   | Web (Next.js) | http://localhost:3001 |
   | App (Flutter web) | http://localhost:8081 |
   | API docs (FastAPI) | http://localhost:8001/docs |
   | Mail (Mailpit) | http://localhost:8026 |
   | MinIO console (on demand, below) | http://localhost:9001 |
   | pgAdmin (on demand, below) | http://localhost:5050 |

3. **Seed** (on a new database): reference data (regions, countries,
   sectors, job programmes) and development test accounts.
   ```bash
   ENV_FILE=.env.dev sh deploy/seed-dev.sh vertex-dev
   ```

4. **On demand**, off otherwise (exception E2: MinIO and Postgres have no
   published port):
   - MinIO console: `ENV_FILE=.env.dev sh deploy/minio-console.sh vertex-dev up`
     (and `down`). Log in with `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD`
     from `.env.dev`. Port 9001 is the console; 9000 is the S3 API, which
     has no web page.
   - pgAdmin: `ENV_FILE=.env.dev sh deploy/pgadmin.sh vertex-dev up` (and
     `down`); read-only, password `DB_READONLY_PASSWORD`.

5. **Stop and start**: `docker compose -p vertex-dev stop` keeps everything;
   `docker compose -p vertex-dev start` brings it back. Each service has a
   memory and CPU cap (`mem_limit`, `cpus` in the deploy file).

To try backend changes before CI builds them, `docker-compose.local.yml`
swaps the stack's backend for your working tree with live reload (see that
file). `bash deploy/verify-stack.sh dev` (from `vertex_be/deploy`) checks the
stack's security conditions.

Tests run against throwaway databases and services, not this stack:
`vertex_be/scripts/test.sh`, `vertex/scripts/test.sh` (Vitest) and
`vertex/scripts/test-e2e.sh` (Playwright).

## Project Architecture
- `vertex/`: Next.js web application and Flutter web client is under `vertex_app/`.
- `vertex_be/`: FastAPI application, SQLAlchemy models, and Alembic migrations.
- `vertex_app/`: Flutter client that consumes the backend API.
- The backend owns PostgreSQL access and application schema; web and mobile clients use APIs.

## Deployment

The active CI, image build, promotion, and deployment process is documented in
[`vertex_be/deploy/README.md`](vertex_be/deploy/README.md) and implemented in
[`.github/workflows/`](.github/workflows/). Follow those controls; do not treat
this README as authorization to deploy or promote a release.

## Notes
- For source hierarchy and known documentation limitations, see
  [`vertex/docs/SOURCE_AUTHORITY.md`](vertex/docs/SOURCE_AUTHORITY.md).
