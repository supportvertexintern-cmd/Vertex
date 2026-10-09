# Zero trust security policy

**Status:** adopted for development and staging (Phase 2). Production adopts it
when production infrastructure exists. **Applies to:** every Vertex component —
Next.js, FastAPI, the Flutter app, PostgreSQL, CI/CD — and to every person and
service that touches them.

The words **must**, **must not** and **should** are requirements, not advice. A
change that breaks a *must* is a defect, whatever the deadline.

Related: [phase2-baseline.md](phase2-baseline.md) (state before this policy,
gaps G1–G9), [../secrets.md](../secrets.md) (credentials).

## The rule

> **No request, user, service or network location is trusted by default.**
> Every protected operation is allowed only after the caller's identity, their
> permission for the action, and their right to the specific record have all
> been verified — on that request, on the server.

## 1. Never trust implicitly

A request **must not** be trusted because it comes from:

| Source | Why it isn't proof of anything |
|---|---|
| The local machine (`localhost`, `127.0.0.1`) | Any process, browser tab or malware on the machine can send it. |
| The Docker network | Every container on it can reach every other; one compromised container would inherit the trust. |
| A logged-in browser | Being logged in proves identity, not permission for *this* action on *this* record. |
| Another Vertex service | Services are compromised too; a service gets only the rights it has been explicitly granted. |
| An administrator's interface | Admin screens are ordinary clients; the server re-checks everything they send. |
| A previously authenticated session | A session can be stolen, expired, revoked, or belong to a since-disabled account. |

Every protected request **must** go through the verification in section 2,
every time. Nothing is skipped because an earlier request was allowed.

## 2. Verify explicitly, on every request

A protected request is allowed only if **all** of these pass, in this order:

1. **Identity:** a valid credential (session token, signed single-purpose
   token, or service credential) whose signature, algorithm and expiry are
   checked on the server.
2. **Account state:** the account still exists and is active, and the
   credential has not been revoked.
3. **Permission:** the caller's role grants this action (for example
   `case.stage.update`).
4. **Record access:** the caller may act on *this* record — they own it, are
   assigned to it, or it lies inside their region or country scope.
5. **Context:** any extra rule for the action holds (for example, a case-stage
   transition that is valid from the current stage).

The client **must not** decide any of these. Hiding a button is a convenience,
not a control: the API enforces the same rules independently.

## 3. Deny by default

Access is **denied unless the system can establish that the operation is
explicitly allowed.** In particular, the request **must** be denied when:

| Situation | Required result |
|---|---|
| The permission is unknown (no rule names it) | deny |
| A protected operation has no identity (no or unreadable credential) | deny: 401 |
| The credential is invalid, expired, revoked, or for a disabled account | deny: 401 |
| Ownership or scope of the record can't be verified (record missing, scope lookup fails or returns nothing) | deny: 404 or 403 (see §5) |
| The authorization check itself errors (exception, timeout, bad data) | deny: never an automatic allow |
| A security dependency is unavailable (database, token signing key, rate-limit store, policy data) | deny: no fail-open path (see §7) |

Rules for code:

- Every endpoint and server action **must** start from *deny*. Access is
  granted only by an explicit rule naming the roles and the record scope.
- Authorization code **must** be written so that an exception, `null`, empty
  result or missing field falls through to *deny*. There **must not** be a
  `catch` that continues, or a default branch that allows.
- An endpoint with no authorization rule is a defect. CI **must** fail when an
  API handler has neither a guard nor an entry in the public register below
  (closes baseline gap G6, which allowed G1 and G2).

### Public endpoint register

Public endpoints **must** be explicitly designated, narrowly scoped and
documented. The register is code, not prose: **`vertex/src/lib/public-endpoints.ts`**.
`vertex/src/lib/route-guards.test.ts` fails CI when an API handler has no
guard and isn't registered, when a registered endpoint no longer exists, when
a public endpoint lacks the protection its entry claims (rate limit, signed
token, signature), or when anything under `/api/admin/` is registered public.

