# Phase 2 baseline: security state before zero trust

Recorded 2026-10-09 on `dev` @ `f3b7093`, before any Phase 2 change. Every later
Phase 2 change is measured against this. Scope: local development and staging
only; production was not touched.

## 1. Baseline results

| Check | Result |
|---|---|
| Cleanup commit `88cca83` in `dev` | ✅ merged (`f3b7093`), deployed to vertex-dev by CI, runner job *Succeeded* |
| vertex-dev health | ✅ backend, Next.js, Flutter web, Postgres healthy; pgAdmin up |
| vertex-staging health | ✅ all services healthy, running `staging-b0b645b` |
| Dev/staging isolation | ✅ separate Docker networks and data volumes; dev containers cannot even resolve staging's database host |
| Application data | ✅ dev unchanged (15 users, 22 jobs); staging empty by design |
| Database roles (Phase 1) | ✅ backend connects as `vertex_api`, Next.js as `vertex_web`, in both stacks |
| Backend tests | ✅ 39 passed (incl. 33 database-role checks) |
| Next.js typecheck / tests | ✅ `tsc` clean; 113 passed against a seeded Postgres (R2 upload test excluded: needs real credentials) |
| Flutter tests | ✅ 6 passed |

## 2. Current architecture

```text
                 Browser
       ┌────────────┼──────────────┐
       ▼            ▼              ▼
  Flutter web    Next.js        FastAPI
  (nginx)        pages + 112    /api/v1/health only
  mock data,     API routes     no auth yet
  no API calls       │               │
                     │ vertex_web    │ vertex_api (+ vertex_migrator for Alembic)
                     ▼               ▼
              ┌──────── PostgreSQL (one database per stack) ────────┐
              │ superuser: humans only (pgAdmin, psql, deploy.sh)   │
              └─────────────────────────────────────────────────────┘
```

**Database topology:** in each stack, Next.js and FastAPI share **one database**
through **separate roles**. Sharing the database does not make the services
trust each other: each role is limited to row access (Phase 1), and neither
can see the other's credentials.

**Service-to-service calls:** none today. Next.js does not call FastAPI, and the
Flutter app makes no HTTP calls (`ApiService` is never constructed). The only
inter-service trust is the shared database, governed by the Phase 1 roles.

## 3. Existing security controls

**Next.js (the system that holds real users and data today)**

| Control | Where | Notes |
|---|---|---|
| JWT session in cookie `auth_token` | `lib/jwt.ts`, `api/auth/login` | HS256 pinned (blocks `alg:none`/confusion), `httpOnly`, `sameSite=strict`, `secure` in production |
| Page protection | `src/proxy.ts` | redirects unauthenticated users; `canAccessPortal` keeps each role in its own portal |
| Role checks per API handler | `lib/api-auth.ts` `requireRole`, plus inline checks | 120 of 155 handlers check a role (see appendix) |
| Record-level checks | `server/scope.ts` `canAccessCandidate`, `canAccessCase`; report scope filters | region/country/assignment scoping for candidates, cases, reports |
| Signed single-purpose tokens | `lib/jwt.ts` | email verification, password reset, document download, candidate invite, account setup, CIF upload |
| Private documents | `api/documents/[id]/signed-url` → `api/documents/file` | RBAC check, then a short-lived signed URL; files never public |
| Rate limiting | `lib/rate-limit.ts` | login, registration, contact, applications, intake, consultation checkout |
| Webhook verification | `api/webhooks/stripe` | Stripe signature (`constructEvent`) |
| Immutable audit log | Alembic baseline triggers + Phase 1 grants | UPDATE/DELETE blocked by trigger; TRUNCATE denied to app roles |

**FastAPI:** no authentication or authorization yet. It exposes only `/`,
`/api/v1/health`, `/docs`, `/redoc` and the OpenAPI schema, all public by design
for now (Phases 4–5 add auth; production must disable the docs).

**Platform:** least-privilege database roles, secret scanning in pre-commit
and CI, CI-built images, dev/staging isolation.

