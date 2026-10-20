# Environments & CI/CD

## Branches → environments

| Branch    | Environment       | On push                                                                 |
|-----------|-------------------|-------------------------------------------------------------------------|
| `dev`     | `vertex-dev`      | build & push all images to GHCR → auto-deploy to this PC                |
| `staging` | `vertex-staging`  | build & push all images to GHCR → auto-deploy to this PC                |
| `main`    | `vertex-main`     | build & push only. Deploys **by hand**: Actions → Deploy local stacks → Run workflow → `main` |

Work flows `feature/*` → PR into `dev` → PR `dev` → `staging` → PR `staging` → `main`.
CI runs on the PRs into those three branches, not again on the push, so merge
only when **CI passed** is green. A direct push to `dev` or `staging` deploys
without CI; the pre-commit hooks refuse commits on `main` and `staging`.

## What runs where

Each environment is one Docker Compose project built from
[`docker-compose.deploy.yml`](../docker-compose.deploy.yml) and its env file:

| Service      | Image                    | vertex-dev               | vertex-staging           | vertex-main              |
|--------------|--------------------------|--------------------------|--------------------------|--------------------------|
| backend      | `vertex-backend`         | http://localhost:8001/docs | http://localhost:8002/docs | http://localhost:8003/docs |
| flutter-web  | `vertex-flutter-web`     | http://localhost:8081    | http://localhost:8082    | http://localhost:8083    |
| nextjs       | `vertex-nextjs`          | http://localhost:3001    | http://localhost:3002    | http://localhost:3003    |
| pgadmin (on demand) | `dpage/pgadmin4`  | http://localhost:5050    | http://localhost:5151    | http://localhost:5353    |
| db           | `postgres:15-alpine`     | not published            | not published            | not published            |
| minio (object storage) | `vertex-minio` (built from source) | not published | not published | not published |
| mailpit (mail catcher) | `axllent/mailpit` | http://localhost:8026 | http://localhost:8027 | http://localhost:8028 |
| env file     |                          | `vertex_be/.env.dev`     | `vertex_be/.env.staging` | `vertex_be/.env.main`    |

vertex-main holds the main data (restored 2026-10-10 from the old
`vertex_postgres_data` volume, which is kept untouched as a backup). It runs
with `APP_ENV=production`.

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
- Everything published is bound to localhost only. Staging's Postgres is not
  published at all.
- **pgAdmin is off by default.** Start it when you need it, stop it after:

  ```sh
  cd vertex_be
  ENV_FILE=.env.dev sh deploy/pgadmin.sh vertex-dev up     # or vertex-staging
  ENV_FILE=.env.dev sh deploy/pgadmin.sh vertex-dev down
  ```

  It pre-registers the stack's database as **`vertex_readonly`** (SELECT only;
  password `DB_READONLY_PASSWORD`). Superuser access is never pre-registered;
  add it by hand only when you need it, and it is dropped on the next start.

Images are tagged `<branch>-<commit sha>` (exact build) and `<branch>` (latest).

## The pipeline

[`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) — on PRs (PRs into
`dev` run only the suites whose folders changed; promotions into `staging` and
`main` run everything, including the end-to-end journeys and image scans):

| Job      | Checks                                                                 |
|----------|------------------------------------------------------------------------|
| backend  | pytest against Postgres (migrations apply, models match schema)        |
| flutter  | `flutter analyze` (errors fail), `flutter test`                        |
| nextjs   | `tsc`, vitest against a seeded Postgres (R2 upload test is local-only) |
| images   | all three Docker images build                                          |

[`.github/workflows/build.yml`](../../.github/workflows/build.yml) — on push to
`dev` / `staging` / `main`: pushes the four images (backend, Flutter web,
Next.js, MinIO) tagged `<branch>-<sha>` and `<branch>`.

[`.github/workflows/deploy-local.yml`](../../.github/workflows/deploy-local.yml) —
when a `dev` / `staging` build succeeds (or by hand, for `main`): the
**self-hosted runner on this PC** runs `deploy/deploy.sh`, which pulls that
exact build and restarts the stack, waiting until every container is healthy.
A failed health check fails the run and prints the logs. It's triggered by
`workflow_run`, which GitHub only honours once the workflow file is on the
default branch (`main`).

Production on the servers is [`production.yml`](../../.github/workflows/production.yml);
see [docs/CI-CD-SETUP.md](../../docs/CI-CD-SETUP.md).

## One-time setup

### 1. Env files

`vertex_be/.env.dev` and `vertex_be/.env.staging` (gitignored) hold each stack's
settings and secrets. They are not in Git in any form; keep a secure backup.
The runner reads them from `LOCAL_ENV_DIR`
(default `D:/Django Projects/vertex_main/vertex_be`; override with a repo variable).

### 2. Self-hosted runner

GitHub → repo **Settings → Actions → Runners → New self-hosted runner → Windows**.
Copy the token from the `config.cmd` line, then in PowerShell:

```powershell
mkdir C:\actions-runner; cd C:\actions-runner
# download + extract the runner zip using the commands GitHub shows, then:
.\config.cmd --url https://github.com/supportvertexintern-cmd/Vertex --token <TOKEN> `
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

## Running the backend tests

```sh
cd vertex_be
sh scripts/test.sh          # extra args go to pytest
```

They run against a throwaway Postgres container, never a stack's database.

## Verifying a stack

After a deploy, check one stack against the Phase 2 security properties
(ports, networks, database roles, G1/G2/G10/G11/G17); it prints a markdown
table, recorded in `docs/security/phase2-verification.md`:

```sh
cd vertex_be
LAN_IP=<this PC's LAN address> bash deploy/verify-stack.sh dev   # or staging
```

## Object storage (MinIO)

Each stack has its own MinIO (S3 API) for uploaded documents. Files are on
this PC in `D:\VertexData\minio\<env>` (MinIO's own format: a folder per
file, so open documents through the app or `mc`, not by double-clicking).

- Only on the internal `data` network: no published port, web console off.
- `deploy/minio-bootstrap.sh` (run by every deploy, idempotent) creates the
  bucket `vertex-<env>` and the app's key `vertex-app-<env>`, whose policy
  allows reading, writing and deleting objects in that bucket only.
- The admin login (`MINIO_ROOT_*` in the env file) is never given to an app.
- The image is built from pinned MinIO and `mc` release tags in
  `deploy/minio/Dockerfile`: the community edition is source-only.
- Moving to AWS S3 later is configuration: drop `S3_ENDPOINT`, set
  `S3_REGION`, an S3 bucket and IAM keys (`vertex/src/lib/upload.ts`).

Admin commands run inside the container, with its own credentials:

```sh
docker exec -it vertex-dev-minio-1 sh -c   'export MC_CONFIG_DIR=/tmp/.mc; mc alias set local http://127.0.0.1:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null; mc ls --recursive local/$VERTEX_S3_BUCKET'
```
