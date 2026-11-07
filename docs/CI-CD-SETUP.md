# CI/CD setup on GitHub Free

Single developer, repository `supportvertexintern-cmd/Vertex` on GitHub Free, three long-lived branches
(`dev` → `staging` → `main`). Everything here costs $0: GitHub-hosted runners
use the 2,000 free minutes; the two self-hosted runners cost nothing.

**The repository must be private** (§A): `docs/security/` describes known exceptions, and a
self-hosted runner on a public repository is a risk of its own. On 2026-11-07 it was found
**public**, readable without signing in; only an admin can change that.

## What runs when

| Event | Workflow | Runner | Result |
|---|---|---|---|
| Pull request into `dev` | `ci.yml` | GitHub-hosted | Secret scan + only the suites whose folders changed; image builds and Trivy only if a Dockerfile, compose file, workflow or `.trivyignore.yaml` changed |
| Pull request into `staging` or `main`, or a manual run | `ci.yml` | GitHub-hosted | Everything: secret scan, backend, Flutter, Next.js, end-to-end journeys, image builds + Trivy |
| Every push to `dev`, or Actions → **Promote** → Run workflow from `dev` (→ `staging`) or `staging` (→ `main`) | `promote.yml` | GitHub-hosted | Full CI on that exact commit (a second full run: the pull request's ran on the branch's own commit, not the merge, and PRs into `dev` run only the changed suites), then a fast-forward of the next branch (no merge commit, so the branches stay identical). For `staging`: the source's images copied to `staging-<sha>`, not rebuilt, and **Deploy local stacks** dispatched; `build.yml` runs on the target only when the source has no build for that commit (a docs-only push) |
| Merge into `dev`, `staging` or `main` | `build.yml` | GitHub-hosted | Four images (backend, Flutter web, Next.js, MinIO) pushed to GHCR as `<branch>-<sha>` and `<branch>` |
| Build finished on `dev` / `staging` | `deploy-local.yml` | `vertex-host` (Windows PC) | Local `vertex-dev` / `vertex-staging` stack updated via `vertex_be/deploy/deploy.sh` |
| You click "Run workflow" on `main` in **Deploy local stacks** | `deploy-local.yml` | `vertex-host` | Local `vertex-main` stack updated (never automatic) |
| You click "Run workflow" on `main` in **Production release** | `production.yml` | `prod-ops` (ops-server) | Pull images, migrate, restart, health check, auto-rollback, tag `vYYYY.MM.DD` |
| Monday | `image-scan.yml` | GitHub-hosted | All four images rebuilt from fresh bases (`--pull --no-cache`), full Trivy report kept 90 days, gate on fixable HIGH/CRITICAL (exceptions in [security/exceptions.md](security/exceptions.md), dated ignores in `.trivyignore.yaml`) |
| Sunday 03:00 UTC, and when a pull request closes | `cleanup-caches.yml` | GitHub-hosted | Delete a closed pull request's Actions caches; weekly, caches unused for 20+ days |
| Sunday 03:30 UTC | `cleanup-packages.yml` | GitHub-hosted | Delete untagged image versions, keep newest 20 |
| Monday | Dependabot | GitHub | Grouped update PRs into `dev` |

CI no longer runs on the push after a merge: it ran on the pull request. Merge only when the **CI passed** check is green.

## Free-plan safeguards (instead of branch protection)

1. Always work on a branch; open a PR into `dev`; merge only when the **CI passed** check is green. Move `dev` to `staging` and `staging` to `main` with **Promote**, never with back-merges (`main` → `dev` and the like): each merge commit makes the other branch "behind", which never ends. A direct push to `dev` or `staging` builds and deploys without CI.
2. Pre-commit hooks (`.pre-commit-config.yaml`, `pre-commit install`): `no-commit-to-branch` refuses commits on `main` and `staging`; `no-push-to-main` refuses pushes to `main`.
3. Production deploys only by manual trigger, only from `main`, only by `vars.PROD_DEPLOYER`,
   only after typing `release`, only on the `prod-ops` runner.
4. Production secrets never go into GitHub; they live in `/opt/app/.env` on app-server (mode 600).

## One-time setup (in this order)

### A. Repository settings (owner, or you once you have admin)
- [ ] General → Danger Zone: visibility **private** (the old repository was private; `docs/security/` describes known exceptions)
- [ ] General → Pull Requests: allow **squash** and **merge commits**, disable rebase; enable "Automatically delete head branches"
- [ ] Actions → General: workflow permissions **Read repository contents**; "Require approval for all outside collaborators"
- [ ] Security → enable **Dependabot alerts** and **Dependabot security updates**
- [ ] Variables → `PROD_DEPLOYER` = the GitHub username allowed to release
- [ ] Variables → `LOCAL_ENV_DIR` = the folder holding `.env.dev` / `.env.staging` / `.env.main` on the PC (default `D:/Django Projects/vertex_main/vertex_be`)

