# Phase 2 verification: vertex-dev and vertex-staging (Step 13)

Recorded 2026-10-09 11:59 UTC. Both stacks run the same commit, deployed by CI
through the self-hosted runner, and were checked **as separate environments**
with `vertex_be/deploy/verify-stack.sh` (re-run it to reproduce):

| Environment | Branch | Commit | Images |
|---|---|---|---|
| vertex-dev | `dev` | `19db922a5332cbfd7e5eac86b09461a718a684c4` | `*:dev-19db922…` |
| vertex-staging | `staging` | `19db922a5332cbfd7e5eac86b09461a718a684c4` | `*:staging-19db922…` |

The commit includes every Phase 2 fix so far: G1, G2, G3, G6, G10, G11,
G12, G15, G16, G17, the internal database network, the audit-log
carve-outs and the `vertex_readonly` column allowlist.

**Result: 68 of 68 checks pass** (30 per environment, 8 secret comparisons).

## What the checks prove

- **Exposure:** every app port answers on `127.0.0.1` and **not** on the
  PC's LAN address; Postgres is not published; pgAdmin is off unless started
  on demand (`deploy/pgadmin.sh`), and then logs in as `vertex_readonly`.
- **Network:** the `data` network is internal; the database can't reach the
  internet; Flutter can't reach the database; every container is on exactly
  the networks the compose file gives it.
- **Least privilege:** the apps connect as `vertex_api` / `vertex_web`, never
  the superuser; `vertex_readonly` reads allowlisted columns only (not
  `password_hash`, not `email`, not `AuditLog`); the app roles can't alter or
  truncate the audit log or create tables.
- **Application:** G1/G2 admin reads need a login; drafts aren't public
  (G11); auth flows are rate-limited (G10); an anonymous upload token is not
  a session, and neither is a token signed the pre-G17 way (G17).
- **Isolation:** all eight secrets differ between dev and staging (compared
  by SHA-256 fingerprint; values never printed).

"Next.js → internet" is best of three: this PC's internet link drops
intermittently (it also failed one deploy's `actions/checkout` download).

### vertex-dev

| Check | Result | |
|---|---|---|
| App images | `dev-19db922 ` | |
| Containers not healthy | 0 | ✅ |
| Port 8001 from localhost | 200 | ✅ |
| Port 8001 from the LAN | 000 | ✅ |
| Port 3001 from localhost | 200 | ✅ |
| Port 3001 from the LAN | 000 | ✅ |
| Port 8081 from localhost | 200 | ✅ |
| Port 8081 from the LAN | 000 | ✅ |
| Postgres published to host | 0 | ✅ |
| pgAdmin running (off by default) | 0 | ✅ |
| `data` network internal | true | ✅ |
| Database container → internet | no | ✅ |
| Next.js → database | yes | ✅ |
| Next.js → internet (best of 3) | yes | ✅ |
| Flutter → database | no | ✅ |
| Containers missing a network | 0 | ✅ |
| Backend connects as | vertex_api | ✅ |
| Next.js connects as | vertex_web | ✅ |
| vertex_readonly: SELECT id FROM User | allowed | ✅ |
| vertex_readonly: SELECT password_hash | permission denied | ✅ |
| vertex_readonly: SELECT email (personal data) | permission denied | ✅ |
| vertex_readonly: read AuditLog | permission denied | ✅ |
| vertex_web: UPDATE AuditLog | permission denied | ✅ |
| vertex_web: TRUNCATE AuditLog | permission denied | ✅ |
| vertex_api: CREATE TABLE | permission denied | ✅ |
| GET /api/admin/emails, no login (G1) | 401 | ✅ |
| GET /api/admin/knowledge, no login (G2) | 401 | ✅ |
| Upload token used as a session (G17) | 401 | ✅ |
| Pre-G17 single-key session token (G17) | 401 | ✅ |
| Draft job via API (G11) | 404 | ✅ |
| 6th forgot-password from one client (G10) | 429 | ✅ |

### vertex-staging

| Check | Result | |
|---|---|---|
| App images | `staging-19db922 ` | |
| Containers not healthy | 0 | ✅ |
| Port 8002 from localhost | 200 | ✅ |
| Port 8002 from the LAN | 000 | ✅ |
| Port 3002 from localhost | 200 | ✅ |
| Port 3002 from the LAN | 000 | ✅ |
| Port 8082 from localhost | 200 | ✅ |
| Port 8082 from the LAN | 000 | ✅ |
| Postgres published to host | 0 | ✅ |
| pgAdmin running (off by default) | 0 | ✅ |
| `data` network internal | true | ✅ |
| Database container → internet | no | ✅ |
| Next.js → database | yes | ✅ |
| Next.js → internet (best of 3) | yes | ✅ |
| Flutter → database | no | ✅ |
| Containers missing a network | 0 | ✅ |
| Backend connects as | vertex_api | ✅ |
| Next.js connects as | vertex_web | ✅ |
| vertex_readonly: SELECT id FROM User | allowed | ✅ |
| vertex_readonly: SELECT password_hash | permission denied | ✅ |
| vertex_readonly: SELECT email (personal data) | permission denied | ✅ |
| vertex_readonly: read AuditLog | permission denied | ✅ |
| vertex_web: UPDATE AuditLog | permission denied | ✅ |
| vertex_web: TRUNCATE AuditLog | permission denied | ✅ |
| vertex_api: CREATE TABLE | permission denied | ✅ |
| GET /api/admin/emails, no login (G1) | 401 | ✅ |
| GET /api/admin/knowledge, no login (G2) | 401 | ✅ |
| Upload token used as a session (G17) | 401 | ✅ |
| Pre-G17 single-key session token (G17) | 401 | ✅ |
| Draft job via API (G11) | 404 | ✅ |
| 6th forgot-password from one client (G10) | 429 | ✅ |

### Secrets: dev vs staging (compared by SHA-256 fingerprint; values never printed)

| Secret | Result | |
|---|---|---|
| `POSTGRES_PASSWORD` | different | ✅ |
| `DB_MIGRATOR_PASSWORD` | different | ✅ |
| `DB_API_PASSWORD` | different | ✅ |
| `DB_WEB_PASSWORD` | different | ✅ |
| `DB_READONLY_PASSWORD` | different | ✅ |
| `SECRET_KEY` | different | ✅ |
| `JWT_SECRET` | different | ✅ |
| `PGADMIN_PASSWORD` | different | ✅ |

## Found while verifying

- **Deploy could leave the backend down.** Compose 2.19 attached the
  recreated backend to `edge` only; it couldn't resolve `db` and crash-looped
  in migrations, before the end-of-deploy network repair ran. `deploy.sh` now
  repairs attachments after every stage (fixed in `19db922`, exercised by
  both deploys above).
- **The scratch version of this check could pass falsely:** if the network
  comparison itself crashed, the row read `0`. The committed script fails
  closed ("check failed"), proven by breaking the comparison on purpose.
