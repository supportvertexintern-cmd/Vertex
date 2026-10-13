# Release checklist: security hardening to vertex-main

Phase 12 (local release readiness), prepared 2026-10-12.

| | |
|---|---|
| **Release** | `dev` → `main`, by pull request, merged by the owner, then deployed with the **Deploy** workflow (manual dispatch) |
| **From** | `main` at `4a55ab8` (2026-10-11) |
| **To** | `283075f` (release candidate, identical on dev and staging) |
| **Database** | vertex-main migrates `0001` → `0004` on backend start (additive; nothing dropped) |
| **Approval needed** | the exceptions in §3, then the merge and the dispatch |

## 1. What ships

14 commits on top of `main`:

| Area | Change | Doc |
|---|---|---|
| E2E | End-to-end journeys repaired and gated in CI | Phase 7 |
| Uploads | File type checked from the bytes, server-chosen names, ClamAV malware scanning (fail-open, scanned again on first access) | Phase 9 |
| Logging | Structured logs, `X-Request-ID` correlation, security events (sign-ins, denials, document views), alerts by email | [audit-logging-monitoring.md](audit-logging-monitoring.md) |
| DAST | CSP and security headers, controlled errors, form fixes, chat input validation | [dast-zap.md](dast-zap.md) |
| Schema | **Drift fix:** migration `0004` adds what the app needs. Case, payment and job pages work on main for the first time | [dast-zap.md §3](dast-zap.md) |
| Data | Partner-candidate drafts can't break pages | [dast-zap.md §3](dast-zap.md) |
| Backups | Encrypted 6-hourly backups, retention, restore drill, recovery runbook | [backup-recovery.md](backup-recovery.md) |
| Dependencies | `next` 16.3.8 (critical fix), `nodemailer` 10, FastAPI 0.143 / Starlette 1.7, and others | §2, step 2 |
| Images | Hardened containers | §2, step 2 |

## 2. Mandatory checks