## 4. Gaps found

| # | Gap | Severity | Evidence | Fix in |
|---|---|---|---|---|
| G1 | `GET /api/admin/emails` has **no authentication**: anyone can list all email templates | High | handler reads `emailTemplate.findMany()` with no user check; its `PUT` requires admin | Phase 2 (quick fix) |
| G2 | `GET /api/admin/knowledge` has **no authentication** | Medium | same pattern; the chatbot reads the table directly, so the endpoint needn't be public | Phase 2 (quick fix) |
| G3 | `POST /api/chat` is **public with no rate limit** and calls Gemini | Medium | no `getAuthUser`, no `rateLimit` | Phase 2 (rate limit) |
| G4 | Sessions **can't be revoked**: logout only clears the cookie; a stolen token stays valid for 7 days | High | no session/denylist table; `JWT_EXPIRES_IN` defaults to `7d` | Phase 4 |
| G5 | Rate limits live **in process memory**: reset on restart, not shared across instances | Medium | `new Map()` in `lib/rate-limit.ts` | Phase 4 |
| G6 | Authorization is **opt-in per handler**: nothing fails a build when a new route forgets its guard (G1/G2 are exactly this) | High | 155 handlers each call their own guard | Phase 2 (default-deny test) |
| G7 | Authorization decisions are **not audited**: denials leave no record | Medium | `AuditLog` records data changes only | Phase 2 design, Phase 5 build |
| G8 | Two systems hold business logic over one database (Next.js/Prisma and FastAPI) | High (architecture) | both roles can write the same tables | Phase 2 decision (plan Phase 4) |
| G9 | FastAPI has no auth; its docs/OpenAPI are public | Low now (no data endpoints) | `/api/v1/openapi.json` | Phases 4–5 |
| G10 | *(found in step 2)* Public auth flows aren't rate-limited: `forgot-password` (email bombing, account probing), `reset-password`, `verify-email`, Google sign-in; also `apply/options` | Medium | no `rateLimit` in those handlers | Phase 2 |
| G11 | *(found in step 2)* `GET /api/jobs/[id]` (public) returns the full job row for **any** status, including drafts and closed jobs and `employer_client_id`; the public list correctly limits fields and status | Medium | `getPublicJobById` uses `findUnique` with no `select` or status filter | Phase 2 |

| G12 | *(found in step 2)* **Open redirect** after Google sign-in: the callback redirected to `` `${appUrl}${state}` ``, so `state=.evil.com` or `@evil.com` sent a freshly signed-in user to another site | High | `auth/google/callback` used `state` unchecked | Phase 2 |
| G13 | *(found in step 2)* OAuth `state` is not an anti-forgery value, so a login can be forced (login CSRF) | Medium | `state` carries the redirect path only | Phase 4 |
| G14 | *(found in step 2)* Rate limits key on `X-Forwarded-For`, which a client can set to anything to get a fresh allowance | Medium | `lib/rate-limit.ts` | Phase 4 (with G5) |

