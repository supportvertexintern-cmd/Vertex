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

Public endpoints **must** be explicitly designated here, narrowly scoped, and
documented. Each **must** be rate-limited and **must not** return personal or
internal data beyond what its purpose requires. Anything public that isn't in
this table is a defect.

| Endpoint | Purpose | May return | Rate-limited | Status |
|---|---|---|---|---|
| `POST /api/auth/login` | sign in | session cookie; generic error on failure | ✅ | ok |
| `POST /api/auth/logout` | sign out | clears cookie | n/a (no effect without a session) | ok |
| `GET`, `POST /api/auth/register` | create a candidate account | outcome only | ✅ | ok |
| `POST /api/auth/forgot-password` | request a reset email | the same response whether or not the account exists | ❌ | **gap G10** |
| `POST /api/auth/reset-password` | set a new password | outcome only; needs a signed, expiring email token | ❌ | add a limit (G10) |
| `GET /api/auth/verify-email` | confirm an email address | outcome only; needs a signed email token | ❌ | add a limit (G10) |
| `GET /api/auth/google`, `GET /api/auth/google/callback` | Google sign-in | redirect; session cookie | ❌ | add a limit (G10) |
| `GET /api/apply/options` | application form choices | country and document-type names and IDs | ❌ | add a limit |
| `GET /api/jobs/[id]` | public job page | **active** jobs, public fields only | ❌ | **gap G11**: returns drafts/closed jobs and `employer_client_id` |
| `POST /api/contact` | contact form | outcome only | ✅ | ok |
| `POST /api/public-intake/application` | public application form | outcome only | ✅ | ok |
| `POST /api/consultations/checkout` | pay for a consultation | payment redirect URL | ✅ | ok |
| `POST /api/chat` | website AI assistant | generated text from public knowledge only | ❌ | **gap G3** (exception in §11) |
| `GET /api/documents/file?token=` | download a document | the one file named in a signed, short-lived token issued after an access check | n/a (unguessable token) | ok |
| `POST /api/webhooks/stripe` | payment events from Stripe | acknowledgement only; Stripe signature required | n/a (signature) | ok |

**Not public, currently exposed (defects, fix in Phase 2):**
`GET /api/admin/emails` (gap G1) and `GET /api/admin/knowledge` (gap G2).

## 4. Least privilege

- **People:** each role gets only the actions its job needs, scoped to its
  region, country or assignments.
- **Services:** each service has its own credential and only the rights it
  needs. Today: Next.js uses database role `vertex_web`, FastAPI uses
  `vertex_api`, migrations use `vertex_migrator`; none can run DDL at runtime,
  truncate tables, or change the audit log (Phase 1, enforced by
  `vertex_be/tests/test_db_roles.py`).
- **The database superuser is for humans only** (pgAdmin, psql) and for
  `deploy.sh` provisioning. No application **may** hold it.
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
| §3 rate-limit every public endpoint | `POST /api/chat` is not rate-limited yet | known gap G3, fix scheduled in Phase 2 | — | end of Phase 2 |
| §3 rate-limit every public endpoint | auth-flow and `apply/options` endpoints marked ❌ in the register | known gap G10, fix scheduled in Phase 2 | — | end of Phase 2 |
| §8 revocable sessions | 7-day JWT without revocation | known gap G4 | — | end of Phase 4 |
