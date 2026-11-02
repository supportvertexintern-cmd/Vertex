# Vertex International Recruitment Platform

A modern, full-stack recruitment platform built for international job placements.

## Tech Stack
- **Frontend:** Next.js 14, React, TypeScript, TailwindCSS v4
- **Backend:** Next.js API Routes
- **Database:** PostgreSQL with Prisma ORM (v6)
- **Authentication:** Custom JWT-based auth + bcrypt hashing
- **Email:** Nodemailer (SMTP)
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
   sectors, job programmes) and one test account per role, e.g.
   `admin@test.local`, all with password `TestPassword123!`.
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

Tests run against throwaway databases, never this stack:
`vertex_be/scripts/test.sh`, `vertex/scripts/test.sh` (Vitest) and
`vertex/scripts/test-e2e.sh` (Playwright).

## Project Architecture
- `src/app/*`: Next.js App Router pages and layouts.
- `src/app/api/*`: Backend REST API routes.
- `src/components/*`: Reusable React components (Navbar, Footer).
- `src/lib/*`: Core utilities (Prisma client, JWT, Auth, Email, Rate limiting, File upload).
- `prisma/schema.prisma`: Database schema definition.

## Deployment

**Frontend (Vercel)**
- Push the code to GitHub.
- Connect the repository to Vercel.
- Add all environment variables (including `DATABASE_URL`) to Vercel's Edge Environment settings.

**Database (PostgreSQL)**
- Production runs on a Prisma Postgres instance; see `vertex/CLAUDE.md` and `vertex/docs/CPANEL_DEPLOYMENT.md`.
- Paste the connection string into the `DATABASE_URL` environment variable. Never commit it (see `docs/secrets.md`).

## Notes
- **File Uploads:** Uploads are stored locally in `public/uploads/` by default. For production (e.g., Vercel), you must change this to use AWS S3, Cloudinary, or Vercel Blob, as Vercel's filesystem is read-only and ephemeral.
