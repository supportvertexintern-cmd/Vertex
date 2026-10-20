# Security exceptions: fixes, acceptance conditions and register

This document implements the owner's plan "Vertex Security Exceptions – Implementation Plan" (2026-10-12):
- **E6, E3 and E5** are fixed or being fixed.
- **E1, E2 and E4** stay open as exceptions, and only with the conditions below in place and checked.

The register in §4 is what [release-checklist.md](release-checklist.md) §3 asks the owner to sign.

## 1. Status of the fixes

| ID | Fix | Status | Detail |
|---|---|---|---|
| E6 | Revocable sessions (G19) | **Closed 2026-10-13.** Live on dev, staging and **main** (`verify-stack.sh main` 54/54, G19 rows pass); kill switch tested on staging | [session-management.md](session-management.md) |
| E3 | CSP nonces, no `'unsafe-inline'` for scripts | **Report-only since 2026-10-13 on dev and staging.** Enforce after 1–2 weeks of clean reports, by 2026-11-09 | [csp.md](csp.md) §4 |
| E5 | Off-site, immutable copy | **Built and rehearsed.** Waiting for the owner's bucket and keys and the first real off-site restore | [backup-recovery.md](backup-recovery.md) §9 |

## 2. Acceptance conditions, checked 2026-10-12

### E1: ESLint advisory (`braces`, via `eslint-config-next`), no fix released

| Condition | Result | Evidence |
|---|---|---|
| Dev-only: `npm ls --omit=dev` doesn't list it | ✅ production tree has no `braces`; full tree has it only via `eslint-config-next` → `@next/eslint-plugin-next` → `fast-glob` → `micromatch` | `npm ls braces [--omit=dev]` |
| Production images install without dev dependencies | ✅ The image builds with dev tools, then `npm prune --omit=dev` before `node_modules` is copied into the runtime image (equivalent to `npm ci --omit=dev`). **The build now fails if `braces` is in the shipped `node_modules`** | `vertex/Dockerfile` |
| CI that lints untrusted pull requests has no deploy secrets | ✅ CI (`ci.yml`) runs on GitHub-hosted runners with `GITHUB_TOKEN` only (`contents: read`, `packages: read`). Deploys are a separate, manually dispatched workflow on the self-hosted runner | `.github/workflows/ci.yml` |
| Re-checked whenever the lockfile changes | ✅ New CI step "Production dependencies (E1)" on every pull request: `npm audit --omit=dev --audit-level=high` must pass, and `braces` must not be a production dependency | `ci.yml` |
| Close when a fix ships | Open. `npm audit` shows it until then | — |

### E2: MinIO advisories (last community release), retired by the move to S3

| Condition | Result | Evidence |
|---|---|---|
| Dev/staging only, no real candidate data | ⚠ **Partly.** MinIO also runs in **vertex-main**, the local stack that holds real data. Today it stores **0 documents**: the newest main backup has 0 objects and 0 `Document` rows, against 46 candidates. The first document uploaded on main breaks this condition | backup manifest of vertex-main, 2026-10-12 |
| No published ports; internal Docker network only | ✅ dev, staging and main MinIO publish no port and sit only on the stack's internal `data` network. The only MinIO with a port is the end-to-end test instance on `127.0.0.1:9311`, which holds test data only | `docker ps`; `verify-stack.sh` |
| Unique, non-default root credentials in secrets, not compose files | ✅ Compose requires them from the env file (`${MINIO_ROOT_PASSWORD:?}`). Each stack has a different 40-character password, none default. Compared by hash only; nothing printed | env files (not in Git) |
| Expiry = S3 production cutover date; MinIO removed that day | ✅ Set (§4): **2027-01-10, or the first real document on vertex-main, whichever comes first**. The hourly health check alerts on that first document | `backup-health.sh` |

**Recommendation for main.** Either move vertex-main's documents to S3 before anyone uploads a real document there, or explicitly accept MinIO on main until the cutover. The exposure is limited: no port, internal network only, and the vulnerable features (OIDC, LDAP) are not configured.

### E4: Debian base-image findings, no fix released

Fresh scan on 2026-10-12: backend image `dev-56de2b9`, Debian 13.7, Trivy 0.67.2.