| Endpoint | Purpose | May return | Protection |
|---|---|---|---|
| `POST /api/auth/login` | sign in | session cookie; generic error | rate limit |
| `POST /api/auth/logout` | sign out | clears cookie | none needed |
| `GET /api/auth/register` | look up an account-setup invite link | invite status | rate limit (20 / 15 min) |
| `POST /api/auth/register` | create a candidate account | outcome only | rate limit |
| `POST /api/auth/forgot-password` | request a reset email | same reply whether or not the account exists | rate limit (5 / 15 min) |
| `POST /api/auth/reset-password` | set a new password | outcome only | signed email token + rate limit (10 / 15 min) |
| `GET /api/auth/verify-email` | confirm an email address | outcome only | signed email token + rate limit (10 / 15 min) |
| `GET /api/auth/google`, `.../callback` | Google sign-in | redirect to a **same-site path only**; session cookie | rate limit (20 / 15 min) |
| `GET /api/apply/options` | application form choices | country and document-type names/IDs | rate limit (60 / min) |
| `POST /api/applications` | public apply form | outcome only (staff/candidate submissions are checked inside) | rate limit (5 / min) |
| `GET /api/jobs/[id]` | public job page | **active or closed** jobs, public fields only; never drafts | rate limit (120 / min) |
| `POST /api/contact` | contact form | outcome only | rate limit |
| `POST /api/public-intake/application` | public application form | outcome only | rate limit |
| `POST /api/consultations/checkout` | pay for a consultation | payment redirect URL | rate limit |
| `POST /api/chat` | website AI assistant | text from public knowledge only | rate limit (30 / 10 min) |
| `GET /api/documents/file?token=` | download a document | the one file named in a short-lived signed token issued after an access check | signed token |
| `POST /api/webhooks/stripe` | payment events from Stripe | acknowledgement only | Stripe signature |

Rate limits are per client IP and held in process memory; Phase 4 moves them
to a shared store keyed on a trusted client address (gaps G5, G14).

## 4. Least privilege

- **People:** each role gets only the actions its job needs, scoped to its
  region, country or assignments.
- **Services:** each service has its own credential and only the rights it
  needs. Today: Next.js uses database role `vertex_web`, FastAPI uses
  `vertex_api`, migrations use `vertex_migrator`; none can run DDL at runtime,
  truncate tables, or change the audit log (Phase 1, enforced by
  `vertex_be/tests/test_db_roles.py`).
- **The database superuser is for humans only** (psql, when needed) and for
  `deploy.sh` provisioning. No application **may** hold it, and pgAdmin
  never pre-registers it: pgAdmin is off by default and connects as
  `vertex_readonly`, which reads only columns on an **allowlist**
  (`vertex_be/deploy/readonly-columns.sql`): every column in the schema is
  classified `grant` or `exclude`, CI fails on any unclassified column, and
  nothing becomes readable without a decision. Secrets, the audit log and
  personal data (names, contact details, documents, free text) are excluded.
- **Tests never touch a stack's database.** Locally they run against a
  throwaway Postgres (`vertex_be/scripts/test.sh`), like CI; neither dev's
  nor staging's Postgres is published to the host.
- **Administrative privileges are never inherited.** There is no role
  hierarchy: every check lists the roles it allows, so `director`,
  `inhouse_supervisor` or any other role gets nothing from `admin` implicitly.
  Only an admin can create users or change a role (`/api/admin/users*`).
  Request bodies are validated against schemas that contain no `role`,
  `user_id` or ownership fields, so they can't be mass-assigned (checked for
  every handler that spreads request data into a write, Phase 2).
- **Containers** run with the least OS privilege that works (Phase 3:
  non-root, read-only filesystem where practical, no added capabilities).

## 5. Check every record, not just the role

Role checks alone allow one recruiter to read another region's candidates by
changing an ID in the URL (IDOR/BOLA). Therefore:

- Every handler that takes a record ID **must** check that the caller may
  access that record (`canAccessCandidate`, `canAccessCase`, report scope
  filters, ownership checks).
- List endpoints **must** filter by the caller's scope **in the query**, not
  after loading the data.
