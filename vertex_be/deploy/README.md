# Environments & CI/CD

## Branches → environments

| Branch    | Environment       | On push                                                                 |
|-----------|-------------------|-------------------------------------------------------------------------|
| `dev`     | `vertex-dev`      | CI → build & push all images to GHCR → auto-deploy to this PC           |
| `staging` | `vertex-staging`  | CI → build & push all images to GHCR → auto-deploy to this PC           |
| `main`    | production        | CI only (no production host yet)                                        |

Work flows `feature/*` → PR into `dev` → PR `dev` → `staging` → PR `staging` → `main`.
CI runs on every PR into those three branches, so nothing merges red.

## What runs where

Each environment is one Docker Compose project built from
[`docker-compose.deploy.yml`](../docker-compose.deploy.yml) and its env file:

| Service      | Image                    | vertex-dev               | vertex-staging           |
|--------------|--------------------------|--------------------------|--------------------------|
| backend      | `vertex-backend`         | http://localhost:8001/docs | http://localhost:8002/docs |
| flutter-web  | `vertex-flutter-web`     | http://localhost:8081    | http://localhost:8082    |
| nextjs       | `vertex-nextjs`          | http://localhost:3001    | http://localhost:3002    |
| pgadmin      | `dpage/pgadmin4`         | http://localhost:5050    | http://localhost:5151    |
| db           | `postgres:15-alpine`     | `localhost:5432`         | `localhost:5433`         |
| env file     |                          | `vertex_be/.env.dev`     | `vertex_be/.env.staging` |

- The **backend** applies Alembic migrations on start; **Next.js** waits for it
  and never runs `prisma migrate`, so the schema has one owner.
- Each service connects as its own **least-privilege database role**
  (`vertex_migrator`, `vertex_api`, `vertex_web`), provisioned by
  [`db-roles.sql`](db-roles.sql) on every deploy. The superuser is for admin
  only. See [docs/secrets.md](../../docs/secrets.md).
- **Flutter web** gets its API URL at runtime from `/config.json` (from
  `PUBLIC_API_URL`), so the same image works in every environment.
- **Next.js** `NEXT_PUBLIC_*` values are baked in at image build time; its
  server-side settings come from the env file.
- Postgres and pgAdmin are bound to localhost only. Each pgAdmin has its stack's
  database pre-registered under the *Vertex* group.

Images are tagged `<branch>-<commit sha>` (exact build) and `<branch>` (latest).

## The pipeline

[`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) — on PRs and `main`:

| Job      | Checks                                                                 |
|----------|------------------------------------------------------------------------|
| backend  | pytest against Postgres (migrations apply, models match schema)        |
| flutter  | `flutter analyze` (errors fail), `flutter test`                        |
| nextjs   | `tsc`, vitest against a seeded Postgres (R2 upload test is local-only) |
| images   | all three Docker images build                                          |

[`.github/workflows/deploy.yml`](../../.github/workflows/deploy.yml) — on push to
`dev` / `staging`: runs CI, pushes the three images, then the **self-hosted runner
on this PC** runs `deploy/deploy.sh`, which pulls that exact build and restarts
the stack, waiting until every container is healthy. A failed health check
fails the run and prints the logs.

## One-time setup

### 1. Env files

`vertex_be/.env.dev` and `vertex_be/.env.staging` (gitignored) hold each stack's
settings and secrets. They are not in Git in any form; keep a secure backup.
The runner reads them from `LOCAL_ENV_DIR`
(default `D:/Django Projects/Vertex/vertex_be`; override with a repo variable).

### 2. Self-hosted runner

GitHub → repo **Settings → Actions → Runners → New self-hosted runner → Windows**.
Copy the token from the `config.cmd` line, then in PowerShell:

```powershell
mkdir C:\actions-runner; cd C:\actions-runner
# download + extract the runner zip using the commands GitHub shows, then:
.\config.cmd --url https://github.com/BrookTeferi/Vertex --token <TOKEN> `
  --name vertex-pc --labels vertex-host --unattended
.\run.cmd          # or install it as a service running as *your* user
```

The runner must run as your Windows user (not `NETWORK SERVICE`) so it can use
Docker Desktop. Docker Desktop must be running for deploys to succeed.

### 3. Branch protection (recommended)

Settings → Branches: protect `dev`, `staging` and `main` — require a PR and the
CI checks to pass.

## Manual deploy / rollback

Re-run a previous *Deploy* run in the Actions tab, or from Git Bash on this PC:

```sh
cd vertex_be
docker login ghcr.io -u BrookTeferi     # once; PAT with read:packages
ENV_FILE=.env.staging sh deploy/deploy.sh vertex-staging staging-<full commit sha>
```

Stop a stack: `IMAGE_TAG=x docker compose -p vertex-staging --env-file .env.staging -f docker-compose.deploy.yml down`
(add `-v` to wipe its database).

## Backend live reload

To work on the backend inside vertex-dev with your working tree mounted:

```sh
cd vertex_be
docker compose -p vertex-dev --env-file .env.dev \
  -f docker-compose.deploy.yml -f docker-compose.local.yml up -d --build backend
```

The next deploy to `dev` swaps the published image back in.

## Later: a VPS

`docker-compose.deploy.yml` and `deploy.sh` already work on a Linux host: put
`.env` (same variables as `.env.staging`, without `COMPOSE_PROFILES`) in the
deploy path, install a self-hosted runner there with
its own label, and point the deploy job's `runs-on` at it.