| Condition | Result |
|---|---|
| No finding in CISA's Known Exploited Vulnerabilities catalog (2026.10.08, 1,739 entries) | ✅ **0 matches** in any image (backend 44, MinIO 6, Next.js 0, Flutter 0 HIGH/CRITICAL) |
| Whether the app uses each vulnerable package | Recorded below: none is reachable |
| Slim or distroless base | ✅ `python:3.11-slim`. **Distroless was tried and rejected:** `distroless/python3-debian12` scanned **62** findings, **43 of them fixable but not yet patched there**, 2 critical, against 44 / 0 fixable / 0 critical for slim. It is older (Debian 12) and patched more slowly |
| Weekly rebuild and re-scan | ✅ `.github/workflows/image-scan.yml`: Mondays, all four images built with `--pull --no-cache` (fresh bases; the Dockerfiles apply the distribution's current fixes); reports kept 90 days |
| Fail the build on new fixable CRITICAL/HIGH | ✅ `trivy --ignore-unfixed --severity CRITICAL,HIGH --exit-code 1`: in CI (backend, Next.js, Flutter) on every promotion into `staging` or `main` and on pull requests into `dev` that change a Dockerfile, compose file or workflow (from 2026-10-20, to save Actions minutes; everything reaches `staging` through a scanned promotion), and in the weekly job (all four, MinIO included) |
| Extra: backend runs as non-root | ✅ New: user `vertex` (uid 10001). Tested: migrates to head on start, healthy, `alembic` still usable for rollback |

**Backend findings and whether the app reaches them:**

| Package(s) | CVE | What it is | Used by the app? |
|---|---|---|---|
| util-linux, mount, login, bsdutils, libmount1, libblkid1, libsmartcols1, liblastlog2-2, libuuid1 | CVE-2026-76642, -78408, -78409, -78410 | `mount` helper post-hooks, `nsenter --join-cgroup`, `X-mount.subdir` and restricted bind mounts: local privilege escalation through the mount and nsenter tools | **No.** The service never runs mount or nsenter, and it now runs as non-root. `libuuid` is loaded (Python's `_uuid`), but the app only calls `uuid4()`, which uses `os.urandom`, not libuuid; the flaws are in the tools anyway |
| libacl1 | CVE-2026-54369 | symlink traversal in libacl's path functions | **No.** No ACL calls |
| libncursesw6, libtinfo6, ncurses-base, ncurses-bin | CVE-2025-69720 | buffer overflow in the `infocmp` tool | **No.** The app never loads curses or readline (checked: not in `sys.modules`) |
| libsystemd0, libudev1 | CVE-2026-16742 | systemd-homed local privilege escalation | **No.** There is no systemd in the container |
| perl-base | CVE-2026-9538 | Archive::Tar denial of service | **No.** The app has no Perl |

**MinIO (6):** in MinIO's own code. The 2 critical ones are in OIDC and LDAP, neither configured; the 4 high ones include unsigned-trailer uploads. The compensating controls are E2's.

## 3. Evidence files

- `D:\VertexData\security-scans\e4-20261012\trivy-{backend,nextjs,flutter-web,minio}.json`: today's scans.
- `D:\VertexData\security-scans\e4-20261012\trivy-backend-distroless.json`: the rejected distroless trial.
- `D:\VertexData\security-scans\kev-20261012\known_exploited_vulnerabilities.json`: the KEV catalog used.

## 4. Exception register (signed off 2026-10-12)

Every open exception needs a named owner, a compensating control and an expiry date. **The accountable risk owner signs, not the implementer.**

| ID | Decision | Compensating control | Owner | Expiry / review | Signed off by |
|---|---|---|---|---|---|
| E6 | Fix: blocks Phase 2 close | Fixed in code: 15-min access tokens, per-request session check, kill switch. **Closed 2026-10-13:** deployed to main (by hand, release-checklist §9), `verify-stack.sh main` passes the G19 rows | Brook | 2026-10-26 (met 2026-10-13) | Brook, 2026-10-12 |
| E3 | Fix | Report-only nonce policy running; no `'unsafe-eval'`; CI regression test | Brook | Enforce 2 weeks after report-only starts on staging; latest 2026-11-09 | Brook, 2026-10-12 |
| E5 | Fix | Local encrypted D: copy, hourly health alerts, monthly drills, until the off-site copy lands | Brook | 2026-11-12 (bucket + first off-site restore) | Brook, 2026-10-12 |
| E1 | Accept | Dev-only, never shipped (build and CI enforce it); re-checked on every lockfile change | Brook | 2027-01-10, or earlier when a fix ships | Brook, 2026-10-12 |
| E2 | Accept | Non-production use, internal network only, unique credentials; vertex-main holds 0 documents (hourly guard alerts on the first one) | Brook | **2027-01-10, or the first real document stored on vertex-main, whichever comes first.** The S3 cutover must happen before then | Brook, 2026-10-12 |
| E4 | Accept | No KEV matches; none reachable by the app; backend non-root; weekly rebuild and scan; CI fails on fixable HIGH/CRITICAL | Brook | 2027-01-10 | Brook, 2026-10-12 |
| E7 | Accept, temporarily | CVE-2026-77214 (HIGH, libexpat 2.8.5-r0 in the `nginx:1.29-alpine` base of vertex-flutter-web). Fixed in 2.9.0-r0, not yet published for this Alpine base, so `apk upgrade` can't apply it. That nginx serves static files only, with no XSLT, DAV or other XML module configured. Ignored by the CI and weekly gates through `.trivyignore.yaml` only; the weekly full report still lists it | Brook | **2026-11-02.** The ignore entry expires that day and the gates fail again. Remove it as soon as the weekly rebuild picks up 2.9.0-r0 | Brook, 2026-10-19 |

Sign-off: the owner (Brook) approved this register in the working session on 2026-10-12. The implementer (Claude) recorded it. Each row is reviewed by its date; an exception that passes its date without a review is treated as a failed release check.

**E2 expiry:** the S3 cutover date wasn't fixed yet, so the owner chose the recommended rule. That rule is a 90-day review, brought forward by the first real document on vertex-main. `backup-health.sh` checks it every hour.

