# Trust boundaries: request paths in the actual system

Phase 2, Step 3. Recorded 2026-10-10 from the code at `dev` (after `b513e5c`)
and the running vertex-dev and vertex-staging stacks. Every path below was
traced in code; paths that don't exist are marked **N/A** rather than
assumed. Gaps found while mapping are numbered G20 onward (continuing
[phase2-baseline.md](phase2-baseline.md)).

## 1. System diagram

```text
  ┌──────────────────────── Internet ───────────────────────────────────────────┐
  │  Google OAuth   Stripe (API + webhook)   PayPal   SMTP   Gemini   Cloudflare R2  GHCR / GitHub │
  └──────▲──────────────▲──────│──────────────▲───────▲────────▲─────────▲──────────▲─────────────┘
         │ outbound     │      │ inbound      │       │        │         │          │ pull (runner)
         │ from Next.js │      │ webhook      │       │        │         │          │
  ═══════╪══════════════╪══════╪══════════════╪═══════╪════════╪═════════╪══════════╪═══ this PC ═══
         │              │      ▼              │       │        │         │          │
  Browser ──127.0.0.1:3001/3002──►  ┌───────────────────────────────────────┐   GitHub Actions runner
  (LAN: blocked, G15)               │ Next.js (node user)  pages + 112 API   │   (vertex-pc, Git Bash)
                                    │ cookie auth_token, proxy.ts, guards    │      │ deploy.sh
  Browser ──127.0.0.1:8081/8082──►  │                                        │      │ (superuser via
     Flutter web (nginx) ── static  └───────────────│───────────────────────┘      │  docker exec psql)
     no HTTP calls, own network            vertex_web│ (Prisma)                     │
                                                    ▼                              ▼
  Browser ──127.0.0.1:8001/8002──►  FastAPI ──vertex_api──►  ┌──────────────────────────────┐
     /, /api/v1/health, /docs       (startup: alembic as     │ PostgreSQL 15 (one per stack)│
     no auth, no data               vertex_migrator)         │ network `data`: internal     │
                                                             └──────────────▲───────────────┘
  pgAdmin (on demand, 127.0.0.1:5050/5151) ──vertex_readonly (column allowlist)┘

  Networks per stack: data (internal: db, backend, nextjs, pgadmin) · edge (ports + egress:
  backend, nextjs, pgadmin) · static (flutter-web only). dev and staging share nothing.

  Separately (not on this PC): Vercel project `vertex` → public vertex-self-pi.vercel.app,
  same Next.js code, Prisma Postgres at db.prisma.io as a superuser login (see §3, P5b).
```

There is **no** call between application services: Next.js never calls
FastAPI, FastAPI calls nothing, Flutter calls nothing. The only thing
Next.js and FastAPI share is the database, each through its own role.

## 2. Summary

| # | Path | Exists? |
|---|---|---|
| P1 | Browser → Next.js | ✅ the only real application path |
| P2 | Next.js server → FastAPI | **N/A**: no code calls FastAPI |
| P3 | Browser / mobile → FastAPI | Only `/`, `/api/v1/health`, `/docs`; no data, no auth. Flutter: **N/A** (its `ApiService` is never constructed) |
| P4 | FastAPI → PostgreSQL | ✅ `vertex_api` (runtime), `vertex_migrator` (startup migrations) |
| P5 | Next.js/Prisma → PostgreSQL | ✅ `vertex_web`; on Vercel, a superuser login (P5b) |
| P6 | Background workers → databases / APIs | **N/A**: no scheduler, queue or cron; reminders are manual by design. The only timer is the in-memory rate-limit sweep |
| P7 | Administrative tools → protected endpoints | ✅ admin API routes (P1), pgAdmin, `psql` via `docker exec` |
| P8 | File storage (upload, download, delete) | ✅ Next.js → Cloudflare R2 |
| P9 | CI/CD → deployment and migrations | ✅ GitHub Actions + self-hosted runner; Vercel Git deploys now off |
| P10 | Third parties ↔ Next.js | ✅ Stripe webhook in; Google OAuth, Stripe, PayPal, SMTP, Gemini out |

