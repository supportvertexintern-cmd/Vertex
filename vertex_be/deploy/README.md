# Backend environments & deployment

| Branch    | Environment | Runs where                       | What happens on push                          |
|-----------|-------------|----------------------------------|-----------------------------------------------|
| `dev`     | development | your PC, `localhost:8001`        | CI: tests + Docker build                      |
| `staging` | staging     | your PC, `localhost:8002`        | CI, then image built and pushed to GHCR       |
| `main`    | production  | not deployed yet                 | CI only                                       |

Work flows `feature/*` → PR into `dev` → PR `dev` → `staging` → PR `staging` → `main`.
CI also runs on every PR into those three branches.

Local Docker Desktop runs three separate Compose projects:

| Project          | Containers                                | URLs                                                        |
|------------------|-------------------------------------------|-------------------------------------------------------------|
| `vertex-dev`     | backend, Postgres, pgAdmin                | API http://localhost:8001/docs · pgAdmin http://localhost:5050 · Postgres `localhost:5432` |
| `vertex-staging` | backend, Postgres, pgAdmin                | API http://localhost:8002/docs · pgAdmin http://localhost:5151 · Postgres not exposed |
| `vertex-web`     | the Next.js web app (separate repo)       | http://localhost:3000 — uses the `vertex-dev` database      |

| | Development | Staging |
|---|---|---|
| Compose file | `docker-compose.yml` | `docker-compose.deploy.yml` |
| Env file | `.env` | `.env.staging` |
| Code | your working tree, auto-reload | the exact image CI pushed to GHCR |
| Data volume | `vertex_postgres_data` | `vertex-staging_postgres_data` |

Each pgAdmin already has its own database registered (`vertex-dev` / `vertex-staging`
under the *Vertex* group); log in with the `PGADMIN_*` values from that stack's
env file, then enter the Postgres password once. Staging's pgAdmin is behind the
`pgadmin` Compose profile (`COMPOSE_PROFILES=pgadmin` in `.env.staging`) and
bound to localhost, so it never runs on a VPS unless enabled there.

Staging runs the same image and compose file a VPS will use later, so what you
QA on staging is what ships.

## Development

```sh
cd vertex_be
docker compose up -d
```

The web app joins the `vertex-dev` network, so start `vertex-dev` first, then
`docker compose up -d` in the web repo.

## Local staging

One-time setup:

1. Copy `.env.staging.example` to `.env.staging` and fill in the values. The app
   refuses to start in staging with `DEBUG=true` or a weak `SECRET_KEY`.
2. Log Docker in to GHCR, because the images are private. Create a classic
   personal access token with only the `read:packages` scope (GitHub → Settings →
   Developer settings → Personal access tokens), then:

   ```sh
   docker login ghcr.io -u BrookTeferi     # paste the token as the password
   ```

After each push to `staging`, once the *Backend deploy — staging* run is green
(its summary prints this command with the exact tag), run from Git Bash:

```sh
cd vertex_be
ENV_FILE=.env.staging sh deploy/deploy.sh vertex-staging ghcr.io/brookteferi/vertex-backend:staging
```

It pulls the image, applies migrations, restarts and waits for the healthcheck.
Check http://localhost:8002/api/v1/health — it reports `"environment": "staging"`.

Tags: `:staging` is always the latest staging build; `:staging-<short sha>` pins
one commit. Run the command with an older sha tag to roll back.

Stop staging: `BACKEND_IMAGE=x docker compose -p vertex-staging --env-file .env.staging -f docker-compose.deploy.yml down`
(add `-v` to also wipe its database).

## Later: moving staging to a VPS

The workflow already contains the SSH deploy job; it's skipped until enabled.

1. On the VPS (Docker + compose plugin installed):

   ```sh
   sudo useradd -m -s /bin/bash deploy && sudo usermod -aG docker deploy
   sudo mkdir -p /opt/vertex/staging && sudo chown deploy: /opt/vertex/staging
   # as deploy: add the CI public key to ~/.ssh/authorized_keys
   # create /opt/vertex/staging/.env from .env.staging.example
   ```

2. In GitHub, Settings → Environments → **New environment** `staging`:

   | Kind     | Name              | Value                                                    |
   |----------|-------------------|----------------------------------------------------------|
   | secret   | `SSH_HOST`        | server IP / hostname                                     |
   | secret   | `SSH_USER`        | `deploy`                                                 |
   | secret   | `SSH_PRIVATE_KEY` | private half of a key made just for CI (`ssh-keygen -t ed25519`) |
   | secret   | `SSH_KNOWN_HOSTS` | output of `ssh-keyscan <SSH_HOST>`                       |
   | variable | `SSH_PORT`        | optional, default `22`                                   |
   | variable | `DEPLOY_PATH`     | optional, default `/opt/vertex/staging`                  |

3. Settings → Secrets and variables → Actions → Variables: add `STAGING_VPS_ENABLED` = `true`.

## Branch protection

Settings → Branches: protect `staging` and `main` (require a PR and passing
"Backend CI" checks).
