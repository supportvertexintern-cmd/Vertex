# Reads handover: one API for everything

Status: **approved by the owner, 2026-11-02: D1 to D6 all option A.** R1 to R6, R7a, R7c and R7d done; R7b in progress (in batches: the notices are all FastAPI's; the direct sends are next), then R8. Follows
[data-ownership.md](data-ownership.md): FastAPI has written every table since
users step 8.5, but the website still **reads** the database itself through
Prisma. The owner's request (2026-11-02): the website stops reading through
Prisma, so that FastAPI is the one API, for the website and the Flutter app
alike.

## 1. Today

With the backend stopped, every page that only reads still works, and every
write fails (checked on `dev`, 2026-11-02: sign-in 502, forgot password
"service unavailable"). The website's database role `vertex_web` can
`SELECT` the tables (not the credential columns) and `INSERT` into
`AuditLog`, nothing else.

What still uses Prisma in `vertex/src` (tests aside):

| Where | Files | What |
|---|---|---|
| API routes (`app/api/**`) | 60 | The `GET`s behind every list, detail page and dashboard, and the reads inside routes that pass their write on (a scope check, a lookup before the call) |
| `server/services/` | 9 | `kpi.ts` (15 queries, 10 tables), `reportConsolidation.ts`, `documentCompleteness.ts`, `candidateSignals.ts`, `publicJobs.ts`, `opportunityFilters.ts`, `reportWorkflow.ts`; `paymentReceiptTypes.ts` and `stripeProvisioning.ts` only for `prisma/seed.ts` |
| `server/scope.ts` | 1 | Row-level access: which candidates, partners and countries a user may see (6 queries) |
| `lib/session.ts` | 1 | **Every signed-in request**: is the user still there, is the token version current, is the session family live (`User`, `RefreshToken`) |
| `lib/audit.ts`, `lib/security-monitor.ts` | 2 | The audit rows the website writes itself (`recordSecurityEvent`, `auditAccess`, `auditFilters`: 8 files) and the alert monitor that counts them and emails admins |
| `lib/email.ts` | 1 | The pipeline's emails: the website sends them, from `EmailTemplate` |
| `lib/document-access.ts` | 1 | A document's virus-scan status before serving it |
| `server/backup/` | 2 | The backup export: reads every table generically |
| `app/help/page.tsx` | 1 | The only page that reads while rendering (`KnowledgeArticle`) |

FastAPI already answers 21 `GET`s (reference data, campaigns, targets,
scorecards, email templates, knowledge, settings, sessions, `/me`). The
Flutter app already calls FastAPI directly for its data, and the website
only to sign in (`vertex_app`: `API_BASE_URL`, `AUTH_BASE_URL`).

## 2. End state

- Every read the website makes is a call to FastAPI. No Prisma client, no
  `DATABASE_URL` and no `@prisma/client` in the website's image.
- The `nextjs` service leaves the `data` network: it reaches FastAPI and
  Redis, not Postgres. The `vertex_web` role is dropped. `verify-stack.sh`
  checks "Next.js → database: no".
- Each read is an endpoint the Flutter app can call with its own session.
- With the backend down, the website shows an error page, as it does for
  writes.

## 3. Decisions

### D1. How does a page get its data?

- **A (recommended).** The website's `/api/*` routes stay where they are
  and pass each `GET` on to FastAPI with `callBackend`, as writes already
  do. FastAPI answers in the same JSON shape, so no page or component
  changes. The routes become thin and can go later.
- B. Pages call FastAPI from the browser. That means CORS with cookies, a
  second origin for the session cookie, and changing every page: much more
  work for the same result.

### D2. The per-request session check (`lib/session.ts`)

- **A (recommended).** Once a route's data comes from FastAPI, FastAPI's own
  check (`app/core/auth.py`: the same user, version and live-session test)
  is the one that counts, and the website drops its copy. `src/proxy.ts`
  keeps checking the token's signature and expiry with the public key (no
  database). That decides only which pages to show, not what data comes
  back.