## 3. Paths in detail

### P1 Browser → Next.js

| | |
|---|---|
| Caller → receiver | Browser → Next.js container (`vertex-<env>-nextjs-1`) or Vercel |
| Identity | Session JWT in cookie `auth_token` (`httpOnly`, `sameSite=strict`, `secure` in production), HS256, 7 days, audience `vertex:session` (G17). Anonymous for the 18 public endpoints in `lib/public-endpoints.ts` |
| Authentication | Pages: `src/proxy.ts` (redirect to login). API: `getAuthUser` in each handler (`lib/api-auth.ts`); token verified with the session key only |
| Authorization | Per handler: `requireRole`/`requireAdmin` (role from the token), then record checks (`canAccessCandidate`, `canAccessCase`, scope filters). Default deny enforced by `route-guards.test.ts` |
| Secrets | `JWT_SECRET` (per-purpose keys derived from it) |
| Network exposure | `127.0.0.1:3001` (dev), `:3002` (staging); not the LAN (G15). Vercel: public internet |
| Audit | Data writes through `auditedPrisma` (who, what, before/after); bulk exports via `auditAccess` (G16). **Not audited: logins, failed logins, logouts, denials (G7, G20), document views (G21)** |
| Failure behavior | Missing/invalid/expired/wrong-purpose token → `null` user → 401/403 or redirect: fails closed. Missing `JWT_SECRET` → every verify fails (closed). Rate limits are per process and reset on restart (G5); keyed on `X-Forwarded-For` (G14) |
| Known limits | Role comes from the token; demotion, deletion and password change take effect only at expiry (G19) |

### P2 Next.js server → FastAPI — N/A

No code in `vertex/src` references FastAPI, its port or `/api/v1`. When one
is added it must use a service credential (G18, policy §6): issuer,
audience, expiry and scope checked on every call.

### P3 Browser / mobile → FastAPI

| | |
|---|---|
| Caller → receiver | Browser (or anything that can reach the port) → FastAPI. Flutter app: **N/A** |
| Identity | None |
| Authentication / authorization | None. Endpoints: `/`, `/api/v1/health` (runs `SELECT 1`, reports environment and version), `/docs`, `/redoc`, `/api/v1/openapi.json` |
| Secrets | None used for requests (`SECRET_KEY` loaded, unused) |
| Network exposure | `127.0.0.1:8001` / `:8002`. CORS allows `localhost:3000` and `:8080` with credentials |
| Audit | None |
| Failure behavior | Database down → health returns 503 `degraded`; no data at risk |
| Note | Acceptable only while FastAPI serves no data (G9, G18). Docs must be disabled in production |

### P4 FastAPI → PostgreSQL

