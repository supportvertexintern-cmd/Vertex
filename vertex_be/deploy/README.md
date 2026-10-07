# Backend environments & deployment

| Branch    | Environment | What happens on push                                        |
|-----------|-------------|-------------------------------------------------------------|
| `dev`     | development | CI: tests + Docker build                                    |
| `staging` | staging     | CI, then image pushed to GHCR and deployed to the staging VPS |
| `main`    | production  | CI only (production deploy not wired up yet)                |

Work flows `feature/*` → PR into `dev` → PR `dev` → `staging` → PR `staging` → `main`.
CI also runs on every PR into those three branches.

Images: `ghcr.io/brookteferi/vertex-backend:staging` (latest) and
`:staging-<short sha>` (what's actually deployed; redeploy an old one to roll back).

## One-time staging server setup

On a Linux VPS with Docker + the compose plugin installed:

```sh
sudo useradd -m -s /bin/bash deploy && sudo usermod -aG docker deploy
sudo mkdir -p /opt/vertex/staging && sudo chown deploy: /opt/vertex/staging
# as deploy: put the CI public key in ~/.ssh/authorized_keys
```

Create `/opt/vertex/staging/.env` from [`.env.staging.example`](../.env.staging.example).
The app refuses to start in staging/production with `DEBUG=true` or a weak `SECRET_KEY`.

## One-time GitHub setup

Settings → Environments → **New environment** `staging`:

| Kind     | Name              | Value                                                    |
|----------|-------------------|----------------------------------------------------------|
| secret   | `SSH_HOST`        | server IP / hostname                                     |
| secret   | `SSH_USER`        | `deploy`                                                 |
| secret   | `SSH_PRIVATE_KEY` | private half of a key made just for CI (`ssh-keygen -t ed25519`) |
| secret   | `SSH_KNOWN_HOSTS` | output of `ssh-keyscan <SSH_HOST>`                       |
| variable | `SSH_PORT`        | optional, default `22`                                   |
| variable | `DEPLOY_PATH`     | optional, default `/opt/vertex/staging`                  |

Then Settings → Branches: protect `staging` and `main` (require PR + the
"Backend CI" checks to pass).

## Manual deploy / rollback

Actions → *Backend deploy — staging* → **Run workflow**, or on the server:

```sh
cd /opt/vertex/staging
sh deploy.sh vertex-staging ghcr.io/brookteferi/vertex-backend:staging-<sha>
```
