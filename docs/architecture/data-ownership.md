# Data ownership map (G8, backend migration Phase 1)

**Status: approved by the owner, 2026-10-13** (order in §5 and table decisions; see §7).

This map lists every table in the database, which service writes it today,
and the order in which each area moves to FastAPI. It goes with the
backend migration plan (13 Oct 2026). The decision behind it: FastAPI
becomes the single backend, area by area, and **every table has exactly
one writer at any time, enforced by database grants**.

## 1. Summary

| | |
|---|---|
| Tables | **47** business tables, plus `alembic_version`, at Alembic head `0005` (staging, 2026-10-13). The release checklist's "46 tables" is main at `0001`; `0005` adds `RefreshToken` |
| Enums | 35. Owned by Alembic like the tables; each area's enums move with it |
| Triggers | 3: `AuditLog` `audit_log_no_update` and `audit_log_no_delete` (append-only), `User` `user_token_version_bump` (ends sessions on a password or role change) |
| Writer today | **Next.js** for 40 tables. **No writer** for 7 tables (§2.4). FastAPI writes nothing: its only query is the health check's `SELECT 1` |
| Writers outside the app | Alembic migrations (schema and backfills), `deploy/sessions-kill-switch.sh` (`RefreshToken`, `AuditLog`, as the superuser), `prisma/seed.ts` (reference data, dev and CI only) |

**How this was built.**
- **Tables, enums and triggers:** read from the database catalogue at head.
- **Writers and readers:** found by scanning every non-test Next.js file for Prisma calls (`prisma.`, `tx.`, the `auditedPrisma(...)` client), plus nested writes (a related record created inside another write).
- **Grants:** read with `has_table_privilege` for both app roles.
- **Cross-area links:** read from the foreign keys.

The per-table result is in §6. The scan doesn't see raw SQL, but the app has
none (`$queryRaw`/`$executeRaw`: 0 uses).

## 2. Findings that change the plan

### 2.1 The one-writer rule isn't enforced yet

`vertex_api` holds `INSERT, UPDATE, DELETE` on **every business table**,
`User` included. It has none on `RefreshToken`, and only `INSERT` on
`AuditLog`. FastAPI never uses these rights, but a compromised backend
could. As a result, two of the plan's Phase 2 tests would fail today:
- "vertex_api cannot write `RefreshToken` or `User.token_version`": it can write `User`.
- "one writer per table": both roles can write 45 tables.

**Proposed:** reduce `vertex_api` to `SELECT` plus audit `INSERT`, and grant writes only at each handover.

**Owner's decision (2026-10-13): leave `vertex_api`'s grants as they are.**
Consequences:
- The one-writer rule is enforced **on the website's side only**: at each handover (Phase 4 step 7), `vertex_web` loses its write grants on the area's tables, and `test_db_roles.py` proves it can no longer write them.
- For tables Next.js still owns, the rule stays a convention on FastAPI's side: FastAPI code must not write them. Code review checks this, and FastAPI writes only through the audited write helper (Phase 2 step 6).
- The plan's Phase 2 test "vertex_api cannot write `User.token_version`" can't pass under this decision and is dropped. "vertex_api cannot write `RefreshToken`" still holds and stays.
- **Residual risk, accepted:** a compromised backend container could change any business table, including `User` roles. The decision can be revisited at any time; the change is a few lines in `db-roles.sql`.

### 2.2 The candidate pipeline is one unit, not three