| | |
|---|---|
| Identity | Runtime: `vertex_api` (DML on rows, no DDL, can't alter/truncate `AuditLog`, no access to `alembic_version`). Startup: `vertex_migrator` runs `alembic upgrade head` (owns the schema, no superuser) |
| Authentication | Postgres password (scram), separate per role and per environment |
| Authorization | Grants in `deploy/db-roles.sql`; audit-log triggers block UPDATE/DELETE even for the owner |
| Secrets | `DB_API_PASSWORD`, `DB_MIGRATOR_PASSWORD` (in `.env.<env>` on this PC, passed as `DATABASE_URL` / `MIGRATION_DATABASE_URL`) |
| Network exposure | `data` network only (internal: no internet, not published to the host) |
| Audit | Migrations recorded in `alembic_version`; no per-query audit (FastAPI writes no data yet) |
| Failure behavior | Migration fails → container exits → deploy fails before traffic moves. DB down at runtime → 503 health |

### P5 Next.js / Prisma → PostgreSQL

| | |
|---|---|
| Identity | `vertex_web` (same limits as `vertex_api`, separate password) |
| Authentication / authorization | As P4 |
| Secrets | `DB_WEB_PASSWORD` |
| Network exposure | `data` network only |
| Audit | `auditedPrisma` writes `AuditLog` rows for data changes; **plain `prisma` writes are not audited** (G22) |
| Failure behavior | DB unreachable → Prisma error → 500; no fallback, no stale data served |

**P5b (Vercel):** the same code at `vertex-self-pi.vercel.app` connects to
Prisma Postgres (`db.prisma.io:5432`, SSL, internet-reachable) with the
database's generated login, which is a **superuser**. No Phase 1 roles.
Preview and Development share the same URL (previews are now off). Its
`public` schema had no tables when checked (2026-10-10). Tracked in the
incident section of [phase2-verification.md](phase2-verification.md).

### P6 Background workers — N/A

No scheduler, queue, cron or worker exists (no `vercel.json` crons, no
Celery/RQ, no job tables). Follow-ups such as case reminders are triggered
by staff through P1 (`cases/[id]/remind`). The only timer is
`setInterval` in `lib/rate-limit.ts`, which prunes in-memory counters.

### P7 Administrative tools

| Tool | Identity | Enforcement | Exposure | Audit | Failure |
|---|---|---|---|---|---|
| Admin API routes (`/api/admin/**`) | Session (P1) | `requireAdmin` / `requireRole`; never public (route-guards test) | As P1 | Writes via `auditedPrisma`; exports via `auditAccess` | 401/403 |
| pgAdmin | `PGADMIN_EMAIL`/`PASSWORD` to the UI, then `vertex_readonly` to the DB | Column allowlist (`readonly-columns.sql`): no secrets, no personal data, no `AuditLog`; read only | Off by default; `127.0.0.1:5050` / `:5151` when started with `deploy/pgadmin.sh` | Postgres logs only | Unclassified columns stay hidden (default deny) |
| `psql` as superuser | `POSTGRES_USER` via `docker exec` (local socket) | Docker access on this PC | Not network-reachable | None | n/a |

Whoever can run `docker` on this PC is effectively root over both stacks.
That is the human administrator and the runner (P9), nobody else.

### P8 File storage (MinIO locally; S3 API)

**Update 2026-10-10:** the local stacks now store documents in their own
MinIO (`vertex_be/deploy/README.md`, "Object storage"), not Cloudflare R2.
Next.js uses a per-environment app key limited by policy to one bucket;
MinIO is only on the internal `data` network, with no published port.
`verify-stack.sh` checks that the key can read, write and delete in its
bucket and cannot list other buckets, create or delete buckets, make its
bucket public or use the admin API. The table below still describes the
request flow, which is unchanged; read "R2" as "the configured S3 store".


| Operation | Caller → receiver | Identity | Authentication | Authorization | Audit | Failure |
|---|---|---|---|---|---|---|
| Upload `POST /api/upload` | Browser → Next.js → R2 | Session, or a CIF upload token (`X-Upload-Token`, 4 h, one candidate, G17 key) | Session or token verified | Ownership/role checks; MIME allowlist; size ≤ `MAX_FILE_SIZE_MB` (5 MB) | `Document` row via `auditedPrisma` | Storage not configured → error; invalid token → 401; wrong candidate → 403 |
| Download link `GET /api/documents/[id]/signed-url` | Browser → Next.js | Session | `getAuthUser` | Role + record scope | **None (G21)** | 401/403/404 |
| Download `GET /api/documents/file?token=` | Browser → Next.js → R2 | Document token (5 min, one storage path, G17 key) | Token verified | Possession of the token | **None (G21)** | Invalid/expired → 401; missing object → 404 |
| Delete (replacing a document) | Next.js → R2 | Server | Inside an authorized upload | As upload | DB change audited; the R2 delete itself isn't | Missing object ignored |

Secrets: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`,
`R2_BUCKET_NAME`. The key's scope (one bucket? read/write/delete?) is set in
Cloudflare and **not verified here**; it should be limited to this bucket.
Files are never public; every read goes through a signed, short-lived link.

### P9 CI/CD → deployment and migrations

| Stage | Identity | Can do | Secrets | Exposure | Audit | Failure |
|---|---|---|---|---|---|---|
| CI (`ci.yml`, GitHub-hosted) | `GITHUB_TOKEN`, `contents: read` | Read code; tests use throwaway trust-auth databases | None real | GitHub cloud | Actions logs | Any failed job blocks the deploy |
| Image build/push (`deploy.yml` build job) | `GITHUB_TOKEN`, `packages: write` | Push `ghcr.io/brookteferi/vertex-*` | — | GitHub cloud | Actions logs, GHCR | Push fails → no deploy |
| Deploy (self-hosted runner `vertex-pc`) | `GITHUB_TOKEN`, now **`packages: read`** (was write, fixed here); local Docker | Pull images, run `deploy.sh`: provision roles as superuser, start the stack, migrations as `vertex_migrator` | Reads `.env.<env>` from disk (all of that environment's secrets) | Outbound only (polls GitHub); no inbound port | Actions logs; GitHub environment `dev`/`staging` | `set -eu`, health waits, network repair after each stage; the job fails and reports, but containers already recreated stay on the new version, so a service can be left down (happened 2026-10-09; no automatic rollback) |
| Vercel | Vercel GitHub app | Built and deployed `main` to production, previews for other branches | Vercel env vars | Public | Vercel dashboard | **Off since 2026-10-10** (`git.deploymentEnabled: false`) |

Who can deploy: anyone who can push to `dev` or `staging`. The runner
account can read both environments' env files and control Docker, so it is
as privileged as the PC's user. `main` is guarded only by a local pre-push
hook (GitHub branch protection needs a paid plan for this private repo).

### P10 Third parties ↔ Next.js

| Path | Identity / check | Secrets | Audit | Failure |
|---|---|---|---|---|
| Stripe → `POST /api/webhooks/stripe` (inbound, public) | Stripe signature (`constructEvent`) | `STRIPE_WEBHOOK_SECRET` | **Payment status updates use plain `prisma`: not audited (G22)** | Bad signature → 400 |
| Next.js → Stripe API | API key | `STRIPE_SECRET_KEY` | Payment rows via handlers | Error → 500 |
| Next.js → PayPal (create/capture order) | Client credentials | `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` | **Capture writes via plain `prisma` (G22)** | Error → 4xx/5xx |
| Google → `GET /api/auth/google/callback` | OAuth code exchange; `state` is a validated same-site path (G12), not an anti-forgery value (G13) | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | **User creation/link via plain `prisma`; sign-in not audited (G20, G22)** | Error → redirect to login |
| Next.js → SMTP | SMTP login | `SMTP_*` | None | Logged, request continues (emails can be lost silently) |
| Next.js → Gemini (`/api/chat`, public, rate-limited) | API key | `GOOGLE_GENERATIVE_AI_API_KEY` (the AI SDK's default) | None | Error → 500 |

## 4. Gaps found while mapping

| # | Gap | Severity | Fix in |
|---|---|---|---|
| G20 | Authentication events aren't audited: successful and failed logins, Google sign-ins, logouts. A brute-force or account-takeover attempt leaves no trace in `AuditLog` | Medium | With G7 (Phase 5) |
| G21 | Viewing a document leaves no record: issuing a signed link (`documents/[id]/signed-url`) and downloading it aren't audited, though these are passports and CVs | Medium | Phase 2 candidate: `auditAccess(actor, "Document", "view", …)` on link issue |
| G22 | Some writes bypass the audited client: Stripe webhook payment updates, PayPal capture, Google sign-in user creation. Money and account changes with no audit row | Medium | Phase 2 candidate: switch to `auditedPrisma(null)` (system actor) |
| — | Deploy job's registry token could push images | Low | **Fixed here** (`packages: read` on the deploy job) |
| — | R2 key scope unverified | Unknown | Owner: check in Cloudflare that the key is limited to the one bucket |