- An inaccessible record **should** return 404, not 403, so callers can't
  probe which IDs exist (for records where existence itself is sensitive).

**Where each kind of sensitive operation is checked** (Next.js API, verified
handler by handler in Phase 2; FastAPI must meet the same table as its
endpoints are built):

| Operation | Endpoints | Server-side check |
|---|---|---|
| Read candidate profiles | `GET /api/candidates`, `/api/candidates/[id]`, `/api/candidates/profile` | role + `canAccessCandidate` / scope filter; candidates see only their own profile |
| Update personal information | `PATCH /api/candidates/[id]`, `PUT /api/candidates/profile` | role + record scope; self-service always keyed on the caller's own `user_id`; schema allows personal fields only |
| CVs and documents | `GET /api/documents/[id]/signed-url` → `GET /api/documents/file`, `POST /api/upload`, `PATCH /api/documents/[id]/verify` | access check on the owning candidate, then a short-lived signed URL; files are never public |
| View applications and outcomes | `GET /api/applications*`, `/api/cases*`, `/api/cases/[id]/contract` | owner or reviewer role; cases scoped through `scopeCasesToRequester` / `canAccessCase` |
| Change application or case status | `PUT /api/applications/[id]`, `PATCH /api/cases/[id]/stage\|reject\|retention\|ops-review`, partner-candidate decisions | role + record scope + allowed transition (`canSetCaseStage`, `canSetLifecycleStatus`) |
| Manage roles and permissions | `/api/admin/users*` | `admin` only |
| Other administration | `/api/admin/**` | role per action; reference data (countries, regions, sectors) is role-checked only, which is correct for shared data |
| Export or delete data | `/api/admin/backup/*`, `/api/candidates/export`, every `DELETE` | role + scope where per-record; **every bulk export is written to the audit log first** (CI-enforced) |

Open scope questions (owner to decide): Q1 partner details, Q2 partner
candidates and the HR/operations bulk exports, Q3 applications for
reviewers: currently visible across all regions to the listed roles. See the
baseline.

## 6. Service-to-service trust

- A call from one Vertex service to another **must** carry its own
  credential. Being on the same Docker network grants nothing.
- Today no service calls another: Next.js and FastAPI share only the
  database, through separate roles (see the baseline). The first
  service-to-service call **must** be designed under this section before it is
  built.
- **Development and staging:** a per-environment service token, sent in a
  header, checked by the receiving service, stored like any other secret, and
  rotatable without code changes.
- **Production (later):** short-lived credentials (workload identity or mTLS),
  plus network rules that allow only the calls that are needed.
- When a service acts for a user, the receiving service **must** re-authorize
  against that user's permissions. It **must not** trust the calling service's
  claim that the user is allowed.

## 7. Fail closed

- If any verification step cannot complete (database down, token unreadable,
  policy lookup fails, unexpected exception), the request **must** be denied.
- Errors **must not** reveal why access was denied in a way that helps an
  attacker: no stack traces, SQL, internal IDs or user existence checks in
  responses. Return a generic message and log the details server-side.
- Health checks and metrics endpoints **must not** expose configuration,
  secrets or personal data.

## 8. Assume breach

Design so that one compromised piece does limited damage:

- Credentials are separate per service and per environment, never reused
  (enforced by [secrets.md](../secrets.md)).
- Development and staging are isolated: separate networks, databases and
  credentials (verified in the baseline).