| G15 | *(found checking 5.5)* Dev and staging apps were reachable **from the local network**: backend, Next.js and Flutter ports bound to `0.0.0.0` (verified from the PC's LAN address); databases and pgAdmin were already localhost-only | High | `docker ps`: `0.0.0.0:3001->3000` etc. | Phase 2 |
| G16 | *(found checking 5.5)* Bulk exports of personal data (`backup/candidates-csv`, `backup/partners-csv`, `candidates/export`) left **no audit trail**: the audit log recorded writes only | Medium | no audit call in the export handlers | Phase 2 |

| G17 | *(found checking 5.5)* One `JWT_SECRET` signs every token type: sessions, password-reset/verification, invites, account setup, CIF upload and document-download links. Stealing it forges an admin session and any document link | High | `lib/jwt.ts` uses one secret for all `sign*Token` | Phase 4 |
| G18 | *(found checking 5.5)* No service-to-service authentication: any container on the network can call FastAPI | Low today (FastAPI has no data endpoints), High once it does | no service credential exists | Phase 2 step 6, before FastAPI serves data |

| G19 | *(found reviewing 5.2)* **A session outlives the decisions behind it.** Identity and role come only from the signed token (7-day expiry), never the database: a **demoted admin keeps admin rights**, a **deleted user keeps access**, and a **password change doesn't end existing sessions**. Accounts also can't be disabled at all (no active flag), only deleted | High | `getAuthUser` returns the token payload; no DB check; `User` has no status field | Phase 4 (`token_version` checked per request, bumped on role change/deletion/password change; short-lived access tokens) — made visible now by strict expected-failure tests in `session-revocation.integration.test.ts` |

### Fixed in Phase 2 (branch `security/phase2-zero-trust`)

| Gap | Fix | Test |
|---|---|---|
| G1, G2 | admin-only guard on `GET /api/admin/emails` and `GET /api/admin/knowledge` | `route-guards.test.ts` (unguarded handler, admin never public) |
| G3, G10 | per-IP rate limits on chat, every auth flow, invite lookup, `apply/options`, job detail | `route-guards.test.ts` (register protection) |
| G6 | public endpoint register in code + CI test that fails on any unguarded, unregistered handler | `route-guards.test.ts`; mutation-checked (removing a guard or a limit fails it) |
| G11 | job detail returns active/closed jobs only, public fields only | `publicJobs.integration.test.ts` |
| G12 | `safeRedirectPath`: only same-site relative paths after sign-in | `safe-redirect.test.ts` (13 attack inputs) |
| G15 | published ports bind to `127.0.0.1` (`BIND_ADDRESS` override); database network shared only by services that need it | verified from the LAN address after deploy |
| G16 | `auditAccess()` writes an audit entry (who, what, how many rows, filter names with only allowlisted values; never the data) before an export is returned | `audit-access.integration.test.ts`; `route-guards.test.ts` fails CI on any unaudited export/backup route (mutation-checked) |

**Policy questions (not confirmed bugs, need an owner's answer):**

| # | Question |
|---|---|
| Q1 | `GET /api/admin/partners/[id]`: any `regional_recruiter`/`country_supervisor` can read **any** partner, including the partner user's email. Should partners be scoped to the recruiter's region or assignment? |
| Q2 | `GET /api/partner-candidates/[id]`: any HR/operations user can read any partner-submitted candidate. Intended to be global? |
| Q3 | `GET /api/applications/[id]`: reviewer roles see every application regardless of region. Intended? |

## 5. Protected routes and privileged operations

**Most sensitive data and operations** (all currently role-guarded and, where
per-record, scope-checked; spot-checked by hand):

- **Candidate personal data and documents:** `candidates/**`, `documents/**`,
  `partner-candidates/**`, `public-intake/**`, `upload`
- **Money:** `cases/[id]/payments/**`, `payments/**`, `finance/**`,
  `fee-policy/**`, `webhooks/stripe`, `consultations/checkout`
- **Case decisions:** `cases/[id]/stage|reject|retention|ops-review|contract`
- **Staff evaluation:** `staff-scorecards/**`, `staff-kpi-targets/**`, `kpi/**`
- **Administration:** `admin/**` (users, roles, countries, partners, settings,
  email templates, backups)

Handler counts (155 handlers in 112 route files):

| Guard | Handlers |
|---|---|
| Role check (`requireRole` or inline) | 120 |
| Login + ownership check in the handler | 16 |
| Signed token / OAuth flow | 4 |
| Webhook signature | 1 |
| Public | 14, of which 12 are intentionally public (auth flows, contact, intake, job listing, apply options) and 2 are gaps (G1, G2) |

The full per-handler inventory is in the appendix.

## Appendix: API handler inventory

Generated by static analysis of `vertex/src/app/api/**/route.ts`, then checked
by hand where flagged. *Scope* = the handler references a record-ownership or
region-scope check. Role lists are expanded from the named constants.

| Method | Route | Guard | Roles | Scope | Writes |
|---|---|---|---|---|---|
| GET | `/api/admin/backup/candidates-csv` | role | admin, director, hr, operations_director, operations_team |  |  |
| GET | `/api/admin/backup/partners-csv` | role | admin, director, hr, operations_director, operations_team |  |  |
| GET | `/api/admin/countries/[id]/document-requirements` | role | 7 roles |  |  |
| PUT | `/api/admin/countries/[id]/document-requirements` | role | admin |  | ✓ |
| PATCH | `/api/admin/countries/[id]` | role | admin |  | ✓ |
| DELETE | `/api/admin/countries/[id]` | role | admin |  | ✓ |
| GET | `/api/admin/countries` | role | 9 roles |  |  |
| POST | `/api/admin/countries` | role | admin |  | ✓ |
| DELETE | `/api/admin/document-types/[id]` | role | admin | ✓ | ✓ |
| GET | `/api/admin/document-types` | role | 9 roles |  |  |
| POST | `/api/admin/document-types` | role | admin | ✓ | ✓ |
| GET | `/api/admin/emails` | **PUBLIC: gap G1** |  |  |  |
| PUT | `/api/admin/emails` | role | admin |  | ✓ |
| GET | `/api/admin/employer-clients/[id]` | role | admin, director, marketing |  |  |
| PATCH | `/api/admin/employer-clients/[id]` | role | admin, director | ✓ | ✓ |
| GET | `/api/admin/employer-clients` | role | admin, director, marketing |  |  |
| POST | `/api/admin/employer-clients` | role | admin, director | ✓ | ✓ |
| GET | `/api/admin/knowledge` | **PUBLIC: gap G2** |  |  |  |
| POST | `/api/admin/knowledge` | role | admin |  | ✓ |
| DELETE | `/api/admin/knowledge` | role | admin |  | ✓ |
| POST | `/api/admin/partners/[id]/provision-account` | role | admin, director, inhouse_supervisor | ✓ | ✓ |
| POST | `/api/admin/partners/[id]/reset-password` | role | admin, director, inhouse_supervisor | ✓ | ✓ |
| GET | `/api/admin/partners/[id]` | role (see Q1) | admin, country_supervisor, director, inhouse_supervisor, regional_recruiter |  |  |
| PATCH | `/api/admin/partners/[id]` | role | admin, director, inhouse_supervisor | ✓ | ✓ |
| DELETE | `/api/admin/partners/[id]` | role | admin, director, inhouse_supervisor | ✓ | ✓ |
| GET | `/api/admin/partners` | role | 9 roles |  |  |
| POST | `/api/admin/partners` | role | admin, director, inhouse_supervisor | ✓ | ✓ |
| PATCH | `/api/admin/regions/[id]` | role | admin |  | ✓ |
| GET | `/api/admin/regions` | role | admin, country_supervisor, director, inhouse_supervisor, regional_recruiter |  |  |
| POST | `/api/admin/regions` | role | admin |  | ✓ |
| DELETE | `/api/admin/sectors/[id]` | role | admin |  | ✓ |
| GET | `/api/admin/sectors` | role | admin, country_supervisor, director, inhouse_supervisor, marketing, regional_recruiter |  |  |
| POST | `/api/admin/sectors` | role | admin |  | ✓ |
| GET | `/api/admin/settings` | role | admin |  |  |
| PUT | `/api/admin/settings` | role | admin |  | ✓ |
| POST | `/api/admin/users/[id]/reset-password` | role | admin | ✓ | ✓ |
| PATCH | `/api/admin/users/[id]` | role | admin | ✓ | ✓ |
| DELETE | `/api/admin/users/[id]` | role | admin | ✓ | ✓ |
| GET | `/api/admin/users` | role | admin, director |  |  |
| POST | `/api/admin/users` | role | admin | ✓ | ✓ |
| PUT | `/api/applications/[id]` | role | admin, director, inhouse_supervisor | ✓ | ✓ |
| GET | `/api/applications/[id]` | login + ownership |  | ✓ |  |
| GET | `/api/applications` | login + ownership |  | ✓ |  |
| POST | `/api/applications` | login + ownership |  | ✓ | ✓ |
| GET | `/api/apply/options` | public (intended) |  |  |  |
| POST | `/api/auth/forgot-password` | public (intended) |  | ✓ |  |
| GET | `/api/auth/google/callback` | OAuth flow |  | ✓ | ✓ |
| GET | `/api/auth/google` | public (intended) |  | ✓ |  |
| POST | `/api/auth/login` | public (intended) |  | ✓ |  |
| POST | `/api/auth/logout` | public (intended) |  |  |  |
| GET | `/api/auth/me` | login + ownership |  | ✓ |  |
| GET | `/api/auth/register` | public (intended) |  |  |  |
| POST | `/api/auth/register` | public (intended) |  | ✓ | ✓ |
| POST | `/api/auth/reset-password` | signed token (Email) |  | ✓ | ✓ |
| GET | `/api/auth/verify-email` | signed token (Email) |  | ✓ | ✓ |
| GET | `/api/campaigns/[id]` | role | admin, country_supervisor, director, inhouse_supervisor, regional_recruiter |  |  |
| PATCH | `/api/campaigns/[id]` | role | admin, director, inhouse_supervisor | ✓ | ✓ |
| DELETE | `/api/campaigns/[id]` | role | admin, director, inhouse_supervisor | ✓ | ✓ |
| DELETE | `/api/campaigns/[id]/targets/[targetId]` | role | admin, director, inhouse_supervisor | ✓ | ✓ |
| POST | `/api/campaigns/[id]/targets` | role | admin, director, inhouse_supervisor | ✓ | ✓ |
| GET | `/api/campaigns` | role | admin, country_supervisor, director, inhouse_supervisor, regional_recruiter | ✓ |  |
| POST | `/api/campaigns` | role | admin, director, inhouse_supervisor | ✓ | ✓ |
| PATCH | `/api/candidates/[id]/application` | role | 7 roles | ✓ | ✓ |
| PATCH | `/api/candidates/[id]/messages/[messageId]` | login + ownership |  | ✓ | ✓ |
| DELETE | `/api/candidates/[id]/messages/[messageId]` | login + ownership |  | ✓ | ✓ |
| GET | `/api/candidates/[id]/messages` | login + ownership |  | ✓ |  |
| POST | `/api/candidates/[id]/messages` | role | director, hr, operations_director, operations_team | ✓ | ✓ |
| GET | `/api/candidates/[id]` | role | admin, country_supervisor, director, inhouse_supervisor, regional_recruiter | ✓ |  |
| PATCH | `/api/candidates/[id]` | role | 7 roles | ✓ | ✓ |
| DELETE | `/api/candidates/[id]` | role | admin, director, hr, operations_director, operations_team | ✓ | ✓ |
| PATCH | `/api/candidates/[id]/status` | role | admin, country_supervisor, director, hr, inhouse_supervisor, regional_recruiter | ✓ | ✓ |
| GET | `/api/candidates/export` | role | admin, country_supervisor, director, inhouse_supervisor, regional_recruiter | ✓ |  |
| GET | `/api/candidates/profile` | login + ownership |  | ✓ |  |
| PUT | `/api/candidates/profile` | login + ownership |  | ✓ | ✓ |
| GET | `/api/candidates` | role | admin, country_supervisor, director, inhouse_supervisor, regional_recruiter | ✓ |  |
| GET | `/api/cases/[id]/audit-log` | role | 11 roles | ✓ |  |
| POST | `/api/cases/[id]/contract` | role | admin, director, operations_director, operations_team | ✓ | ✓ |
| GET | `/api/cases/[id]/contract` | login + ownership |  | ✓ |  |
| POST | `/api/cases/[id]/contract/sign` | role | candidate | ✓ | ✓ |
| PATCH | `/api/cases/[id]/ops-review` | role | admin, director, operations_director, operations_team | ✓ | ✓ |
| POST | `/api/cases/[id]/payments/[paymentId]/check-status` | role | admin, director, finance | ✓ | ✓ |
| POST | `/api/cases/[id]/payments/[paymentId]/mark-paid` | role | admin, director, finance | ✓ | ✓ |
| PATCH | `/api/cases/[id]/payments/[paymentId]/receipt` | role | admin, director, finance | ✓ | ✓ |
| POST | `/api/cases/[id]/payments/invoice` | role | admin, director, finance | ✓ | ✓ |
| POST | `/api/cases/[id]/payments/link` | role | admin, director, finance | ✓ | ✓ |
| POST | `/api/cases/[id]/payments` | role | admin, director, finance | ✓ | ✓ |
| GET | `/api/cases/[id]/payments` | role | 10 roles | ✓ |  |
| PATCH | `/api/cases/[id]/reject` | role | admin, director, hr, operations_director, operations_team | ✓ | ✓ |
| POST | `/api/cases/[id]/remind` | role | admin, director, operations_director, operations_team | ✓ | ✓ |
| PATCH | `/api/cases/[id]/retention` | role | admin, director, operations_director, operations_team | ✓ | ✓ |
| GET | `/api/cases/[id]` | role | 11 roles | ✓ |  |
| PATCH | `/api/cases/[id]/stage` | role | admin, director, operations_director, operations_team | ✓ | ✓ |
| GET | `/api/cases` | role | 11 roles | ✓ |  |
| POST | `/api/chat` | **PUBLIC, no rate limit: gap G3** |  |  |  |
| GET | `/api/consultation-bookings` | role | admin, director, finance, operations_director, operations_team |  |  |
| POST | `/api/consultations/checkout` | public (intended) |  |  | ✓ |
| POST | `/api/contact` | public (intended) |  |  |  |
| GET | `/api/documents/[id]/signed-url` | login + ownership |  | ✓ |  |
| PATCH | `/api/documents/[id]/verify` | role | admin, country_supervisor, director, hr, inhouse_supervisor | ✓ | ✓ |
| GET | `/api/documents/file` | signed token (Document) |  |  |  |
| PATCH | `/api/exceptions/[id]` | role | admin, country_supervisor, director, inhouse_supervisor, regional_recruiter | ✓ | ✓ |
| GET | `/api/exceptions` | role | admin, country_supervisor, director, inhouse_supervisor, regional_recruiter | ✓ |  |
| POST | `/api/exceptions` | role | admin, country_supervisor, director, inhouse_supervisor, regional_recruiter | ✓ | ✓ |
| GET | `/api/fee-policy` | role | 10 roles |  |  |
| POST | `/api/fee-policy` | role | admin, director | ✓ | ✓ |
| GET | `/api/finance/payments-due` | role | admin, director, finance |  |  |
| GET | `/api/inhouse/campaigns` | role | admin, inhouse_supervisor | ✓ |  |
| GET | `/api/inhouse/overview` | role | admin, inhouse_supervisor | ✓ |  |
| GET | `/api/inhouse/supervisors/[id]` | role | admin, country_supervisor, inhouse_supervisor | ✓ |  |
| GET | `/api/inhouse/supervisors` | role | admin, inhouse_supervisor | ✓ |  |
| GET | `/api/jobs/[id]` | public (intended) |  |  |  |
| PUT | `/api/jobs/[id]` | role | admin, marketing |  | ✓ |
| DELETE | `/api/jobs/[id]` | role | admin, marketing |  | ✓ |
| POST | `/api/jobs/[id]/sync-stripe-pricing` | role | admin, marketing |  |  |
| GET | `/api/jobs` | role | admin, marketing |  |  |
| POST | `/api/jobs` | role | admin, marketing |  | ✓ |
| GET | `/api/kpi` | role | admin, director, inhouse_supervisor | ✓ |  |
| GET | `/api/management/report-metrics` | role | admin, director |  |  |
| GET | `/api/partner/candidates/[id]` | role | partner | ✓ |  |
| PATCH | `/api/partner/candidates/[id]` | role | partner | ✓ | ✓ |
| GET | `/api/partner/candidates` | role | partner | ✓ |  |
| POST | `/api/partner/candidates` | role | admin, hr, operations_director, operations_team, partner | ✓ | ✓ |
| PATCH | `/api/partner-candidates/[id]/create-case` | role | admin, director, hr | ✓ | ✓ |
| PATCH | `/api/partner-candidates/[id]/reject` | role | admin, director, hr | ✓ | ✓ |
| GET | `/api/partner-candidates/[id]` | role (see Q2) | admin, director, hr, operations_director, operations_team |  |  |
| DELETE | `/api/partner-candidates/[id]` | role | admin, director, hr, operations_director, operations_team | ✓ | ✓ |
| GET | `/api/partner-candidates` | role | admin, director, hr, operations_director, operations_team |  |  |
| GET | `/api/payments/me` | login + ownership |  | ✓ |  |
| POST | `/api/payments/paypal/capture-order` | login + ownership |  | ✓ | ✓ |
| POST | `/api/payments/paypal/create-order` | login + ownership |  | ✓ |  |
| POST | `/api/payments/stripe/create-checkout` | login + ownership |  | ✓ | ✓ |
| POST | `/api/public-intake/application` | public (intended) |  |  |  |
| GET | `/api/recruiter-notes` | role | admin, country_supervisor, regional_recruiter | ✓ |  |
| POST | `/api/recruiter-notes` | role | admin, country_supervisor | ✓ | ✓ |
| GET | `/api/recruiter-targets/progress` | role | regional_recruiter | ✓ |  |
| GET | `/api/recruiter-targets` | role | admin, country_supervisor, director, inhouse_supervisor, regional_recruiter | ✓ |  |
| POST | `/api/recruiter-targets` | role | admin, country_supervisor, regional_recruiter | ✓ | ✓ |
| PATCH | `/api/reports/[id]/resubmit` | role | admin, country_supervisor, director, inhouse_supervisor, regional_recruiter | ✓ | ✓ |
| PATCH | `/api/reports/[id]/return` | role | admin, country_supervisor, director, inhouse_supervisor | ✓ | ✓ |
| GET | `/api/reports/[id]` | role | admin, country_supervisor, director, inhouse_supervisor, regional_recruiter | ✓ |  |
| PATCH | `/api/reports/[id]/verify` | role | admin, country_supervisor, director, inhouse_supervisor | ✓ | ✓ |
| GET | `/api/reports/consolidation-preview` | role | admin, country_supervisor, inhouse_supervisor | ✓ |  |
| GET | `/api/reports` | role | admin, country_supervisor, director, inhouse_supervisor, regional_recruiter | ✓ |  |
| POST | `/api/reports` | role | country_supervisor, inhouse_supervisor, regional_recruiter | ✓ | ✓ |
| GET | `/api/staff-kpi-targets` | role | admin, country_supervisor, director, inhouse_supervisor, regional_recruiter | ✓ |  |
| POST | `/api/staff-kpi-targets` | role | admin, country_supervisor, director, inhouse_supervisor, regional_recruiter | ✓ | ✓ |
| PATCH | `/api/staff-scorecards/[id]` | role | admin, country_supervisor, director, inhouse_supervisor | ✓ | ✓ |
| GET | `/api/staff-scorecards` | role | admin, country_supervisor, director, inhouse_supervisor, regional_recruiter | ✓ |  |
| POST | `/api/staff-scorecards` | role | admin, country_supervisor, director, inhouse_supervisor | ✓ | ✓ |
| GET | `/api/supervisor/overview` | role | admin, country_supervisor | ✓ |  |
| GET | `/api/supervisor/recruiters/[id]` | role | admin, country_supervisor, regional_recruiter | ✓ |  |
| GET | `/api/supervisor/recruiters` | role | admin, country_supervisor | ✓ |  |
| GET | `/api/supervisor/team-targets` | role | admin, country_supervisor | ✓ |  |
| POST | `/api/upload` | login + ownership |  | ✓ | ✓ |
| POST | `/api/webhooks/stripe` | webhook signature |  | ✓ | ✓ |