| # | Check | Result | Evidence |
|---|---|---|---|
| 1 | **Full test suite** | ✅ Next.js **306 passed** + 3 expected failures (G19, tracked); backend **85 passed**; Flutter analyze and test; **end-to-end journeys** | CI on `283075f` (§5); also run locally against an Alembic-built database |
| 2a | Secret scan | ✅ gitleaks over the full history (CI) and on every commit (pre-commit) | CI job "Secret scan" |
| 2b | Code scan (Semgrep: default, TypeScript, Python, secrets) | ✅ 5 findings, all false positives (constant SQL in a migration's downgrade; intended `IFS` handling in `deploy.sh`). 14 TSX files only partly parsed (literal `&` in page text) | `D:\VertexData\security-scans\release-20261011\semgrep.json` |
| 2c | Dependency scan | ✅ npm production: **0** (was 14, one critical). Python (`pip-audit`): **0** (was 9). ⚠ npm dev-only: 5 high in the ESLint chain, no fix exists (§3, E1) | `npm audit`, `pip-audit` |
| 2d | Image scan (Trivy, HIGH/CRITICAL) | ✅ backend 114 → **44, 0 fixable, 0 critical**; nextjs 11 → **0**; flutter-web 43 → patched base; minio 114 → **6, 0 fixable** (§3, E2) | `D:\VertexData\security-scans\release-20261011\trivy-*.json` |
| 3 | **Database permissions** | ✅ Role tests (`test_db_roles.py`). Live on staging: each service connects as its own role, the read-only role can't see secrets, personal data or the audit trail, the audit trail is append-only and its triggers can't be disabled, FastAPI can't read it | `verify-stack.sh staging`: 52/52 |
| 4 | **Authentication, authorization, cross-user access** | ✅ Route-guard coverage of every handler (CI-enforced), cross-user access tests, JWT purpose/audience matrix, denial auditing. Live on dev: admin 200 on the formerly broken endpoints; candidate 403 on admin routes and another user's case (both audited); no session → 401 | CI; smoke test 2026-10-12 |
| 5 | **DAST (OWASP ZAP) against staging** | ✅ Retest on the candidate: no injection, XSS, traversal, access-control or session findings. The last three 500s were fixed in `283075f`. Remaining CSP-related alerts are assessed (§3, E3) | [dast-zap.md §5](dast-zap.md) |
| 6 | **Uploads, downloads, admin operations** | ✅ Upload type/size/name tests, malware tests, document-access tests. Live: EICAR upload → 422 and audited; signed links audited; admin endpoints 200 | CI; live dev and staging |
| 7 | **Backup restored in a separate environment** | ✅ Restore drill of main's newest scheduled backup with the release images: exact counts (1,256 rows, 46 tables), migrated 0001 → 0004, `alembic check` clean, all 39 Prisma models read, no secrets: **PASSED in 33 s**. Real restore procedure tested on staging (44 s) | [backup-recovery.md §7](backup-recovery.md) |
| 8 | **All containers healthy** | ✅ dev and staging on the candidate, every container healthy | `verify-stack.sh` (dev: only red row is pgAdmin, switched on by the owner) |
| 9 | **Deployed through local CI/CD** | ✅ dev and staging deployed by the Deploy workflow. ⏳ main: after approval (§4) | §5 |

## 3. Exceptions (need the owner's approval)

Since 2026-10-12, these are handled under the owner's implementation plan. Fixes, acceptance conditions with evidence, and the **register (signed off by the owner, 2026-10-12)** are in [exceptions.md](exceptions.md).

| ID | Exception | Decision | Status (2026-10-12) |
|---|---|---|---|
| E1 | 5 high advisories in the ESLint toolchain (`braces`), dev-only, no fix | Accept with conditions | All conditions in place; CI and the image build enforce them |
| E2 | MinIO: 6 advisories in its last community release | Accept with conditions | No ports, internal network only, unique credentials. vertex-main holds 0 documents today (hourly guard). **Expiry 2027-01-10, or the first real document on main** |
| E3 | CSP allowed `'unsafe-inline'` for scripts | **Fix** | Nonce policy built (report-only first, then `CSP_MODE=enforce`); verified in Chromium ([csp.md](csp.md)) |
| E4 | Backend image: 44 Debian findings, none fixable | Accept with conditions | 0 KEV matches, none reachable, backend now non-root, weekly rebuild and scan, CI fails on fixable HIGH/CRITICAL |
| E5 | Backups only on D: | **Fix** | Off-site immutable copy built and rehearsed; needs the owner's bucket and the first real off-site restore ([backup-recovery.md](backup-recovery.md) §9) |
| E6 | Sessions not revocable (G19) | **Fix** | Done: revocable sessions, 15-minute access tokens ([session-management.md](session-management.md)) |

These fixes are **not part of this release** (`283075f`). They follow in the next release from `dev`.

## 4. Release steps

1. **Before:** fresh backup of main. **Done 2026-10-12:** `vertex-main/20261012T125230Z`, restore-drilled with the release images: PASSED (1,256 rows, 0001 → 0004, all 39 models).
   ```sh
   bash deploy/backup/backup.sh vertex-main .env.main
   ```
   Note the directory it prints: it is the rollback point.
2. **Merge** the pull request `dev` → `main` (owner).
3. **Deploy:** GitHub → Actions → **Deploy** → *Run workflow* on `main` (owner). Do not push `main` directly; Vercel Git deploys are off.
4. **Watch** the backend start. It runs `alembic upgrade head`: `0001` → `0004`. The `CasePayment.type` backfill aborts the start if any payment can't be mapped. The rehearsal on main's data mapped all 80.
5. **Verify:**
   ```sh
   bash deploy/verify-stack.sh main
   ```
   Every row must be ✅ (pgAdmin off). Then sign in as an admin and open a case, the payments list and the partner candidates.
6. **Note** the result in this document (§6).

## 5. Evidence: commits and CI

| Stack | Commit | CI | Deploy |
|---|---|---|---|
| dev | `283075f` | [CI 38182179972](https://github.com/BrookTeferi/Vertex/actions/runs/38182179972) ✅ | [Deploy 38182177134](https://github.com/BrookTeferi/Vertex/actions/runs/38182177134) ✅ |
| staging | `283075f` | [CI 38183729774](https://github.com/BrookTeferi/Vertex/actions/runs/38183729774) ✅ | [Deploy 38183727788](https://github.com/BrookTeferi/Vertex/actions/runs/38183727788) ✅ |

**Stack verification on `283075f`:**

| Stack | Result |
|---|---|
| staging | **52/52** |
| dev | **49**, plus 2 red rows that are only the owner's pgAdmin being switched on |

The live checks also covered `PUT`/`DELETE /api/jobs/<unknown>` and `PUT /api/candidates/profile` without a profile: all return 404.

**Operational note.** After the dev deploy, Docker Desktop once failed to bind the backend's published port (8001). The container was healthy inside, so only `verify-stack.sh` caught it. Restarting the container fixed it. Step 5 of the release (`verify-stack.sh main`) is what catches this on main.

The merge also carries this checklist (documentation only). The code released is `283075f`.

## 6. Rollback

The release changes the schema, so rolling back is **schema first, then images**. The old backend can't start on revision `0004`.

**A. Downgrade (keeps all data entered before and after the release):**

1. With the **new** backend still running:
   ```sh
   docker exec vertex-main-backend-1 alembic downgrade 0001
   ```
   Tested on a copy of main's data: 0004 → 0001 kept all 80 payments, and 0001 → 0004 worked again.
2. Redeploy the previous images, which are still in GHCR (from `vertex_be/`):
   ```sh
   ENV_FILE=.env.main bash deploy/deploy.sh vertex-main main-4a55ab8e1273c5c6455d8bc4b3e1d96b7d7ab076
   ```
3. Run `verify-stack.sh main`.
4. Afterwards, revert the merge on `main` with a PR, so that the branch matches what runs.

The downgrade **refuses** if payments were created after the release (they have no payment stage). In that case use B.

**B. Restore the pre-release backup** (loses changes made after the release):
```sh
bash deploy/backup/restore.sh vertex-main <dir from step 1> --yes-replace-vertex-main
```
Then deploy `4a55ab8` as in A.2. `restore.sh` takes its own safety backup first. Tested on staging.

## 7. Owner actions outside this release

- **Escrow the backup key:**
  ```sh
  powershell -File vertex_be\deploy\backup\backup-key.ps1 escrow
  ```
  Store the value in a password manager.
- **Rotate the dev `vertex_api` database password.** It was printed into a working session once: change `DB_API_PASSWORD` in `.env.dev`, and the next dev deploy applies it.
- ~~Decide on the two old unencrypted dumps.~~ **Done 2026-10-12.** Encrypted with the backup key into `D:\VertexData\backups\legacy\pre-migration-dumps-20261010.tar.gpg` (decryption verified, SHA-256 identical); the plaintext folders were deleted.

## 8. Phase 13 handover (deferred until production access)

| Phase 13 item | What exists now | Still to do on production |
|---|---|---|
| 1. Ownership and architecture | [trust-boundaries.md](trust-boundaries.md), [authorization-pipeline.md](authorization-pipeline.md) | Confirm owner, hosting provider, network layout |
| 2. Database provider and connection path | Least-privilege roles (`db-roles.sql`), migrations via Alembic only | Choose the managed Postgres; roles over TLS; no superuser for apps |
| 3. Separate secrets | Every secret comes from the environment; none in Git (CI-enforced) | Generate fresh production secrets in the provider's secret store; nothing copied from these PCs |
| 4. Deployment and rollback runbook | This checklist (§4, §6) | Adapt to the production deploy mechanism |
| 5. Backups and restore | Encrypted backups, drill and `restore.sh` | Managed backups + off-site copy; run the drill against production backups |
| 6. Network, TLS, monitoring, alerting | Structured logs, request IDs, alert rules and email | TLS termination, log shipping (e.g. CloudWatch), alert email to a monitored inbox |
| 7. Pre-deployment security review | ZAP, Semgrep, Trivy, dependency scans: all scripted | Authorized review against the production setup |
| 8. Approval and rollback plan | This document's structure | Explicit sign-off before the first production deploy |

## 9. Second release: sessions, CSP, off-site backups (2026-10-13)

| | |
|---|---|
| **Merged to `main`** | PR #8 (`security/csp-nonce`, includes everything in PR #5), PR #9 (Next.js image fix), PR #10. `main` = `3ba47af` |
| **Database** | vertex-main migrates `0001` → `0005` on backend start (`0004` drift fix, `0005` sessions) |
| **Effect on users** | Everyone signs in once after the deploy (older tokens carry no session) |

| Check | Result |
|---|---|
| dev on `a378352` | `verify-stack.sh dev`: 51 ✅; only red rows: owner's pgAdmin. Migrated `0004` → `0005` |
| staging on `a378352` | `verify-stack.sh staging`: **54/54** |
| Kill switch on staging | Session ended, same cookies → 401, refresh → 401, audit row with reason, new sign-in works ([session-management.md](session-management.md) §7) |
| Defect found on dev | `next start` crashed: the image lacked `src/lib/csp.ts`, imported by `next.config.ts`. Fixed in `a378352` with a CI test; would have taken main down |
| Fresh backup of main | `vertex-main/20261013T044556Z`: 1,256 rows, 46 tables, 0 documents |
| Restore drill, release images (`a378352`) | **PASSED in 26 s**: `0001` → `0005`, `alembic check` clean, all 40 Prisma models read, no secrets |
| 0005 rollback on main's data | 0005 → 0004 → 0001 → head, 1,255 rows at every step |
| CI on `3ba47af` | ❌ All 8 jobs failed within 1–2 s (runner not started: GitHub Actions minutes or spending limit, not code). Re-run once restored |
| Deploy on `main` | ⏳ Owner, after CI is green |
| `verify-stack.sh main` | ⏳ Agent, after the deploy. Every row must pass with pgAdmin off, including the G19 rows |

**Rollback.** `docker exec vertex-main-backend-1 alembic downgrade 0001`, then redeploy `main-4a55ab8…` (§6 A). Or restore `20261013T044556Z` (§6 B). Rolling back 0005 only signs everyone out.