The plan lists three separate areas: Candidates and documents (#4),
Applications and cases (#5) and Partners (#3). Handlers write across all
three, **in both directions**:

| Handler | Its area | Also writes |
|---|---|---|
| `POST /api/applications` | Applications | `Candidate` (create or update; lifecycle → submitted) |
| `POST /api/cases/[id]/reject` | Cases | `Candidate` (lifecycle → rejected), `Application` |
| `PUT /api/candidates/[id]/application` | Applications | `PartnerCandidate` (job, travel date, visa history) |
| `POST /api/candidates/[id]/messages` | Candidates | `PartnerCandidate` (submitted → under review when HR replies) |
| `/api/partner/candidates`, `/api/partner/candidates/[id]` | Partners | `Candidate`, `Application` |
| `/api/partner-candidates/[id]`, `.../create-case` | Partners | `Candidate` (bridge, delete) |

The constraint is one-directional:
- **Next.js can call FastAPI** (`callBackend()`, Phase 3), so a handler that stays in Next.js can write a FastAPI-owned table *through* FastAPI.
- **FastAPI never calls back into Next.js.**

So an area can move only once every table its handlers write is already
owned by FastAPI or moves with it. With these mutual writes, whichever of
the three moves first would have FastAPI writing a table Next.js still owns.

**Proposal:**
- Treat `Candidate`, `Document`, `CandidateMessage`, `Application`, the case tables and `PartnerCandidate` as **one ownership handover: the "candidate pipeline"**.
- Build and switch it in sub-steps behind flags, in the order candidates, then applications and cases, then partner candidates.
- Hand over the write grants for the whole cluster in one release.
- `Partner`, `EmployerClient` and the referral-agent tables stay a small, separate **Partners** area that can move early.

### 2.3 Accounts are created from three places

`User` is written by:
- account flows: register, password reset, email verification, Google sign-in;
- the admin user pages;
- **partner account provisioning and deletion** (`/api/admin/partners/[id]/provision-account`, `/api/admin/partners/[id]`).

Users and sessions moves **last**. Partner provisioning, a partner's
contact-email change (which re-points their login) and a partner delete
each write both the `Partner` and its `User`, and approving a referral agent
does the same for `ReferralAgent`.

**Owner's decision (2026-10-27): `Partner` and `ReferralAgent` move with
Users and sessions,** not before. Splitting each of those actions across two
services (Next.js writes the `User`, FastAPI the `Partner`) would make one
click two separate commits, with undo logic when the second fails, and
every partner feature built twice. `EmployerClient`, which has no login,
moved on its own (step 4.1).

`POST /api/auth/register` creates the `User` and, for candidates, the
`Candidate`. After the pipeline moves, it creates the `Candidate` through
FastAPI.

### 2.4 Seven tables have no writer in the code

`JobPosition`, `JobSector`, `JobPaymentStage`, `ReferralAgent`,
`ReferralAgentTarget`, `ReferralCommission` and `ReferralCommissionRule`
exist in the FastAPI models and the schema, but have **no Prisma model and
no writer**. Live foreign keys point at them:
- `Application.job_position_id` and `PartnerCandidate.job_position_id` → `JobPosition`;
- `Candidate.referral_agent_id` → `ReferralAgent`;
- `CasePayment.job_payment_stage_id` → `JobPaymentStage` (`ON DELETE RESTRICT`).

Three of them **hold data on main** (backup `20261013T044556Z`): `JobPaymentStage` 96 rows, `JobPosition` 78, `JobSector` 30. The four referral tables are empty.

**Owner's decision (2026-10-13): keep all seven.** They belong to the areas in §3, with FastAPI as the owner when their area moves. Until then, nothing writes them.

### 2.5 Shared, append-only: `AuditLog`

Both services insert audit rows, and nothing updates or deletes them
(triggers). The one-writer rule doesn't apply: it is about conflicting
updates, and an append-only table has none. Grants stay `INSERT` (plus
`SELECT` for Next.js, which serves the admin audit pages) until those pages
move.

**Owner's decision (2026-10-26): every FastAPI write is audited.** Each
table FastAPI owns is in `AUDITED_MODELS` (`app/core/audit.py`, mirrored in
`audit.ts`), and its routes write through `AuditedDb`, so every create,
update and delete records the actor and the before/after snapshots in the
same transaction. `tests/test_audit_coverage.py` fails if a table joins the
FastAPI-owned list in `db-roles.sql` without being audited. What Postgres
does to other tables on a delete (`SET NULL`, `CASCADE`) is not recorded.

## 3. Areas and owners

"Today" is the service that writes in practice; "Target" is the owner once the area moves.

| Area | Tables | Today | Target | Notes |
|---|---|---|---|---|
| Reference data | `Country`, `Region`, `Sector`, `DocumentRequirementType`, `CountryDocumentRequirement`, `FeePolicy`, `SystemSetting` | **FastAPI: `FeePolicy`** (handed over 2026-10-24, step 1.2), **`Region`, `Country`** (step 2.1), **`Sector`, `CountryDocumentRequirement`** (step 2.2), **`SystemSetting`** (step 2.3), **`DocumentRequirementType`** (step 3.2, with jobs, because job writes create its receipt types) | FastAPI | Read by 17+ handlers; reads may stay in Next.js |
| Content | `Job`, `JobPaymentStage`, `JobSector`, `JobPosition`, `EmailTemplate`, `KnowledgeArticle` | **FastAPI: `KnowledgeArticle`, `EmailTemplate`** (step 3.1), **`Job`, `JobPaymentStage`** (step 3.2, with Stripe pricing), **`JobSector`, `JobPosition`** (step 3.3) | FastAPI | Public job pages: public-register rules. Chat reads `SystemSetting` and `KnowledgeArticle` |
| Partners | `Partner`, `EmployerClient`, `ReferralAgent`, `ReferralAgentTarget` | **FastAPI: `EmployerClient`** (step 4.1), **`ReferralAgentTarget`** (step 8.1, `users-handover.md`). Next.js: `Partner`, `ReferralAgent`, which move with Users and sessions (§2.3) | FastAPI | The `User` half of partner accounts stays in Next.js until Users moves (§2.3) |
| Recruitment operations | `Campaign`, `CampaignTarget`, `RecruiterTarget`, `RecruiterNote`, `Report`, `StaffKpiTarget`, `StaffScorecard`, `StaffScorecardArea` | **FastAPI: `Campaign`, `CampaignTarget`** (step 5.1), **`RecruiterTarget`, `StaffKpiTarget`, `RecruiterNote`** (step 5.2), **`StaffScorecard`, `StaffScorecardArea`** (step 5.3), **`Report`** (step 5.4: submit, verify, return, resubmit; the list, detail and consolidation preview still read it in Next.js) | FastAPI | Writes only its own tables; reads candidates and cases for KPIs |
| Candidate pipeline | `Candidate`, `Document`, `CandidateMessage`, `PartnerCandidate`, `Application`, `Case`, `CaseStageEvent`, `CaseReminder`, `Contract`, `Exception`, `ExceptionCorrectiveAction`, `RetentionFollowUp`, `ReferralCommission` | **FastAPI: all of them** (step 6.7, the switch; `docs/architecture/pipeline-handover.md`). Next.js keeps the reads (lists, detail pages, dashboards) and sends the pipeline's emails | FastAPI | One handover (§2.2). Documents are stored in each local stack's MinIO, main included (owner's decision 2026-10-29, E2) |
| Payments and finance | `CasePayment`, `JobMilestonePrice`, `Payment`, `ConsultationBooking`, `ReferralCommissionRule`. `JobPaymentStage` moved with jobs (step 3.2); `ReferralCommission` with the pipeline (step 6.7) | **FastAPI: `ReferralCommissionRule`** (step 7.1, `payments-handover.md`), **`Payment`, `ConsultationBooking`** (step 7.2: the Stripe webhook, passed on by Next.js, and PayPal; now audited, G22), **`CasePayment`** (step 7.3: record, Stripe link, invoice, check-status, mark-paid, receipt, delete), **`JobMilestonePrice`** (step 7.4: kept with its data, writes revoked from Next.js). Next.js: none | FastAPI | Stripe webhook and PayPal capture move with audited writes (G22) |
| Users and sessions | `User`, `RefreshToken`, `InhouseCountryAssignment` | **FastAPI: `RefreshToken`** (step 8.2: FastAPI issues sessions). Next.js: `User` (FastAPI also writes it for Google linking until 8.4, E10), `InhouseCountryAssignment` | FastAPI | Last: FastAPI becomes the session issuer. Plan: `users-handover.md` (with `Partner`, `ReferralAgent`, `ReferralAgentTarget`) |
| Audit | `AuditLog` | both (insert only) | both (insert only) | §2.5 |

## 4. Cross-area dependencies

**Writes across areas** decide the order: a FastAPI handler may only write
tables FastAPI owns.

With the areas in §3, only three handlers still write across areas, and all of them involve `User`:

| Handler | Writes | Resolution |
|---|---|---|
| `/api/admin/partners/[id]`, `.../provision-account` | `Partner` + `User` | Moves with Users and sessions (owner's decision, §2.3) |
| `/api/auth/register` | `User` + `Candidate` | Next.js creates the `User`, then FastAPI claims the `Candidate` for it (`POST /api/v1/candidates/claim`, step 6.7); a failed claim removes the `User` again |

**Foreign keys across areas** don't block a move: a service may read and
reference rows it doesn't own. But **`ON DELETE CASCADE` across areas is a
hidden write.** Deleting a `User` (Users area) deletes its `Candidate`,
`CandidateMessage`, `Payment` and staff rows in other areas. Such deletes
stay possible only through the parent's owning service, and are audited.

Number of foreign keys from one area to another:

| From \ to | Users | Reference | Content | Partners | Pipeline |
|---|---|---|---|---|---|
| Candidate pipeline | 12 | 9 | 4 | 3 | — |
| Payments and finance | 5 | 1 | 3 | 1 | 4 |
| Recruitment operations | 10 | 3 | — | — | — |
| Partners | 4 | 1 | — | — | — |
| Content | — | — | — | 1 | — |
| Reference data | 1 | — | — | — | — |
| Users and sessions | — | 2 | — | — | — |

## 5. Proposed order

| # | Area | Why this position |
|---|---|---|
| 1 | **Reference data** | Admin-only writes, no cross-area writes. Proves the pattern at the lowest risk |
| 2 | **Content** | No cross-area writes. Public job pages test the public-endpoint rules; chat stays rate-limited |
| 3 | **Partners** (`Partner`, `EmployerClient`, referral agents) | Small; Q1 decided. Partner accounts orchestrated by Next.js (§2.3). Partner *candidates* go with the pipeline |
| 4 | **Recruitment operations** | Writes only its own tables, so it can move early. Moved up from #6: its links to candidates and cases are reads only |
| 5 | **Candidate pipeline** | Core personal data; one handover (§2.2); Q2 and Q3 decided. Moved in step 6.7; documents in MinIO on every local stack (owner, 2026-10-29) |
| 6 | **Payments and finance** | Highest risk; depends on cases. Stripe and PayPal move with audited writes (G22) |
| 7 | **Users and sessions** | Last: FastAPI becomes the session issuer; Next.js stops signing sessions |

**Differences from the plan's default order:**
- Partners is split: partner candidates go with the pipeline.
- Recruitment operations moves before the pipeline.
- Candidates and documents and Applications and cases are combined into one handover.

These need the owner's decision.

## 6. Per-table detail

Generated by scanning the code on 2026-10-13 (`main` = `3ba47af`). Writers
show the operations each handler uses. Run the scan again when the map is
updated.

### Reference data

| Table | Writers today (Next.js) | Readers today |
|---|---|---|
| `Country` | **FastAPI** `/api/v1/countries` (create), `/api/v1/countries/{id}` (update, delete); Next.js's `/api/admin/countries` routes pass requests on; `vertex_web` has no write grant (step 2.1) | 17 files, incl. `/api/admin/countries/[id]/document-requirements`, `/api/admin/countries/[id]`, `/api/admin/countries`, `/api/admin/users/[id]`, … |
| `Region` | **FastAPI** `/api/v1/regions` (create), `/api/v1/regions/{id}` (update); Next.js's `/api/admin/regions` routes pass requests on; `vertex_web` has no write grant (step 2.1) | `/api/admin/countries/[id]`, `/api/admin/countries`, `/api/admin/regions/[id]`, `/api/admin/regions` |
| `Sector` | **FastAPI** `/api/v1/sectors` (create), `/api/v1/sectors/{id}` (delete); Next.js's `/api/admin/sectors` routes pass requests on; `vertex_web` has no write grant (step 2.2) | `/api/admin/sectors/[id]`, `/api/admin/sectors` |
| `DocumentRequirementType` | **FastAPI** `/api/v1/document-types` (create), `/api/v1/document-types/{id}` (delete), and `/api/v1/jobs` (a receipt type per payment stage); Next.js's `/api/admin/document-types` writes pass requests on; `vertex_web` has no write grant (step 3.2) | `/api/admin/document-types/[id]`, `/api/admin/document-types`, `/api/apply/options`, `/api/upload`, `server/services/documentCompleteness.ts` |
| `CountryDocumentRequirement` | **FastAPI** `/api/v1/countries/{id}/document-requirements` (replace the list); Next.js's route passes requests on; `vertex_web` has no write grant (step 2.2) | `/api/admin/countries/[id]/document-requirements`, `/api/apply/options`, `server/services/documentCompleteness.ts` |
| `FeePolicy` | **FastAPI** `POST /api/v1/fee-policy` (create, update; audited). Next.js's `/api/fee-policy` POST passes requests on (`callBackend()`); `vertex_web` has no write grant (`db-roles.sql`) | **FastAPI** `GET /api/v1/fee-policy`, which Next.js's `/api/fee-policy` passes on (step 1.3). Still read directly by Next.js (`SELECT` kept), moving with Payments: `/api/cases/[id]/payments/invoice`, `/api/cases/[id]/payments/link`, `/api/cases/[id]/payments`, `/api/finance/payments-due` |
| `SystemSetting` | **FastAPI** `/api/v1/settings` (upsert); Next.js's `/api/admin/settings` passes requests on; `vertex_web` has no write grant (step 2.3) | `/api/admin/settings`, `/api/apply/options`, `/api/chat` |

### Content

| Table | Writers today (Next.js) | Readers today |
|---|---|---|
| `Job` | **FastAPI** `/api/v1/jobs` (create), `/api/v1/jobs/{id}` (update, delete); Next.js's `/api/jobs` writes pass requests on; `vertex_web` has no write grant (step 3.2) | 9 files, incl. `/api/applications`, `/api/candidates/[id]/application`, `/api/partner/candidates`, `/api/payments/paypal/capture-order`, … |
| `JobPosition` | **FastAPI** `/api/v1/jobs/{id}/sectors/{sectorId}/positions` (create), `…/positions/{positionId}` (update, delete), and with its sector; Next.js's routes pass requests on; `vertex_web` has no write grant (step 3.3) | `/api/applications`, `/api/candidates/[id]/application`, `/api/partner/candidates/[id]`, `server/services/partnerCandidateSubmission.ts` |
| `JobSector` | **FastAPI** `/api/v1/jobs/{id}/sectors` (create), `/api/v1/jobs/{id}/sectors/{sectorId}` (delete); Next.js's routes pass requests on; `vertex_web` has no write grant (step 3.3) | `/api/jobs/[id]`, `server/services/publicJobs.ts` |
| `EmailTemplate` | **FastAPI** `/api/v1/email-templates` (upsert); Next.js's `/api/admin/emails` passes requests on; `vertex_web` has no write grant (step 3.1) | `/api/admin/emails`, `lib/email.ts` |
| `KnowledgeArticle` | **FastAPI** `/api/v1/knowledge` (create), `/api/v1/knowledge/{id}` (delete); Next.js's `/api/admin/knowledge` passes requests on; `vertex_web` has no write grant (step 3.1) | `/api/admin/knowledge`, `/api/chat`, page `/help` |

### Partners

| Table | Writers today (Next.js) | Readers today |
|---|---|---|
| `Partner` | `/api/admin/partners/[id]/provision-account` (update)<br>`/api/admin/partners/[id]` (delete, update)<br>`/api/admin/partners` (create) | 10 files, incl. `/api/admin/backup/partners-csv`, `/api/admin/partners/[id]/provision-account`, `/api/admin/partners/[id]/reset-password`, `/api/admin/partners/[id]`, … |
| `EmployerClient` | **FastAPI** `/api/v1/employer-clients` (create), `/api/v1/employer-clients/{id}` (update); Next.js's routes pass requests on; `vertex_web` has no write grant (step 4.1) | **FastAPI** (the same routes, list and detail) |
| `ReferralAgent` | `/api/referral-agents/register` (create), `/api/referral-agents/verify-email` (update), `/api/admin/referral-agents/[id]` and `…/approve` (update). Moves in step 4.3 | `/api/admin/referral-agents`, … |
| `ReferralAgentTarget` | **FastAPI** `/api/v1/referral-agents/{id}/targets` (create, audited); Next.js's POST passes requests on; `vertex_web` has no write grant (step 8.1, `users-handover.md`) | `/api/admin/referral-agents/[id]/targets` (target vs actual) |

### Recruitment operations

| Table | Writers today (Next.js) | Readers today |
|---|---|---|
| `Campaign` | **FastAPI** `/api/v1/campaigns` (create), `/api/v1/campaigns/{id}` (update, delete); Next.js's `/api/campaigns` routes pass requests on; `vertex_web` has no write grant (step 5.1) | `/api/campaigns/[id]`, `/api/campaigns/[id]/targets`, `/api/campaigns`, `/api/inhouse/campaigns` |
| `CampaignTarget` | **FastAPI** `/api/v1/campaigns/{id}/targets` (create), `…/targets/{targetId}` (delete), and with its campaign; audited since step 5.1; `vertex_web` has no write grant | `/api/campaigns/[id]/targets/[targetId]`, `/api/inhouse/overview`, `/api/recruiter-targets`, `/api/supervisor/recruiters/[id]`, `/api/supervisor/team-targets`, `server/services/kpi.ts` |
| `RecruiterTarget` | **FastAPI** `/api/v1/recruiter-targets` (upsert), and with its campaign target; Next.js's route passes requests on; `vertex_web` has no write grant (step 5.2) | **FastAPI** `/api/v1/recruiter-targets`; `/api/supervisor/recruiters/[id]`, `/api/supervisor/team-targets`, `server/services/kpi.ts` |
| `RecruiterNote` | **FastAPI** `/api/v1/recruiter-notes` (create); Next.js's route passes requests on; `vertex_web` has no write grant (step 5.2) | **FastAPI** `/api/v1/recruiter-notes` |
| `Report` | **FastAPI** `/api/v1/reports` (submit, consolidating verified children), `/api/v1/reports/{id}/verify`, `/return`, `/resubmit`; Next.js's routes pass requests on; `vertex_web` has no write grant (step 5.4) | 9 files, incl. `/api/inhouse/overview`, `/api/reports/[id]/resubmit`, `/api/reports/[id]/return`, `/api/reports/[id]`, … |
| `StaffKpiTarget` | **FastAPI** `/api/v1/staff-kpi-targets` (upsert; labels checked against `app/core/report_templates.py`, a tested copy of `REPORT_KPI_LABELS`); `vertex_web` has no write grant (step 5.2) | `server/services/kpi.ts` (`GET /api/staff-kpi-targets`, targets vs actuals, until the pipeline moves) |
| `StaffScorecard` | **FastAPI** `/api/v1/staff-scorecards` (draft upsert), `/api/v1/staff-scorecards/{id}` (finalize: score, category, action); Next.js's routes pass requests on; `vertex_web` has no write grant; audited since step 5.3 | **FastAPI** `/api/v1/staff-scorecards` |
| `StaffScorecardArea` | **FastAPI**, with its scorecard (step 5.3, audited) | none |

### Candidate pipeline

Written by **FastAPI** since the switch (step 6.7, `docs/architecture/pipeline-handover.md`); `vertex_web` has no write grant on any of these. The Next.js routes check the role early and pass the request on (`lib/pipeline.ts`), then send the emails FastAPI lists. Reads stay in Next.js.

| Table | Writer (FastAPI, `vertex_be/app/api/v1/…`) | Readers (Next.js) |
|---|---|---|
| `Candidate` | `candidates.py` (profile, staff edit and delete, status, registration's claim), `applications.py` (submission), `cases.py` (reject, overturn), `partner_submissions.py`, `documents.py` (submitted on the last upload) | 16 files, incl. `/api/admin/backup/candidates-csv`, `/api/candidates`, `/api/candidates/[id]` |
| `Document` | `documents.py` (upload, the form's upload, verify, scan when opened), `partner_submissions.py` (a draft's documents move to its candidate) | `/api/documents/[id]/signed-url`, `/api/documents/file`, the case payment receipts and invoices, … |
| `CandidateMessage` | `candidates.py` | `/api/candidates/[id]/messages`, `server/services/candidateSignals.ts`, … |
| `PartnerCandidate` | `partner_submissions.py`; `candidates.py` and `applications.py` (corrections keep its copy in step; HR's first message marks it under review) | `/api/partner-candidates`, `/api/partner/candidates`, … |
| `Application` | `applications.py`, `cases.py` (reject, overturn), `partner_submissions.py` | `/api/applications`, `/api/candidates/[id]`, … |
| `Case`, `CaseStageEvent` | `candidates.py` (approval opens the case), `partner_submissions.py` (create-case), `cases.py` | `/api/cases`, `/api/cases/[id]`, the dashboards |
| `CaseReminder`, `Contract`, `RetentionFollowUp` | `cases.py` | `/api/cases/[id]`, `/api/cases/[id]/contract` |
| `Exception`, `ExceptionCorrectiveAction` | `exceptions.py` | `/api/exceptions` |
| `ReferralCommission` | `app/services/referrals.py` (earned at the milestones), `referral_commissions.py` (approve, mark paid) | `/api/referral-agent/me`, `/api/admin/referral-commissions`, `server/services/kpi.ts` |

### Payments and finance

| Table | Writers today (Next.js) | Readers today |
|---|---|---|
| `CasePayment` | `/api/cases/[id]/payments/[paymentId]/check-status` (update)<br>`/api/cases/[id]/payments/[paymentId]/mark-paid` (update)<br>`/api/cases/[id]/payments/[paymentId]/receipt` (update)<br>`/api/cases/[id]/payments/invoice` (create)<br>`/api/cases/[id]/payments/link` (create)<br>`/api/cases/[id]/payments` (create)<br>`/api/webhooks/stripe` (update) | `/api/cases/[id]/payments/[paymentId]/check-status`, `/api/cases/[id]/payments/[paymentId]/mark-paid`, `/api/cases/[id]/payments/[paymentId]/receipt`, `/api/cases/[id]/payments`, `/api/webhooks/stripe` |
| `JobMilestonePrice` | FastAPI only (payments step 7.4); no code writes it today: Prisma dropped its model in migration 0006, and stage pricing lives on `JobPaymentStage` | read-only reporting (`readonly-columns.sql`) |
| `JobPaymentStage` | **FastAPI** `/api/v1/jobs` and `/api/v1/jobs/{id}` (the stages, updated in place), `app/services/stripe_pricing.py` (Stripe ids, after a save and on `/api/v1/jobs/{id}/stripe-pricing/sync`); `vertex_web` has no write grant (step 3.2) | `/api/jobs/[id]`, `/api/cases/[id]/payments/link`, payment routes |
| `Payment` | `/api/payments/paypal/capture-order` (create)<br>`/api/webhooks/stripe` (create) | `/api/applications`, `/api/payments/me`, `/api/webhooks/stripe` |
| `ConsultationBooking` | `/api/webhooks/stripe` (create) | `/api/consultation-bookings`, `/api/webhooks/stripe` |
| `ReferralCommissionRule` | **FastAPI** `/api/v1/referral-commission-rules` (upsert, step 7.1); `vertex_web` has no write grant | `/api/admin/referral-commission-rules`, FastAPI's `commission_if_due` |

### Users and sessions

| Table | Writers today (Next.js) | Readers today |
|---|---|---|
| `User` | `/api/admin/partners/[id]/provision-account` (create)<br>`/api/admin/partners/[id]/reset-password` (update)<br>`/api/admin/partners/[id]` (delete, update)<br>`/api/admin/users/[id]/reset-password` (update)<br>`/api/admin/users/[id]` (delete, update)<br>`/api/admin/users` (create)<br>`/api/auth/google/callback` (update)<br>`/api/auth/register` (create, update)<br>`/api/auth/reset-password` (update)<br>`/api/auth/verify-email` (update)<br>`lib/test-session.ts` (upsert) | 42 files, incl. `/api/admin/partners/[id]/provision-account`, `/api/admin/partners/[id]`, `/api/admin/users/[id]/reset-password`, `/api/admin/users/[id]`, … |
| `RefreshToken` | **FastAPI** `app/services/sessions.py` through `/api/v1/auth/login`, `/auth/google`, `/auth/refresh`, `/auth/logout`, `/auth/sessions`, `/users/{id}/sessions`; the website's `/api/auth` routes pass requests on; `vertex_web` has no write grant (step 8.2, `users-handover.md`). Not row-audited (E9) | `lib/session.ts` (`loadSession`, every request) |
| `InhouseCountryAssignment` | `/api/admin/users/[id]` (createMany, deleteMany)<br>`/api/admin/users` (create (nested)) | `/api/admin/users/[id]`, `server/scope.ts` |

### Audit (cross-cutting)

| Table | Writers today (Next.js) | Readers today |
|---|---|---|
| `AuditLog` | `lib/audit.ts` (create)<br>`lib/security-monitor.ts` (create) | `/api/cases/[id]/audit-log`, `lib/security-monitor.ts` |

## 7. Owner's decisions (2026-10-13)

| # | Question | Decision |
|---|---|---|
| 1 | Order in §5, including the three differences from the plan | **Approved** |
| 2 | The seven tables with no writer in the code (§2.4) | **Keep all seven** |
| 3 | Reduce `vertex_api` to read-only until each handover (§2.1) | **No: leave as is.** Enforcement at handover is on `vertex_web`'s side; residual risk accepted |

## 8. Keeping this map current

- Every area handover (Phase 4 step 10) updates §3 and §6.
- From the first handover, `test_db_roles.py` reads the list of moved tables and fails if `vertex_web` can still write any of them.