- B. The website asks FastAPI `GET /me` on every request: one more call
  per page, for a check the data call makes anyway.

### D3. The audit rows the website writes, and the alert monitor

- **A (recommended).** A service-only `POST /api/v1/audit-events` (the
  website's `X-Vertex-Service` credential) records them in the same
  append-only table. The alert monitor's counting and admin emails move to
  FastAPI with it. The website then needs no database at all.
- B. Keep the website's `INSERT` on `AuditLog` as a written exception. The
  website keeps a database role and stays on the `data` network.

### D4. The pipeline's emails

- **A (recommended).** FastAPI sends them from the write that triggers them.
  An email then goes out only when its write commits. *Correction
  (2026-11-03): FastAPI didn't send the account emails; it listed them in
  `notify` and the website sent them. R7a gives FastAPI its own mailer
  (`app/core/mailer.py`, the same `SMTP_*` settings) for the security
  alerts; R7b moves the rest onto it.*
- B. The website keeps sending them and reads the template from
  `GET /api/v1/email-templates` (exists). Smaller, but two services keep
  sending mail.

### D5. The backup export

- **A (recommended).** It moves to FastAPI as a streamed export, with the
  same roles and table catalogue (`server/backup/catalog.ts`), audited as
  today.
- B. Retire it in favour of the database backups (`deploy/backup.sh`).

### D6. How does each area switch?

- **A (recommended).** One PR per area, like the write steps. Each FastAPI
  endpoint is tested against the website's current answer for the same
  data and the same roles (same rows, same shape, same 403 and 404); then
  the website's route passes on to it. A test lists the website files still
  allowed to import Prisma, and each step shortens the list.
- B. Shadow reads: both answer for a while and differences are logged.
  More machinery, and the tests in A catch the same differences earlier.

## 4. Steps

From least to most risk, as with the writes. Row-level access
(`server/scope.ts`: partners see their own candidates, in-house staff their
countries, referral agents their referrals) moves with the first area that
needs it, and is tested per role. A read that returns someone else's rows
is the main risk of this plan.

| Step | Area | Website files that stop using Prisma |
|---|---|---|
| R1 | **Reference data and content**: apply options, help, chat context, public jobs and their filters, document types, the job lookups in checkout and public intake | `apply/options`, `help/page.tsx`, `chat`, `admin/document-types`, `payments/stripe/create-checkout`, `public-intake/application`, `publicJobs.ts`, `opportunityFilters.ts` |
| R2 | **Partners and referral agents**: admin lists and details, commission rules and commissions, the referral agent's own pages | `admin/partners*`, `admin/referral-agents*`, `admin/referral-commission*`, `referral-agent/*` |
| R3 | **Recruitment operations and KPIs**: in-house and supervisor dashboards, report lists, the consolidation preview, staff KPI targets, management metrics | `inhouse/*`, `supervisor/*`, `reports*`, `staff-kpi-targets`, `management/report-metrics`, `kpi.ts`, `reportConsolidation.ts`, `reportWorkflow.ts` |
| R4 | **Candidate pipeline, part 1**: candidates, applications, partner submissions, self applications, rejected submissions, messages; with `server/scope.ts` | `candidates*`, `applications*`, `partner/*`, `partner-candidates*`, `rejected-submissions`, `candidateSignals.ts`, `documentCompleteness.ts`, `scope.ts` |
| R5 | **Candidate pipeline, part 2**: cases (list, detail, contract, audit log), exceptions, documents (signed URLs, scan status) | `cases*`, `exceptions`, `documents/*`, `document-access.ts` |
| R6 | **Payments and users**: case payments, a user's own payments, consultation bookings, payments due, the admin user list, supervisors | `cases/[id]/payments`, `payments/me`, `consultation-bookings`, `finance/payments-due`, `admin/users`, `inhouse/supervisors*` |
| R7 | **Cross-cutting** (D2 to D5), in four PRs: **R7a** audit events and the alert monitor (D3); **R7b** emails (D4); **R7c** the backup export (D5); **R7d** the session check (D2), last, because until R7c the backup export still acts on the website's own check of the session | `audit.ts`, `security-monitor.ts`, `email.ts`, `session.ts`, `server/backup/*`, `admin/backup/*` |
| R8 | **Close**: remove the Prisma client and `DATABASE_URL` from the website, take `nextjs` off the `data` network, drop `vertex_web` (`db-roles.sql`), move the test seeds to the backend, add the `verify-stack.sh` rows | `lib/prisma.ts`, `prisma/` |

Each step: the FastAPI endpoints (in the OpenAPI document, so the Flutter
app can use them), the website's routes passing on, the Prisma allow-list
shortened, and `verify-stack.sh` on `dev`. Each PR goes into `dev`;
staging and main only when the owner asks.

## 5. Risks

| Risk | Mitigation |
|---|---|
| A read returns rows the caller shouldn't see (scope ported wrongly) | Per-role tests for each endpoint against the website's current answer (D6 A); scope moves once (R4) and later areas reuse it |
| A page breaks because a field or format changed (dates, nulls, nesting) | The same JSON shape as today, tested field by field; the end-to-end journeys run on each PR |
| Slower pages: one more hop per read | An internal network call (about a millisecond). Dashboards that run many queries (`kpi.ts`) get one endpoint each, not one call per query |
| The backend becomes a single point of failure for reads too | That is the request (one API). The website shows an error page, and the stack's health checks restart the backend |
| A long migration leaves both paths half done | The allow-list test shows exactly what is left, and each step is finished and deployed on its own |

## 6. Progress

| Step | State |
|---|---|
| R1 | Done (this PR). FastAPI answers the public job listing and detail (`GET /api/v1/jobs`, `/jobs/{id}`), a job's application fee for a signed-in user (`/jobs/{id}/application-fee`, for the checkout; the public job never shows it), the apply options, the help articles, whether the assistant is on (`app/api/v1/public.py`) and the staff list of document types. The anonymous reads take a new guard, `website_or_user` (`app/core/auth.py`): the website's service credential, with the visitor's session when there is one, or a signed-in user calling directly (the Flutter app). It is in default deny's `GUARDS` and the OpenAPI security. FastAPI applies the website's visibility rules (drafts, statuses and sorting only for a job manager; partner-only jobs for a job manager, or with `audience=partner` for the partner roles) and answers the same JSON keys (`tests/test_public_reads.py`). The website's routes and the three job pages pass on; `server/services/publicJobs.ts` is a client. Changes: `GET /api/jobs` is now a registered public endpoint with a per-IP limit (it had none); public intake finds only a public job, so a draft or partner-only one is "Opportunity not found."; ties in the listing's order are broken by id. `src/lib/prisma-readers.test.ts` lists the 64 files left. Rollback: revert; no migration |
| R2 | Done (this PR). FastAPI answers the partner list and detail (`app/api/v1/partner_agencies.py`) and every referral read (`app/api/v1/referral_reads.py`): agents, an agent, the per-country overview and summary, performance (`kpi.ts`'s `computeReferralAgentPerformance`, ported and removed from the website), commission rules, commissions, and a referral agent's own profile, candidates and commissions (found by their session). The website's 12 routes check the role early and pass on; `/api/referral-agent/me` still makes the referral link and QR code, from FastAPI's `referral_code`. Owner's decisions (2026-11-02): **the partner list** gives full rows only to the partner managers (`inhouse_supervisor`, `director`, `admin`) and `id`, `name`, `status` to the other six roles, whose pages use only those; **policy Q1**: a partner's page shows a `regional_recruiter` or `country_supervisor` only the partner's candidates in their own candidate scope (`core/scope.py`), the managers all of them. No grant changes. Tests: `tests/test_partner_area_reads.py` (34: every endpoint for every role, both decisions, keys, totals, one agent never sees another's), `src/lib/partner-area-reads.test.ts`. The Prisma allow-list is down to 53 files. Rollback: revert; no migration |
| R3 | Done (this PR). FastAPI answers every recruitment-operations read (`app/api/v1/dashboards.py`): the management KPIs (`/kpi`) and report metrics, a recruiter's target progress, a referral agent's targets against referrals, the country supervisor's overview, recruiters, recruiter detail and team targets, the in-house supervisor's overview, campaigns and country supervisors, the report list and detail, the consolidation preview and staff KPI targets against actuals. `kpi.ts`, `reportConsolidation.ts` and `reportWorkflow.ts` are ported (`app/services/kpi.py`, `report_reads.py`), formula for formula, with percentages rounded half up as JavaScript's `Math.round`, and removed from the website; the target-manager rule reuses `targets.py`'s `can_manage`. Dates leave FastAPI as Prisma writes them (`…000Z`), since the pages read them with `new Date()`. 16 website routes pass on. The two in-house supervisor routes planned for R6 moved here, because they use the same KPIs. Changes: an unparseable date, or an unknown cadence or cycle, is a 422 instead of a 500; "today" and "this month" are UTC, as the website's server computed them; rows that had no order are oldest first. Tests: `tests/test_dashboards.py` (32), `src/lib/dashboard-reads.test.ts`. The Prisma allow-list is down to 33 files. Rollback: revert; no migration |
| R4 | Done (this PR). FastAPI answers the candidate pipeline's reads (`app/api/v1/pipeline_reads.py`): the staff candidate list (scope, search, filters, sorting, paging, the opportunity filter options, HR's attention signals and summary, and the recruiter's report window) and detail (each application's required documents, the screening failures), a candidate's thread and own profile, the application lists (staff, paged; a candidate's own, with required documents) and detail, a partner's own submissions and HR's partner-submission queue and detail. The nested selects are built with `app/api/shapes.py` (Prisma's keys, dates with the `Z`); `opportunityFilters.ts` and `candidateSignals.ts` are ported (`app/services/opportunity_filters.py`), document completeness and the screening gate reuse the pipeline's ports. Owner's decisions (2026-11-02): **Q2**, HR and operations see every partner submission (as the 2026-07-31 separation-of-duties decision has them global); **Q3**, an in-house supervisor opens an application only in their own countries. Also: **a route's own refusal of a record (a 403 `ApiError`) is now on the audit trail as `access_denied`** (gap G7), recorded centrally (`app/core/api.py`) as the website's `forbidden()` did; before, FastAPI recorded only refusals by role. 10 website routes pass on; `candidateSignals.ts`, `documentCompleteness.ts` and `screening.ts` are removed (FastAPI has tested ports). Moved to R5: `rejected-submissions` (its rejection dates come from the audit trail, which FastAPI's role may not read: a decision for R5, with the cases audit-log page), and `scope.ts` and `opportunityFilters.ts`, which cases still use. Changes: an unknown status or source is a 422 instead of a 500; sort ties are broken by id. Tests: `tests/test_pipeline_reads.py` (37, including the checks moved from the website's `partner-drafts` and `resource-authorization` integration tests), `src/lib/pipeline-reads.test.ts`. The Prisma allow-list is down to 25 files. Rollback: revert; no migration |
| R5 | Done (this PR). FastAPI answers the rest of the pipeline's reads (`app/api/v1/case_reads.py`): the case list (scope, active unless asked, filters, search, sorting, paging, the opportunity filter options) and detail, a case's contract and history, exceptions by tier, rejected submissions, and whether a signed-in user may have a document's download link. **Owner's decision (2026-11-02): the audit trail stays unreadable to `vertex_api`**; FastAPI reads what the two pages show through functions with the owner's rights (migration 0008, granted to `vertex_api` alone in `db-roles.sql`): `vertex_case_trail(case_id)` returns a case's rows without their before/after snapshots, `vertex_rejection_dates(entity_type, ids)` only when each submission was rejected. A download link is still signed by the website, which alone holds the link key: FastAPI checks access, records `document_link_issued` and gives the website (not a direct caller) the storage key. 7 website routes pass on; `opportunityFilters.ts` is removed; `scope.ts` moves to R6, which the case payments route still uses it for. Changes: if FastAPI can't be reached, a document isn't served (503), since the website no longer reads the `Document` row to tell an infected file from a clean one; an unknown stage, source, status, escalation level or category is a 422 instead of a 500; sort ties are broken by id. Tests: `tests/test_case_reads.py` (including the checks moved from the website's `resource-authorization` integration test and `security-events`' document-link half), `tests/test_db_roles.py` (the functions: only `vertex_api` may run them, and it still can't `SELECT` the trail), `src/lib/case-reads.test.ts`; `verify-stack.sh` checks the grant live. The Prisma allow-list is down to 16 files. Rollback: revert, then `alembic downgrade 0007` (drops the two functions; nothing else changes) |
| R6 | Done (this PR). FastAPI answers the payment and user reads (`app/api/v1/payment_reads.py`): a case's payments (the case's own access check), a user's own payments, the consultation bookings for Operations and Finance, Finance's payments-due worklist (the fee policy, the stage amounts with `stripe_pricing.payment_stage_amounts` and the trigger-stage rule, as `paymentSchedule.ts`) and the staff directory for admin and director (`GET /users`: staff by default, a search over every user, a role narrowing it). 5 website routes pass on. `scope.ts` and its test are removed: FastAPI's `app/core/scope.py` is the only copy of the access rules, and `tests/test_scope.py` pins them instead of comparing with the website's. Changes: an unknown role in the directory is a 422 instead of a 500; ties in an order are broken by id. Tests: `tests/test_payment_reads.py`, `src/lib/payment-reads.test.ts`. The Prisma allow-list is down to 10 files, R7's and R8's. Rollback: revert; no migration |
| R7a | Done (this PR). D3 A: the website records its own few events (its rate limit, its early role check, download links, exports) through a service-only `POST /api/v1/audit-events` (`app/api/v1/audit_events.py`; the actor is the session's user, never the body's; an export is refused with 503 if it can't be recorded, fail closed as before), and **`vertex_web` loses `SELECT` and `INSERT` on `AuditLog`**: FastAPI is its only writer, and nothing runs on the website's role can forge or read a row. The alert monitor moves to FastAPI (`app/services/security_monitor.py`, rule for rule), fed by `record_security_event()`, the users routes (privilege granted) and the scanner (unreachable). Its counts come from `vertex_security_count` (migration 0009, the owner's narrow-functions decision of 2026-11-02): a number for the four questions the rules ask, any other refused. FastAPI gets a mailer and the backend gets the `SMTP_*` and `SECURITY_ALERT_EMAILS` settings; alert emails go out off the request. Website: `security-monitor.ts`, `auditedPrisma` (no callers since the write migration), the alert helpers in `auth-backend.ts` and `sendSecurityAlertEmail` are removed. Found and fixed on the way: a security event whose detail had a key named like the log line's own fields (`actor_id`) was silently dropped. Tests: `tests/test_security_monitor.py` (the checks of the website's `security-events` and `audit-access` integration tests, now against FastAPI), `tests/test_db_roles.py`; `verify-stack.sh` rows for the count function and the website's lost access. The Prisma allow-list is down to 8 files. Rollback: revert, then `alembic downgrade 0008` |
| R7b | In progress, in batches. Owner's choices (2026-11-03): FastAPI sends every email, the receipt PDF with fpdf2, and the contact form, the public intake form and the case invoice move too. #173 fixed the receipt's own settings meanwhile. **Batch 1 (this PR): the account links and the candidate invite.** The templates are lib/email.ts's own, captured mechanically (`vertex/src/lib/email-templates.test.ts` runs each sender with `{{placeholders}}` and pins `vertex_be/app/assets/email_templates.json`), so they can't drift while both exist. `app/services/emails.py` fills them (values HTML-escaped, which lib/email.ts didn't do), applies an admin's `EmailTemplate` override by event, and `deliver()` sends the kinds it has (`SENT_HERE`) off the request after the write has committed, returning the rest in `notify`. Kinds moved: `email_verification`, `password_reset`, `account_setup`, `candidate_invite` (FastAPI now signs the invite, keyed from `JWT_SECRET` as before), `referral_agent_application`. New setting `APP_URL` (the stack's `NEXT_PUBLIC_APP_URL`). `test_notices.py` checks each kind is sent by exactly one side. **Batch 2: the 18 kinds that only fill in values** (applications, candidates, cases, partners, referral agents and commissions). The generator passes neutral tokens so a value a sender transforms keeps its name; FastAPI computes the same transforms (`friendly_status`, `friendly_stage` with `CASE_STAGE_LABELS`, which a test compares with `caseStages.ts`, and `locale_number` for JavaScript's `toLocaleString`). `application_confirmation` has two templates (with and without an account). The two staff notifications go to `PARTNER_SUBMISSION_NOTIFY_EMAIL` and `REFERRAL_AGENT_NOTIFY_EMAIL`, now the backend's settings; unset, they're skipped as before. Every `notify` return calls `deliver()`. **Batch 3: the last 4 kinds; the website sends no notice now.** `case_reminder` has a template per channel, with and without its message; `consultation_booked` one each with or without the name and the phone (lib/email.ts left those rows out), to the backend's new `CONSULTATION_NOTIFY_EMAIL`; `milestone_payment_link` keeps the plan's row as two `parts` (current, upcoming) that FastAPI fills per stage, escaped, and puts in as `{{planRows}}`; `payment_receipt` is lib/invoice.ts's email, with the PDF drawn by fpdf2 (`app/services/receipt.py`, the same page; text beyond Latin-1 becomes "?" where pdf-lib threw) and attached. `NOTICE_SENDERS` and `sendNotices` are gone from `lib/pipeline.ts`; `notify` is always empty, and one that isn't is logged by kind (`email.unsent_notice`). `test_notices.py` now checks FastAPI sends every kind. Still the website's: the contact form, the public intake form with its confirmation, and the case invoice; then `email.ts` and `invoice.ts` go. Rollback: revert |
| R7c | Done (this PR). D5 A: the backup export moves to FastAPI (`app/services/backup.py`, `app/api/v1/backup.py`): the catalogue, the full and custom exports (the same ZIP: one CSV per table, `relationships.csv`, `manifest.json`, `README.txt`), the record picker and the candidates CSV, with the same roles, categories, row filters, excluded columns and formula guarding. The catalogue reads the backend models' metadata instead of Prisma's, so relationship names are the models' (`User.direct_reports` where Prisma said `reports`); every preset of the export page resolves. `AuditLog` stays out (#174), and `JobMilestonePrice`, which Prisma's schema lacks, joins Jobs & Programmes for admin and director. Each export is recorded before its data leaves, and refused (503) if it can't be. The website passes the files through (`passFile()` in `lib/backend.ts`); `server/backup/*` and `lib/zip.ts` are removed. Tests: `tests/test_backup.py` (the checks of `exporter.test.ts`, plus the routes, roles and audit records). The Prisma allow-list is down to 4 files. Rollback: revert; no migration |
| R7d | Done (this PR). D2 A: the website's `getAuthUser` checks the access token's signature and expiry only and returns its claims; `loadSession()`, its database query, is removed. FastAPI's `current_user` checks the live session on every data call (the user exists, `token_version` matches, the family is live), and every read and write is FastAPI's since R7c, so a revoked, deleted, demoted or re-passworded user gets no data from the next request; for at most the access token's 15 minutes they may still see a page's frame. **`vertex_web` loses `SELECT` on `RefreshToken`** (`db-roles.sql`, `verify-stack.sh`). Website: `session-revocation.integration.test.ts` and `test-session.ts` are removed (its database cases are FastAPI's, in `tests/test_auth.py`); `src/lib/session-check.test.ts` pins what the website checks. The Prisma allow-list is down to 3 files: `email.ts` (R7b) and R8's two seed helpers. Rollback: revert |
| R8 | Not started. After R7b |
