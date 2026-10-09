# Secrets: where they live and how to handle them

The rule: **no env file ever enters Git** — not real ones, not templates.
This is enforced, not just requested — see
[Guardrails](#guardrails).

## Where each secret lives

| Secret | Lives in |
|---|---|
| Local stack settings (DB passwords, `SECRET_KEY`, `JWT_SECRET`, pgAdmin login) | `vertex_be/.env.dev`, `vertex_be/.env.staging` on the Docker host |
| Backend run outside Docker / tests | `vertex_be/.env` |
| Next.js run outside Docker | `vertex/.env` |
| Future VPS | `.env` in the deploy path → move to SOPS + age or Infisical before production |
| CI/CD | GitHub → Settings → Secrets / Environments (`dev`, `staging`). Workflows use the built-in `GITHUB_TOKEN` for GHCR; no long-lived keys are stored. |

### Database credentials (per stack)

| Role | Used by | Can |
|---|---|---|
| `POSTGRES_USER` (superuser) | `deploy.sh` to provision roles; you, via psql, only when needed | everything — **never** given to an app, never pre-registered in pgAdmin |
| `vertex_migrator` | `alembic upgrade` at backend start | own and change the schema |
| `vertex_api` | FastAPI | read/write rows; no DDL, no `TRUNCATE`, append-only audit log |
| `vertex_web` | Next.js/Prisma | same as `vertex_api` |
| `vertex_readonly` | people browsing data in pgAdmin | `SELECT` on non-secret columns only: never password hashes, tokens/sessions or the audit log; no automatic access to new tables |

Roles and grants come from `vertex_be/deploy/db-roles.sql`, applied on every
deploy; `vertex_be/tests/test_db_roles.py` fails CI if a role can do more than
this. Each container receives only its own connection string.

## Creating a new environment's secrets

1. Create the env file (e.g. `vertex_be/.env.staging`) with the variables the
   compose file and apps read; ask a maintainer for the list.
2. Generate every secret value fresh:
   `python -c "import secrets; print(secrets.token_urlsafe(32))"`.
   Never reuse a value across environments or roles.
3. Deploy; `deploy.sh` creates/updates the database roles with those passwords.

## Rotating a secret

| Secret | How |
|---|---|
| `DB_API_PASSWORD` / `DB_WEB_PASSWORD` / `DB_MIGRATOR_PASSWORD` | Change it in the env file and redeploy — `deploy.sh` re-sets the role password and restarts the services with the new URL. |
| `POSTGRES_PASSWORD` (superuser) | `ALTER ROLE <user> PASSWORD '…'` via psql, then update the env file (the variable only takes effect on a brand-new volume). Update pgAdmin's saved password. |
| `SECRET_KEY` / `JWT_SECRET` | Change and redeploy; existing sessions/tokens become invalid. |
| pgAdmin login | Only read on first start: change the env file, remove the stack's `*_pgadmin_data` volume, start pgAdmin again. |
| `DB_READONLY_PASSWORD` | Change it in the env file and redeploy; `deploy.sh` re-sets the role password. |

## If a secret is committed or leaked

1. **Rotate it first.** Assume it's compromised the moment it was pushed;
   removing it from Git does not un-leak it.
2. Find every occurrence: `docker run --rm -v "$PWD:/repo" ghcr.io/gitleaks/gitleaks:v8.30.1 git /repo --config /repo/.gitleaks.toml --log-opts=--all`.
3. Remove it from history with `git filter-repo` (in a mirror clone), verify
   with the scan above, then force-push with `--force-with-lease`.
4. Everyone re-clones. Ask GitHub Support to purge cached views if needed.

## Guardrails

- **`.gitignore`** (repo root and per app): env files, keys, local databases.
- **pre-commit** (`pip install pre-commit && pre-commit install` once per clone):
  gitleaks on staged changes, private-key detection, and a hard block on
  env/database files even when force-added with `git add -f`.
- **CI**: gitleaks scans the full history on every run, using `.gitleaks.toml`,
  which adds rules for committed env files and short passwords that gitleaks'
  defaults miss.
- **GitGuardian** (GitHub app) scans pull requests independently.

CI's own test databases are disposable and use no password at all, so the
workflows contain nothing credential-shaped.