- Sessions **must** be short-lived and revocable (Phase 4 closes gap G4:
  today a stolen token lasts 7 days and logout can't revoke it).
- Sensitive files are reachable only through short-lived signed URLs issued
  after an access check (already true for documents).
- **Limited network exposure:** every published port binds to `127.0.0.1`
  (`BIND_ADDRESS` overrides, for a VPS behind a TLS proxy); nothing in dev or
  staging is reachable from the local network (gap G15, fixed).
- **Network segmentation:** the database network is `internal` (no outbound
  traffic), shared only by the database and the services that use it;
  services that need the internet or a published port also join `edge`; the
  static Flutter server is alone. Neither dev's nor staging's Postgres is
  published; `docker-compose.db-port.yml` exists for a deliberate, temporary
  exception (set `POSTGRES_HOST_PORT`) and is off in both.
- **Small blast radius per service:** each container receives only its own
  secrets. Next.js holds its database login (`vertex_web`), `JWT_SECRET` and
  a public URL; FastAPI holds `vertex_api`/`vertex_migrator` logins and
  `SECRET_KEY`. Neither sees the other's, and every value differs between
  dev and staging (checked by fingerprint, Phase 2).
- **Auditable actions:** data changes are logged automatically
  (`auditedPrisma`); sensitive reads such as bulk exports are logged with
  `auditAccess`, before the data is returned (gap G16, fixed). Audit
  entries record filter **names**; values are kept only for an allowlist of
  non-personal filters (dates, status, IDs), so a search by name or email is
  stored as `[redacted]`. The application roles can insert audit rows but
  never update, delete or truncate them (Phase 1 grants plus triggers;
  verified live).

**Status of "assume breach" (plan 5.5):**

| Control | Status |
|---|---|
| Isolated credentials per service and environment | ✅ |
| Constrained database roles | ✅ (Phase 1) |
| Limited network exposure and segmentation | ✅ (G15 fixed, internal data network) |
| Auditable actions, tamper-proof log | ✅ writes + exports (G16 fixed); authorization denials still open (G7) |
| **Explicit service authentication** | ❌ **open (G18).** No service calls another today, but nothing stops one: a compromised Next.js container can reach FastAPI over the Docker network. Harmless while FastAPI has only a health check; §6 must be built before FastAPI serves any data. |
| **Separate signing keys per purpose** | ❌ **open (G17).** One `JWT_SECRET` signs sessions, email/reset tokens, invites and document links: stealing it forges an admin session *and* any document download. Phase 4. |

## 9. Audit security decisions

These events **must** be recorded:

- Logins (success and failure), logouts, password resets, token refreshes and
  revocations.
- **Authorization denials** (closes gap G7), with the action and record
  attempted.
- Role, permission and account-status changes.
- Access to candidate documents and other personal data.
- Payment and case-stage changes (already in `AuditLog`).

Each event records: who (user or service), what action, which record, the
outcome and reason, when, and a request/correlation ID. Events **must never**
contain passwords, tokens, API keys, full documents, or other secrets. The
audit log is append-only (database triggers plus Phase 1 grants).

## 10. Where each rule is enforced

| Layer | Enforcement point | Enforces |
|---|---|---|
| Browser / Flutter | none (convenience only) | — |
| Next.js pages | `src/proxy.ts` | logged in; correct portal for the role |
| Next.js API | `lib/api-auth.ts` (`requireRole`), `server/scope.ts`, per-handler checks | sections 2–5, 7 |
| FastAPI | a dependency on every protected route (Phase 4–5) | sections 2–5, 7 |
| Service calls | receiving service's credential check | section 6 |
| PostgreSQL | per-service roles (`db-roles.sql`) | section 4; limits damage when an app layer fails |
| CI | role tests, guard-coverage test (Phase 2), secret scanning | sections 3, 4, 8 |

Defence in depth: the database limits **what** a service can ever do; the
application decides **who** may do it to **which** record. Neither replaces
the other.

## 11. Exceptions

An exception to a *must* needs a written entry here (rule, reason, owner,
expiry date) agreed by the project owner. Undocumented exceptions are defects.

| Rule | Exception | Reason | Owner | Expires |
|---|---|---|---|---|
| §3 rate limits are trustworthy | limits are per-process and keyed on a client-supplied `X-Forwarded-For` | gaps G5, G14 | — | end of Phase 4 |
| §2 identity: OAuth sign-in verifies the request it answers | Google sign-in `state` carries the redirect path, not an anti-forgery value (login CSRF) | gap G13 | — | end of Phase 4 |
| §8 revocable sessions; 5.2 revoked credentials denied | 7-day JWT, no revocation; role and identity read only from the token, so demotion, deletion and password changes don't take effect until expiry | gaps G4, G19 (tracked by strict expected-failure tests) | — | end of Phase 4 |