### B. The kit itself (done on branch `infra/cicd-free-tier`)
Merged into the existing workflows rather than replacing them:
- `ci.yml` kept every job and service it had (MinIO, ClamAV and Mailpit services, the E1 production-dependency check, Alembic-built schema, gitleaks over full history) and gained the kit's change detection, end-to-end journeys and image scans on promotions, and the **CI passed** check.
- `deploy.yml` was split into `build.yml` (now also builds `vertex-minio`) and `deploy-local.yml` (same PowerShell + Git Bash deploy steps, plus the manual `vertex-main` deploy).
- `image-scan.yml` kept its fresh-base rebuild of all four images (the E4 compensating control) instead of scanning the published images.
- GHCR owner changed to `ghcr.io/supportvertexintern-cmd/` in CI and `vertex_be/docker-compose.deploy.yml`.

### C. GHCR packages (after the first `build.yml` run)
- [ ] For each package `vertex-backend`, `vertex-nextjs`, `vertex-flutter-web`, `vertex-minio`: Package settings → visibility **private**, "Manage Actions access" → add the repository with **Write** (needed by the clean-up workflow)
- [ ] The former repository's own packages: nothing pulls them any more (every workflow and compose file uses `ghcr.io/supportvertexintern-cmd/`); delete them when that repository is retired
- [ ] Archive the former repository (Settings → Archive), after §D has moved the runner off it. Every branch's content was confirmed in this repository on 2026-11-07, and a bundle of the old local clone is in `D:\VertexData\archive\old-clone-2026-11-07`

### D. Windows runner for local stacks
- [ ] First cancel any queued **Deploy local stacks** runs (Actions → the run → Cancel workflow): once the runner connects it takes the oldest first, which can roll a stack back to an older commit
- [ ] On the PC: remove the runner from the former repository (`config.cmd remove`, or delete `.runner`, `.credentials` and `.credentials_rsaparams` if that repository is gone). **Still open on 2026-11-07:** the runner was registered there, so this repository's deploy jobs stayed queued
- [ ] Settings → Actions → Runners → New self-hosted runner (Windows) → register with label `vertex-host`, run as a service ([vertex_be/deploy/README.md](../vertex_be/deploy/README.md))
- [ ] Make it recover by itself. On 2026-11-07 a network drop left it running but no longer polling, and it needed a restart by hand. As a service: `services.msc` → the runner → Startup type **Automatic (Delayed Start)**; Recovery: restart the service on the first, second and later failures, after 1 minute, resetting the count after 1 day. From an elevated PowerShell: `sc.exe failure "<service name>" reset= 86400 actions= restart/60000/restart/60000/restart/60000`. Confirm by stopping the runner process: it should be back within about a minute
- [ ] `deploy-local.yml` is started by `workflow_run`, which GitHub only honours once the file is on the default branch (`main`): promote this change to `main` first. Staging's deploy doesn't wait for that: Promote dispatches it
- [ ] Merge something into `dev` and confirm `deploy-local.yml` updates `vertex-dev`

### E. Production runner on ops-server (server week 1)
```bash
# on ops-server, as a dedicated non-root user "runner"
sudo useradd -m -s /bin/bash runner && sudo usermod -aG docker runner   # docker only if needed for checks
# Settings → Actions → Runners → New self-hosted runner (Linux x64/ARM64): follow the shown commands, then:
./config.sh --url https://github.com/supportvertexintern-cmd/Vertex --token <TOKEN> --labels prod-ops --name ops-server --unattended
sudo ./svc.sh install runner && sudo ./svc.sh start
# SSH from runner -> app-server over the private network
sudo -u runner ssh-keygen -t ed25519 -f /home/runner/.ssh/deploy_app -N ""
cat >> /home/runner/.ssh/config <<'EOF'
Host app-server
  HostName <app-server private IP>
  User deploy
  IdentityFile ~/.ssh/deploy_app
  StrictHostKeyChecking accept-new
EOF
```
- [ ] On app-server: create user `deploy` (in group `docker`), add the public key to `~deploy/.ssh/authorized_keys`, allow SSH only from ops-server's private IP (`ufw`)
- [ ] On app-server: `/opt/app/docker-compose.prod.yml` (from `scripts/deploy/docker-compose.prod.example.yml`; check its port and health-check assumptions against the images), `/opt/app/.env` and `/opt/app/.env.migrator` (mode 600), and `docker login ghcr.io` with a **read-only** token for the `deploy` user
- [ ] Dry run: Actions → Production release → Run workflow on `main` → type `release`

### F. Vercel staging preview
- [ ] Owner installs/approves the Vercel GitHub app for the new repository
- [ ] Vercel project → Git: connect the new repo; **Production Branch = `staging`**; Ignored Build Step to skip `dev` and feature branches if previews are not needed

## Minutes check
Settings → Billing → Actions once a month.
If it gets close: avoid many small pushes to open PRs (each push re-runs CI; `concurrency` cancels the older run), and batch promotions into `staging`, since those run the full suite.

## Releasing to production
1. Actions → **Promote** → Run workflow from `staging` (full CI, then `main` fast-forwards to `staging`); wait for `build.yml` to finish on `main`.
2. Actions → **Production release** → Run workflow (branch `main`) → leave tag empty → type `release`.
3. The job pulls `main-<sha>`, runs migrations, restarts, checks health; on failure it rolls back automatically.
4. To roll back later: run the workflow again with the previous tag (see `/opt/app/.previous_tag` or the release tags).
