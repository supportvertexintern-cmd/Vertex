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

The whole platform runs locally with Docker: backend (`vertex_be/`), web
(`vertex/`) and app (`vertex_app/`), each built from its own Dockerfile, plus
Postgres, pgAdmin, MinIO and Mailpit, all from `docker-compose.yml`.

1. **Environment** (once): writes a gitignored `.env` with random secrets.
   ```bash
   sh scripts/local-env.sh        # Git Bash; from PowerShell:
                                  # & "C:\Program Files\Git\bin\bash.exe" scripts/local-env.sh
   ```

2. **Build and start**
   ```bash
   docker compose up -d --build --wait
   ```

   | Service | URL |
   |---|---|
   | Web (Next.js) | http://localhost:3010 |
   | App (Flutter web) | http://localhost:8090 |
   | API docs (FastAPI) | http://localhost:8010/docs |
   | pgAdmin | http://localhost:5070: "vertex-local (admin)" sees and edits everything (password `POSTGRES_PASSWORD`); "(read-only)" mirrors the deployed stacks (`DB_READONLY_PASSWORD`) |
   | MinIO console | http://localhost:9011 |
   | Mail (Mailpit) | http://localhost:8035 |
   | Postgres | `localhost:15433`, database `vertexdb` |

   Logins are in `.env`. The schema comes from the backend's Alembic
   migrations, never `prisma db push`.

3. **Seed** (on a new database): reference data (regions, countries,
   sectors, job programmes) and one test account per role, e.g.
   `admin@test.local`, all with password `TestPassword123!`.
   ```bash
   sh scripts/local-seed.sh
   ```

4. **Stop**: `docker compose down` (data is kept). Start over with
   `docker compose down -v`, then steps 2 and 3.

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
