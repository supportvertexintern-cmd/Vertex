# Vertex CRM & Recruitment Operations Platform — Architecture & Delivery Plan

Status: **Draft for approval** — mirrors `Vertex_SRS_Platform_Phases_1-5.docx` (v1.0, 2 July 2026) and the approved Platform Gap Analysis (30 June 2026).
Scope: extend the existing Next.js/PostgreSQL platform into the full system of record. No parallel CRM, no rewrite.

---

## 0. What exists today (baseline)

Confirmed by reading the live codebase, not assumed:

| Area | Current state |
|---|---|
| Roles | `Role { candidate, admin }` only — binary |
| Auth | JWT (cookie `auth_token`) + bcrypt; `middleware.ts` protects `/dashboard` and `/admin` by path prefix |
| Candidate model | 1:1 with `User`, `user_id` required — no concept of a recruiter-sourced lead who hasn't registered |
| Application | 5 statuses (`submitted → under_review → interview → approved/rejected`), no case/stage tracking beyond that |
| Documents | Two ad-hoc string fields (`cv_file`, `passport_scan`) on `Candidate`; stored in Supabase Storage via `getPublicUrl` — **permanently public links, not signed** |
| Admin panel | One flat client component (`/admin/page.tsx`), tab-switched, `bg-slate-50` — generic Tailwind gray, disconnected from the brand system now live on the public site |
| API | Flat `/api/*`, no versioning, inconsistent response shapes (raw arrays in some routes, `{jobs: [...]}` in others) |
| Data access | Route handlers call `prisma.*` directly — no repository/service layer |
| Reporting/KPIs | None — admin shows raw counts only |
| Region/country/recruiter structure | None |

The gap analysis estimate stands: roughly the candidate-facing ATS half is built: the agent-network, control, and extended-lifecycle half is not.

---

## 1. Key architecture decisions

These are the calls that shape everything downstream. Flagging each with its rationale so they can be challenged before code is written.

### 1.1 Candidate vs. Lead — decouple `Candidate` from requiring a `User` login
**Decision:** make `Candidate.user_id` **nullable**. A Regional Recruiter can create a `Candidate` record directly (FR-2.1, "register candidates") for a person who hasn't signed up yet. Add `Candidate.source: self_registered | recruiter_sourced` and `Candidate.recruiter_id`. When the person later registers themselves (or the recruiter completes registration with them), the `User` row is created/linked and `user_id` is set.
**Why:** the pre-application lifecycle (`Identified → Screened → Guided to Apply → Submitted`) starts *before* the candidate has an account — that's the entire point of the screening gate (FR-2.5). Forcing a `User` row to exist at "Identified" would mean fabricating login credentials for people who haven't consented to an account, which is also a GDPR lawful-basis problem (NFR-5). This is the single biggest schema shift from the current model and touches the existing registration flow, so it's called out first.

### 1.2 Case is 1:1 with an approved `Application`, not with `Candidate`
**Decision:** `Case` is created when an `Application` reaches `approved`, carrying the 11-stage mobility journey (FR-4.1). `Candidate` can have multiple `Application`s over time (reapplying), but only approved ones spawn a `Case`.
**Why:** keeps the pre-application funnel (owned by recruiters) and the post-offer mobility lifecycle (permits, visas, travel) as distinct concerns with distinct owners, matching the SRS's own separation (Section 3a vs. 3b).

### 1.3 RBAC: six roles, one direct supervisor, central permission table
**Decision:** extend `Role` to `candidate | regional_recruiter | country_supervisor | inhouse_supervisor | director | admin`. Add `User.supervisor_id` (self-relation, nullable, required for all non-candidate/non-admin roles — "unity of command," FR-1.3). Partners/Employer Clients (Phase 5) turned out **not** to need any login/access model at all — the business confirmed there's no partner self-service portal (agency submissions still arrive by email; staff re-key them), so `Partner`/`EmployerClient` are plain staff-managed CRM records with no linked `User`, not a `PartnerUser`/scoped-access model as originally sketched here.
**Why:** a flat enum plus one lookup table (`lib/rbac.ts`) is enough for 6 roles; a full policy engine would be over-engineering at this scale. Centralizing it once means every new route/page checks the same source of truth instead of reimplementing "who can see what."

### 1.4 Row-level scoping lives in the service layer, not scattered in routes
**Decision:** every list/read that returns candidates, reports, or cases passes through a `scopeToRequester(user, baseWhere)` helper: a Regional Recruiter only ever sees their own candidates; a Country Supervisor sees their country; In-House/Director/Admin see everything (optionally filtered). This helper lives in one place (`src/server/scope.ts`) and every service calls it.
**Why:** this is the actual enforcement of least-privilege (FR-1.2, NFR-4). Duplicating "if role === X then where.recruiter_id = ..." across 20 route handlers is exactly how that kind of check silently rots.

### 1.5 Introduce a service/repository layer now, not later
**Decision:** new domain logic (screening gate, report consolidation, campaign target cascade, case-stage transitions, KPI aggregation) lives in `src/server/services/*.ts`, with route handlers reduced to: parse & validate (Zod) → call service → shape response. Repositories (`src/server/repositories/*.ts`) wrap Prisma only where there's real reuse (candidates, cases, reports) — not a blanket wrapper over every model.
**Why:** the current "route calls Prisma directly" pattern was fine for 5 CRUD-ish resources. It will not survive multi-role authorization, audit logging, and KPI aggregation without turning into copy-pasted logic across dozens of files. This is the backend-patterns Repository + Service Layer pattern, applied where the SRS's own complexity (NFR-3, NFR-6) justifies it — not applied reflexively to every model.

### 1.6 Audit logging via a Prisma extension, not manual calls
**Decision:** `AuditLog` (entity_type, entity_id, action, actor_id, before/after JSON, created_at, append-only) is written automatically by a Prisma Client extension (`$extends`) hooked on `create`/`update`/`delete` for the models the SRS requires auditing (Candidate status, Application, Case/CaseStage, Report, verification/approval actions) — not by scattering `await audit(...)` calls through every service method.
**Why:** NFR-6 asks for "comprehensive, immutable" audit logging. A manual-call approach is comprehensive only until someone forgets to add the call in a new code path; a client-level hook can't be forgotten.

### 1.7 Storage: private local disk + signed, time-limited URLs
**Decision (superseded during Phase 1):** the Supabase project referenced in `.env` turned out not to be accessible/owned by the business, and the confirmed real hosting target is cPanel Node hosting (matching SRS §2.3 and the existing `output: 'standalone'`), not Vercel. Storage is therefore local disk under `UPLOAD_DIR`, kept outside `/public` (never statically servable), with a custom signed-URL mechanism: a short-lived, single-purpose JWT (`signDocumentToken`/`verifyDocumentToken` in `lib/jwt.ts`) encoding the storage path, resolved by `GET /api/documents/file?token=...`, issued only after an RBAC check by `GET /api/documents/[id]/signed-url`. `@supabase/supabase-js` was removed as a dependency.
**Why:** this directly closes FR-1.6, which is explicitly a Phase 1 **Must**. Passport scans previously sat behind a permanent, guessable-if-leaked public URL. Local disk is viable here (unlike on Vercel's ephemeral serverless functions) because the app runs as a persistent Node process on cPanel.

### 1.8 Document backup: Cloudflare R2, not dual-write
**Decision:** local disk is the only *primary* store — every write goes there first, synchronously. R2 (S3-compatible, `lib/backup.ts`) receives a best-effort copy on every save/delete, and the read path in `lib/upload.ts` self-heals from R2 if a local file is ever missing, rewriting it back to disk. Backup and restore share one mechanism rather than being separate features. If R2 env vars are unset, backup/self-heal is silently skipped — local disk keeps working as the only copy.
**Why:** NFR-7 asks for automated backups with tested restores; a single cPanel disk is a real single point of failure for documents that are often irreplaceable (passport scans, medical records). A synchronous dual-write to two stores on every request was considered and rejected — it doubles the failure surface for every upload (what happens when local succeeds and R2 doesn't, or vice versa) for a benefit that a best-effort backup + self-healing read already delivers more simply.

### 1.8 API: keep the existing surface unversioned; extend the same convention
**Decision:** do **not** introduce `/api/v1/` and do not touch the shape of existing working routes (jobs, applications, payments, auth, chat). New domain routes (`/api/recruiters`, `/api/countries`, `/api/cases`, `/api/reports`, `/api/campaigns`, `/api/partners`) follow the same flat `/api/` convention, but adopt a consistent `{ data, meta? }` / `{ error: { code, message, details? } }` envelope and correct status codes (422 for validation, 403 vs 401, 429 on rate-limited routes) going forward. Real versioning (`/api/v1/`) is deferred to Phase 5, and only if/when partner-facing external API access is introduced — that's the actual trigger for needing a stable, versioned public contract; there is no external consumer today.
**Why:** the API-design guidance defaults to "version from day one," but that default assumes a public/external API. This one has exactly one consumer (the platform's own frontend) and renaming working, live routes to satisfy a convention would be pure churn with real regression risk for zero present benefit.

### 1.9 Frontend: extend the existing design system, don't invent a new one
**Decision:** dashboards reuse the tokens and utility classes already defined in `globals.css` (`midnight-950/900/800`, `gold-400/500`, `ivory-50/100`, `.card`, `.badge-*`, `.eyebrow`, `.section-title`, Outfit font, Phosphor icons) inside a new shared `PortalShell` layout (dark sidebar on `midnight-950`, ivory content area, gold accents for active/primary states). No new fonts, no new palette.
**Why:** the brand aesthetic is finalized and management has already signed off on it. The distinctiveness the frontend-design skill asks for comes from applying that already-distinctive system well to a new context (dense operational screens), not from inventing a second visual language for "internal" pages — that's exactly the kind of inconsistency that made the current admin panel feel bolted-on.

### 1.10 KPI dashboards follow the dataviz method, palette mapped from brand tokens
**Decision:** stat tiles for headline numbers (agent sign-ups, conversion rate) rather than gauges/donuts; a funnel (not a pie) for applicant-flow-by-stage; grouped bars for targets-vs-actuals (never dual-axis); one hue ramp per series family assigned in fixed order (gold for primary/actual, a muted ivory/gray step for target-ghost bars, a status palette — distinct from the categorical ramp — for on-track/at-risk/behind). Every chart gets a table-view fallback and a legend when it has ≥2 series. Palette run through `validate_palette.js` before shipping using the brand's actual hex values, in both light (ivory) and dark (midnight) chart surfaces.
**Why:** this is a direct application of the loaded dataviz skill — computed, not eyeballed, and consistent with the "targets vs actuals," "conversion rate," "filterable by country/region/recruiter/campaign" requirements in FR-3.2/FR-3.8.

---

## 2. Data model additions (by phase)

Extends the existing `User, Candidate, Job, Application, Payment, SystemSetting, KnowledgeArticle, EmailTemplate`.

**Phase 1**
```
enum Role { candidate regional_recruiter country_supervisor inhouse_supervisor director admin }

model User {
  ...
  role          Role   @default(candidate)
  supervisor_id String?
  supervisor    User?  @relation("Supervision", fields: [supervisor_id], references: [id])
  reports       User[] @relation("Supervision")
  country_id    String?
  country       Country? @relation(fields: [country_id], references: [id])
}

model Region  { id String @id @default(cuid()) name String @unique  countries Country[] }
model Country { id String @id @default(cuid()) name String @unique  region_id String  region Region @relation(...)  users User[]  candidates Candidate[] }

model Candidate {
  ...
  user_id      String?           // now nullable
  source       CandidateSource   @default(self_registered)
  recruiter_id String?
  recruiter    User? @relation("RecruiterCandidates", fields: [recruiter_id], references: [id])
  country_id   String?
  lifecycle_status CandidateLifecycleStatus @default(identified)
}
enum CandidateSource { self_registered recruiter_sourced }
enum CandidateLifecycleStatus { identified screened guided_to_apply submitted reported verified approved }

model Document {
  id            String @id @default(cuid())
  candidate_id  String
  type          DocumentType
  storage_path  String            // private bucket path, not a public URL
  verification_status VerificationStatus @default(pending)
  verified_by   String?
  verified_at   DateTime?
  uploaded_at   DateTime @default(now())
}
enum DocumentType { cv passport transcript certificate medical police_clearance contract visa other }
enum VerificationStatus { pending verified rejected }

model AuditLog {
  id          String @id @default(cuid())
  entity_type String
  entity_id   String
  action      String        // create | update | delete | verify | approve
  actor_id    String
  before      Json?
  after       Json?
  created_at  DateTime @default(now())
  @@index([entity_type, entity_id])
  @@index([actor_id])
}
```

**Phase 2 (revised — see note below)**
```
// Pre-registration identity (used only when user_id is null — a
// recruiter-sourced lead who hasn't created an account yet). Once linked
// to a User, the User's fields become authoritative.
model Candidate {
  ...
  full_name String?
  phone     String?
  email     String?

  // Screening gate (FR-2.5) + verification-return workflow (FR-2.7)
  consent_given Boolean   @default(false)
  consent_at    DateTime?
  return_reason String?   @db.Text
}
```
**Superseded:** the `RecruiterProfile` model and "recruiter CRUD + reassignment API" originally planned here are no longer needed — Phase 1's `User.supervisor_id`/`assigned_country_id` plus the Staff & Roles admin page already deliver exactly this (create staff, assign supervisor, assign country), built ahead of schedule when Phase 1 was extended to include real UI. Candidate attribution and pre-application lifecycle statuses are also already covered by Phase 1. Phase 2's actual remaining scope is: capturing a pre-registration lead's identity (above), the screening-gate rule engine, and the recruiter/supervisor portal workflows built on top of it.

**Phase 3**
```
model Report {
  id            String @id @default(cuid())
  type          ReportCycle          // daily weekly monthly
  scope_level   ScopeLevel           // recruiter country
  country_id    String?
  submitted_by  String
  period_start  DateTime
  period_end    DateTime
  status        ReportStatus @default(draft)   // draft submitted verified consolidated
  content       Json
  parent_report_id String?          // recruiter reports roll up into a country report
  created_at    DateTime @default(now())
}

model Campaign {
  id          String @id @default(cuid())
  name        String
  criteria    Json
  created_by  String
  start_date  DateTime
  end_date    DateTime?
}

model CampaignTarget {
  id           String @id @default(cuid())
  campaign_id  String
  metric       String       // agent_signups | applicant_flow | conversion_rate | ...
  country_id   String?
  region_id    String?
  target_value Float
}
```
KPI *actuals* are computed by aggregation queries over `Candidate`/`Application`/`Report`, not stored — avoids a second, driftable copy of the truth.

**Phase 4**
```
model Case {
  id             String @id @default(cuid())
  application_id String @unique
  current_stage  CaseStage @default(application_submitted)
  created_at     DateTime @default(now())
}
enum CaseStage {
  application_submitted verification offer_issued initial_payment
  permit_processing permit_delivered final_payment
  visa_application visa_guidance visa_approved travel_settlement
}
model CaseStageEvent {
  id          String @id @default(cuid())
  case_id     String
  stage       CaseStage
  owner_id    String?
  entered_at  DateTime @default(now())
  completed_at DateTime?
  notes       String? @db.Text
}
model RetentionFollowUp {
  case_id       String @id
  due_at        DateTime      // +90 days from travel_settlement
  completed_at  DateTime?
  notes         String? @db.Text
}

model FeePolicy {
  id             String   @id @default(cuid())
  country_id     String?               // null = global default; a country-specific row overrides it
  enabled        Boolean  @default(false)
  initial_amount Float?
  final_amount   Float?
  currency       String   @default("USD")
  updated_by     String
  updated_at     DateTime @updatedAt
}
```
No leadership sign-off gates the code: `FeePolicy` defaults to `enabled: false`, and an admin settings screen lets the System Administrator turn milestone payments on and set amounts (globally or per destination country, since local law was the reason this was a policy question in the first place) whenever the business decides. Milestone-payment logic in the Case engine reads this policy at runtime instead of a hardcoded rule.

**Phase 5**
```
model Partner {
  id      String @id @default(cuid())
  name    String
  type    PartnerType    // travel_agency visa_consultancy manpower_supplier
  status  PartnerStatus  // prospect active inactive
  contact_json Json
}
model EmployerClient {
  id   String @id @default(cuid())
  name String
  contact_json Json
  jobs Job[]              // Job gets employer_client_id
}
```
**Superseded:** the real model has real contact fields (`contact_name`/`contact_email`/`contact_phone`), not a `contact_json` blob — every other model in this schema uses typed columns, and there was no reason for Partner/EmployerClient to be the exception. `PartnerStatus` ended up `pending | active | suspended` (not `prospect | active | inactive` — "suspended" better matches "stop attributing new leads to this agency" than "inactive"), and `Partner` gained a whole `mou_status` (`none | sent | signed`, with `mou_signed_at`) the original sketch didn't anticipate — the Agency Application Form's own agreement/MOU concept only became clear once that source document was actually read for Phase 5. See §5's dated Phase 5 entry for the full, current shape and reasoning.

---

## 3. API surface (new routes, following the conventions in §1.8)

```
# Reference data
GET    /api/regions
GET    /api/countries

# Agent network
GET    /api/recruiters?country=...&supervisor=...
POST   /api/recruiters
PATCH  /api/recruiters/:id                 # reassign supervisor/country
GET    /api/recruiters/:id/candidates

# Candidates (pre-application funnel)
POST   /api/candidates                    # recruiter registers a lead
PATCH  /api/candidates/:id/status         # identified→screened→guided... (screening-gate enforced server-side)
GET    /api/candidates?status=&country=&recruiter=

# Documents
POST   /api/documents                     # upload, typed
GET    /api/documents/:id/signed-url      # short-lived, RBAC-checked
PATCH  /api/documents/:id/verify

# Reporting
POST   /api/reports                       # submit (recruiter or country level)
PATCH  /api/reports/:id/verify            # country supervisor verifies/consolidates
GET    /api/reports?cycle=&scope=&country=&period=

# Campaigns & KPIs
POST   /api/campaigns
GET    /api/campaigns/:id/kpis?country=&region=&period=
GET    /api/dashboard/kpis                # aggregated, filterable — powers the Management dashboard

# Cases (Phase 4)
GET    /api/cases/:id
PATCH  /api/cases/:id/stage
POST   /api/cases/:id/documents

# Partners (Phase 5)
GET/POST /api/partners
GET/POST /api/employer-clients

# Audit
GET    /api/audit-logs?entity_type=&entity_id=   # admin/director only
```

Every mutating route: Zod-validated body, `requireRole([...])`, then `scopeToRequester` where the action isn't already role-exclusive.

---

## 4. Frontend architecture

- **New route segments**, each behind `middleware.ts` role checks: `/recruiter`, `/supervisor`, `/management`, plus the existing `/admin` (system admin) and `/dashboard` (candidate, unchanged).
- **`PortalShell`** (`src/components/portal/PortalShell.tsx`): shared shell — `midnight-950` sidebar with Phosphor-icon nav items filtered by role, ivory-50 content area, gold-400 active/accent states, reusing `.card`/`.badge-*`/`.eyebrow` from `globals.css`. Replaces the current flat tab-switcher in `/admin/page.tsx`, which gets migrated onto the same shell for visual consistency.
- **Dashboard components** (`src/components/portal/dashboard/*`): `StatTile`, `FunnelChart`, `TargetVsActualBars`, `TrendLine` — built per the dataviz method in §1.10, filter row (country/region/recruiter/campaign/period) above the charts per that skill's interaction spec.
- **Multi-language**: existing Google Translate integration is retained; no additional i18n framework introduced (NFR-10 is already substantially met by what's live).

---

## 5. Phased delivery plan

Mirrors SRS §8 exit criteria exactly, sequenced so each phase is independently shippable and testable on staging before the next begins.

### Phase 1 — Foundation, Access Control & Data Structure
1. Version control hygiene: confirm `.env`-only secrets (FR-1.8), set up staging environment/branch (FR-1.7).
2. Schema migration: `Role` enum extension, `supervisor_id`, `Region`/`Country`, `Candidate.user_id` nullable + `source`/`recruiter_id`/`lifecycle_status`, `Document`, `AuditLog`. No production candidate data exists yet, so this is a clean additive migration with no backfill step.
3. `lib/rbac.ts` + extend `api-auth.ts` (`requireRole`, `scopeToRequester`) + rewrite `middleware.ts` for the new path prefixes.
4. Storage: flip bucket private, implement signed-URL endpoint, migrate existing upload/display call sites.
5. Remove the placeholder-jobs fallback (FR-1.5) — jobs page shows real DB data or an explicit empty state.
6. Audit-log Prisma extension wired to the models named in §1.6.
7. **Exit:** roles, RBAC, region/country model, secure storage, and environments live; placeholder jobs gone. Signed off on staging by System Administrator + a Director.

### Phase 2 — Agent-Network Core — delivered 2026-07-08
_(Recruiter CRUD, reassignment, and country assignment already shipped in Phase 1 — see the "Superseded" note in §2.)_
1. Candidate schema additions: pre-registration identity (full_name/phone/email/desired_role) + consent + return_reason.
2. Screening-gate rule engine (`src/server/services/screening.ts`): data completeness (name, nationality, DOB, passport, phone, **and email specifically** — phone alone is enough to register a lead, but email becomes mandatory by the time they're guided to apply, since status-update emails, receipts, and their eventual account login all depend on it — and desired_role, satisfying FR-2.8's "role" data point), documentation present and not rejected, consent given, minimum-age eligibility — blocks the `guided_to_apply` transition until all pass. ("Role suitability" from FR-2.5 has no dedicated matching model yet — that's Phase 4's Case/stage territory — represented here as just requiring desired_role be on file, not an actual suitability judgment.)
3. `POST /api/candidates`: a recruiter registers a new lead (name/nationality/DOB/passport/contact/desired_role), defaulting country to their own assigned country. `PATCH /api/candidates/[id]` fills in the rest progressively, and `POST /api/upload?candidate_id=` lets a recruiter/supervisor upload documents on a lead's behalf (added mid-phase — the original self-upload-only endpoint made the screening gate unreachable for any recruiter-sourced candidate, since they have no account to log in and upload with themselves).
4. `PATCH /api/candidates/[id]/status`: role-gated lifecycle transitions — recruiter drives identified → screened → guided_to_apply (screening-gated) → submitted → reported for their own candidates; supervisor (excluded from verifying their own sourced candidates, same conflict-of-interest rule as document verification) drives reported → verified → approved, or returns a candidate to an earlier stage with a required reason (FR-2.7), for candidates in their country. All transitions audited.
5. Regional Recruiter portal (`/recruiter`): register-candidate form, status controls, screening-gate failure reasons surfaced inline, document upload, progressive detail editing.
6. Country Supervisor portal (`/supervisor`): verify/return controls with a reason field.
7. Real, automated coverage: `screening.test.ts` (10 cases), `candidateLifecycle.test.ts` (10 cases, the role-gating rules), and `e2e/candidate-lifecycle.spec.ts` (full recruiter→supervisor journey through a real browser against a real DB).
8. **Exit:** Recruiter/Supervisor sections operational; screening gate enforced; every candidate attributed to a recruiter/country — all verified against a live database, not just built.

**Resolved 2026-07-08:** FR-2.1's "submit regional reports and candidate lists" and FR-2.2's "consolidate regional submissions and submit finalised country reports to In-House" were flagged here as a gap, deferred to Phase 3's `Report` model. Phase 3 has since shipped that model plus the full submission/verification/consolidation workflow (`src/server/services/reportWorkflow.ts`, `/recruiter/reports`, `/supervisor/reports`, `/management/reports`) — this closes the gap. All of FR-2.1 through FR-2.9 is now fully built and verified.

### Phase 3 — Control, Reporting & Governance — delivered 2026-07-08
1. `Report` (draft/submitted/verified/returned/consolidated, `parent_report_id` rollup), `Campaign`, `CampaignTarget` models. Campaign requires a bounded `start_date`/`end_date` — a campaign is a timeline, not open-ended (caught by the user before shipping).
2. KPI aggregation service (`src/server/services/kpi.ts`): agent sign-ups, recruiter response rate (FR-3.2's "agency response rate" has no Agency/Partner entity yet — Phase 5 — interpreted as % of identified candidates a recruiter actually screened, disclosed in the code comment), applicant flow funnel, overall + stage-to-stage conversion rates, targets vs actuals — all live aggregation over Candidate/Application/Campaign, never a stored, driftable copy.
3. Role-gated report workflow (`src/server/services/reportWorkflow.ts`): exactly one controlling position per scope — a country_supervisor reviews recruiter-scope reports, in-house/director review country-scope reports (FR-3.5). A recruiter submits; a supervisor verifies/returns recruiter reports and consolidates verified ones into a country report; in-house verifies/returns that. Escalation trail (FR-3.7) surfaced as real data (`parent_report_id`) and a visible UI trail, not just a permission chain.
4. Campaign set-up UI (`/management/campaigns`, FR-3.3) and Management/Control dashboard (`/management`, FR-3.1/3.2/3.8) — KPI stat tiles, applicant-flow funnel and stage-conversion charts (dataviz skill: validated ordinal green ramp for the funnel, gold accent + reserved status icons for targets-vs-actuals — never mixing the two encodings), filterable by region/country/campaign/date-range preset, plus a table view underneath (accessibility requirement — every chart's data is also reachable without it).
5. Reporting-cycle UI on `/recruiter/reports`, `/supervisor/reports`, `/management/reports` (FR-3.4).
6. CSV export (`/api/candidates/export`, FR-3.8) — reuses the same role-scoping as every other candidate query, so an export can never contain more than the viewer could already see in the app.
7. Real, automated coverage: `kpi.test.ts` (8 cases, integration-style against real seeded candidates), `reportWorkflow.test.ts` (7 cases), and `e2e/report-workflow.spec.ts` (the full recruiter → supervisor → management escalation through a real browser against a real DB).
8. Cross-phase gap closure (see §7's Phase 1/2 follow-ups below): `/recruiter/applications` and `/supervisor/applications` (FR-2.1) and DB-level audit-log immutability (FR-3.6).

**Resolved 2026-07-08:** FR-3.6 — the audit trail is now immutable at the database level, not just by app discipline. `prisma/audit-log-immutability.sql` adds `BEFORE UPDATE`/`BEFORE DELETE` triggers on `AuditLog` that reject the operation outright (verified: both a manual `UPDATE` and `DELETE` against a real row were rejected with a Postgres error). Required one-time step per database, documented in `CLAUDE.md`, since `prisma db push` doesn't track raw SQL.

**Confirmed with the business 2026-07-08 — deliberately deferred, not oversights:**
- FR-3.4 ("Should" via this doc's own original phrasing, not literal SRS text): no automated reminders for overdue reports. Deferred to Phase 4/5 — not literally required by the SRS's FR-3.4 wording (asks for cycles to be *supported*, not reminded about), and needs a background scheduler + a "due date" concept that don't exist yet.
- FR-3.8 (Should): CSV export is done; PDF export was explicitly skipped. CSV substantially satisfies the exportability requirement without adding a new PDF-generation dependency.

**Supervisory Reporting Framework adoption — 2026-07-21 (`feature/supervisory-reporting-framework`, off `staging`):** the business supplied a controlled internal document, `Vertex_Supervisory_Reporting_Framework and Guideline.pdf` (v1.0, July 2026), specifying standardised Daily/Weekly/Monthly templates for the same Regional Recruiter → Country Supervisor → In-House Supervisor → Management/Director line this phase already built, plus two new artifacts. Treated as a refinement of this phase rather than a new phase number, since it's the same reporting system gaining the framework's exact structure rather than new functional scope.
- `Report.content` moved from ad hoc free-text fields to one shared, structured schema (`reportContentSchema` in `src/lib/validations.ts`) covering the framework's §2.1 mandatory sections (KPI table, pipeline/activity table, issues, achievements, priorities, competencies, executive summary, certification) — reused across every role/cycle rather than 9 bespoke shapes, with role/cycle-specific KPI *names* supplied by `src/lib/reportTemplates.ts`. Shared, parameterized UI (`src/components/portal/reports/`) renders and edits this same shape everywhere.
- `ScopeLevel` gained `inhouse` and `ReportStatus` gained `approved`/`escalated`/`closed` — In-House Supervisor can now submit its own portfolio-level report upward to Management/Director (`/inhouse/reports`, previously view/consolidate-only). Kept to the existing confirmed single-country In-House scoping (a portfolio of one country), not widened to multi-country, since that's a separate, unconfirmed scope change.
- New standalone `Exception`/`ExceptionCorrectiveAction` models (§6) — an ad hoc, cadence-independent escalation report, raised at any tier and moved up the same reporting line via `escalation_level`, with a decision workflow (Approved/Modified/Rejected/Escalated). Deliberately not a `Report.type` value, since it doesn't share the daily/weekly/monthly submission/verification lifecycle. UI: `/*/exceptions` across every portal, one shared component (`ExceptionsPageContent`).
- New `StaffScorecard`/`StaffScorecardArea` models (§7) — a monthly, supervisor-authored (never self-submitted) staff performance review, distinct from candidate-pipeline reporting: weighted areas fixed at 20/20/15/15/15/10/5 per the framework's own table, enforced server-side. Embedded into the existing recruiter-detail page (Country Supervisor scoring a Regional Recruiter) and the In-House overview (scoring their Country Supervisor); a new standalone `/management/staff-scorecards` list page covers Director scoring potentially many In-House Supervisors.
- Certification simplified to a plain "Certify & Submit" / "Approve" button while authenticated — the Report row's own `submitted_by`/`created_at` is the timestamp/identity record, not a typed attestation (confirmed with the business; deliberately not reusing the heavier Contract e-signature pattern from Phase 4).
- Deadlines (§8.3) stay display-only, consistent with FR-3.4's standing deferral above — no new scheduler.
- **Superseded the same day:** weekly/monthly country and portfolio reports no longer auto-create and auto-submit themselves when the last source report is verified (see below) — several template fields need manual input, and a silent auto-submit gave no chance to fill those in or catch a mistake first. `reportConsolidation.ts` now exposes a pure preview (no writes) instead; the supervisor/in-house initiates via a new guided page (`/supervisor/reports/new`, `/inhouse/reports/new`) that previews the roll-up, lets them complete the rest, and requires an explicit Certify & Submit. Weekly reports are also now constrained to a fixed Monday-Sunday, 7-day window at every tier — without it, two recruiters covering "the same week" with different day-ranges would never exactly match the period-based consolidation lookup (`src/lib/reportPeriods.ts` snaps the UI's date picker to the containing week; `submitReportSchema` enforces it server-side).

### Phase 4 — Extended Mobility Lifecycle — delivered 2026-07-09
1. `Case` (11-stage `CaseStage` enum, one per `Application`, auto-created the moment an application is approved — from *either* admin approval path, the list view's inline dropdown and the detailed-view editor) and `CaseStageEvent` (stage/owner/entered_at/completed_at/notes — the audit trail FR-4.2 asks for). Auto-creation logic lives in `src/server/services/caseLifecycle.ts` (`createCaseForApprovedApplication`, idempotent), integration-tested against a real DB.
2. Case management UI across recruiter/supervisor/management/admin (`/*/cases`, `/*/cases/[id]`), sharing one `CaseDetail` component — stage-advance form (role-gated: a recruiter advances forward only, a supervisor+ can also return a case, mirroring the Phase 2 candidate-lifecycle shape without reusing its single hard boundary, since a case has no equivalent hand-off gate), stage history, document upload/verification, contract, milestone payments, and retention follow-up all in one place. An 11-segment progress strip (one brand hue, filled to the current stage) replaces per-stage color-coding — nobody can tell 11 hues apart at a glance, and the label already carries the specific information.
3. Contract generation + signature capture (FR-4.3) — the candidate signs with a typed full-legal-name attestation, tied to their authenticated session, timestamp, and IP: a real, legally-recognized "simple electronic signature," not a stub. The paid e-signature vendor (DocuSign/Dropbox Sign) is deliberately not integrated — the platform recommendation places that under "Integrate," scoped to Phase 5, and this Contract model is exactly the groundwork a vendor swap would sit behind.
4. Work-permit/visa deadline tracking (FR-4.4): a staff-entered `stage_deadline` on `Case` (never a system-computed SLA guess — none is specified anywhere), surfaced as an overdue/due-soon urgency badge in every case list.
5. Milestone payments (FR-4.5): `CasePayment` (initial/final, amount, receipt reference), gated by the admin-configurable `FeePolicy` (global or per destination country, defaults disabled — no leadership sign-off blocks this shipping) at `/admin/fee-policy`. This *records* that a payment was collected; it is not a new Stripe/PayPal charge flow, which is the separate, already-built candidate application-fee path.
6. Document verification widened (FR-4.6): `POST /api/upload` was hard-restricted to `cv`/`passport` only — widened to the full mobility document set (`transcript`, `certificate`, `medical`, `police_clearance`, `contract`, `visa`). The verification workflow itself (`DocumentVerifyControls`, audit-logged) was already generic and needed no change.
7. `RetentionFollowUp` (FR-4.7, Should) auto-starts (due_at = +90 days) the moment a case reaches its final stage, `travel_settlement`. Flight/accommodation/arrival details are captured via that stage's `CaseStageEvent.notes` rather than a dedicated structured model — a deliberately modest scope choice for a Should.
8. Stage-based candidate notification (FR-4.8, Should): every stage change best-effort emails the candidate (skipped if they have no linked account yet) — the same "correct code path, untested real delivery" pattern as every other email in this codebase, since there's no working SMTP in dev. "Assigned staff" notification specifically was not built.
9. Real, automated coverage: `caseLifecycle.test.ts` (9 pure-logic cases), `caseLifecycle.integration.test.ts` (3 cases against a real DB — creation, idempotency, audit logging), and `e2e/case-lifecycle.spec.ts` (the full browser flow: admin approves → case auto-opens → stage advance → contract issued → candidate signs from their own dashboard).
10. Two real, pre-existing bugs surfaced and fixed along the way (not introduced by Phase 4, but found by testing it): `/admin/applications` (list and detail) assumed every candidate has a linked user account and crashed outright — client-side on the list view, server-side (email send) on the detail view's PUT — whenever a recruiter-sourced lead without an account had an application. Both now fall back to the candidate's own pre-registration `full_name`/`email`/`phone`, matching the pattern already used in `ApplicationsList.tsx`. The detailed view's PUT handler was also missing the case-auto-creation hook entirely — approving from there silently opened no case.

**Confirmed with the business — deliberately deferred, not oversights:**
- FR-4.4/4.8: no automated (email/push) reminders — same reasoning as Phase 3's deferred report reminders. Deadlines are real staff-entered data with real in-app urgency indicators, just not a background scheduler yet.
- FR-4.3: the actual e-signature vendor integration is Phase 5's, per the platform recommendation's own "Integrate" column.

### Framework-alignment role restructuring — delivered 2026-07-09
Post-Phase-4 amendment. Auditing the platform against the business's actual Regional Supervisory Operational Workflow document (three tiers — Regional Recruiter, Country Supervisor, In-House Supervisor — each "one controlling position per process") surfaced a real drift: System Administrator had accumulated ownership of day-to-day operational workflows (candidate approval, Jobs, Applications, Fee Policy, a redundant `/admin/cases`) that the framework assigns to specific operational roles, not to a system-level role. Confirmed with the business: Admin should be restricted to system-level concerns (accounts, reference-data taxonomy, technical settings), keeping override access everywhere for support purposes, but not being the primary place operational decisions get made.
1. Candidate `verified → approved` restricted to In-House Supervisor/Director only (`candidateLifecycle.ts`'s `IN_HOUSE_ROLES`) — the framework's "Approved by In-House" is a distinct, higher tier than Country Supervisor's "Verified" ceiling, not something a supervisor can also do. Country Supervisor is explicitly blocked from any `approved`-adjacent transition (forward or reverse).
2. Case auto-creation's trigger re-pointed to this real approval event (unchanged code path, just now firing from the correct, framework-defined gate rather than a broader one).
3. Jobs, Applications review, and Fee Policy moved off `/admin` to `/management` (In-House Supervisor/Director's portal) — matching the workflow document's role assignments. The redundant `/admin/cases` (a duplicate of `/management/cases`) was deleted outright rather than kept as a second read path.
4. Candidate screening's `screening_result` (pass/fail) is now persisted on the `Candidate` record rather than recomputed transiently, so oversight views (now visible to In-House, not just the recruiter who ran the check) show the same result everyone else sees.
5. A new `marketing` role, created after a further business clarification mid-review: job postings are solely marketing's responsibility, deliberately kept **outside** the three-tier operational hierarchy (not a fourth rung, a parallel lane) — `lib/rbac.ts`'s `STAFF_ROLES` (candidate-hierarchy scoping) stays narrower than `lib/validations.ts`'s `STAFF_ROLES` (all assignable staff roles) specifically so `marketing` is assignable without inheriting `isStaffRole()`'s broader candidate/application access. Jobs moved a second time, from `/management` to a new `/marketing` portal; Admin retains override access throughout.
6. New `/marketing` portal (`marketingNav.ts`, `PORTAL_ACCESS["/marketing"]`) and a marketing test account, following the same pattern as every other role's test account.

### Application model pivot — general Candidate Information Form — delivered 2026-07-09
Post-Phase-4 amendment, driven by the business clarifying the real intake process: candidates don't apply to specific job listings today (jobs aren't listed on the platform yet) — they submit a general programme-interest form, matching Vertex's real-world "Candidate Information Form" (European Work Permit & Visa Application), whether filled in by the candidate themselves or by a regional recruiter on their behalf. A parallel partner/agency intake form exists for Phase 5.
1. `Application.job_id` widened to nullable (was required, with a `[candidate_id, job_id]` unique constraint that no longer means anything once a candidate can have a job-less application) — `job_id` stays in the schema for when real job matching exists, but every current submission path leaves it empty. Duplicate-submission protection moved from the old unique constraint to an explicit check: a candidate can't have a second non-`rejected` `Application` on file.
2. `Application` widened with the form's own fields: `preferred_country_1/2/3_id` (`Country` doubles as the destination-programme picker — see below), `preferred_sector_id`, `earliest_travel_date`, `prior_eu_visa_applied`, `current_location_country`, `holds_schengen_visa`, `prior_visa_refusals`, `available_for_embassy_appointment`, `willing_to_start_within_30_days`, `preferred_contact_channel`, `payment_plan_acknowledged` (a required, literal-`true` field — the payment plan must be explicitly ticked, not just displayed).
3. New `Sector` model (admin-managed "Preferred Type of Work" options) and `CountryDocumentRequirement` (admin-managed, per-country extra document requirements — e.g. Poland needs all passport pages, Belarus needs a national ID copy — beyond the universal passport/photo/CV set every programme requires). Both are data-driven, matching the existing `FeePolicy`/`CampaignTarget` pattern of admin-configurable business rules over hardcoded ones. Managed at `/admin/sectors`.
4. `Country` (already region-scoped reference data used for recruiter/supervisor territory assignment) doubles as the candidate's destination-programme picker, scoped to whichever countries admin has placed under the "Europe" region — the business's own framing ("the countries admin sets in Europe are the ones a user can select from"). Source-market regions (Africa, Middle East & Gulf) are unaffected; a public `GET /api/apply/options` exposes just the Europe-scoped countries and the sector list, unauthenticated, for the apply form.
5. `DocumentType` widened with the form's Section 3 checklist items (`all_passport_pages`, `passport_photo`, `national_id`, `cv_europass`, `education_diploma`, `driving_licence`, `tachograph_card`, `professional_training_certificate`, `e_apostille`, `zab_recognition_letter`) — and `POST /api/upload`'s allowlist, which had been widened for Phase 4's document set but not for these, was widened again (a schema/enum change alone doesn't propagate to a hardcoded allowlist; this was caught by grep, not `tsc`, same lesson as item 6 below).
6. `MilestonePaymentType`/`FeePolicy` extended from a 2-stage (initial/final) to the form's real 3-stage plan: `documentation` (Stage 1 · 20%, on engagement), `permit` (Stage 2 · 40%, after the work permit is issued), `visa` (Stage 3 · 40%, after the visa is granted). Renamed `FeePolicy.initial_amount/final_amount` → `documentation_amount/permit_amount/visa_amount`.
7. Public `/apply` rewritten: an authenticated-candidate-only flow (unchanged from before) combining a "Section 2" personal-information form (`CandidateProfileForm`, self-service, `PUT /api/candidates/profile`) with the Section 1/4/5 application form (`ApplicationForm`, shared component, `POST /api/applications`). The two speculative Hungary/Greece landing pages (`/apply/hungary`, `/apply/greece`) were retired — they were static mockups with no real submission path (`onClick={() => alert(...)}`, no API call at all) built before this model existed; the one generic multi-country form now supersedes them.
8. Recruiter-assisted flow: `CandidateApplyOnBehalf` rewritten from a job-picker dropdown to the same shared `ApplicationForm` (rendered in a modal, given its size), and `CandidateEditDetails`/`updateCandidateDetailsSchema` widened with the form's Section 2 fields so a recruiter can complete a lead's full profile, not just the original DOB/passport/email/desired-role subset.
9. A systemic bug swept across every Application/Case surface: once `job_id` could be null, every call site that assumed `application.job.title` always existed became a crash risk — client-side (Applications/Cases lists and detail views across all four portals, the candidate dashboard) and server-side (status-change and stage-change confirmation emails). All were found by grepping for `.job.title`/`.job.city`/`.job.country` rather than relying on `tsc` (loosely-typed API responses don't surface these), fixed with a `job ?? preferred_sector/preferred_country_1` fallback everywhere, consistent with the existing candidate-`full_name`-fallback pattern from Phase 4.

### Pre-application lifecycle re-sequenced around the Candidate Information Form — delivered 2026-07-09
Second amendment the same day, after the business clarified the *order* of the real intake process: the Candidate Information Form (CIF) is the very first thing anyone fills in — the candidate themselves (no account yet) or a recruiter on a walk-in lead's behalf — and it's what gets screened, before any account or documents exist. Only once screening passes does the candidate get emailed an invite to create their own account; only then do they upload documents. This reverses two things the *first* same-day amendment above had just built (the authenticated-only `/apply` gate, and `CandidateApplyOnBehalf`'s existing-candidate-only scope) and retires the recruiter's separate lightweight quick-add entirely.

`CandidateLifecycleStatus`'s 7 values are unchanged (renaming would ripple through the KPI funnel, stage-color maps, and every existing test for no real benefit) — only what triggers each transition changed:

| Status | Trigger now |
|---|---|
| `identified` | The CIF is submitted — creates the `Candidate` + `Application` together in one shot (`POST /api/applications`'s new branch), for either an anonymous self-service submitter or a recruiter entering a walk-in lead. |
| `screened` | Still a manual staff click, but now actually gated: `evaluateScreeningGate` (rewritten) checks the CIF + the candidate's own Section 2 answers — full name, nationality, DOB (18+), passport number **and expiry (≥ 6 months' validity, newly enforced)**, phone, email, consent — not documents, since none exist yet. Passing sends the existing account-creation invite email (previously unconditional at this transition; now only reachable once the gate has already passed). |
| `guided_to_apply` | System-only now — fires from `POST /api/auth/register` when the candidate claims their invite link and creates their account. No longer a manual recruiter action (`canSetLifecycleStatus` now rejects it the same way it already rejected manual `submitted`). |
| `submitted` | System-only — fires from `POST /api/upload` once a new `documentCompleteness.ts` service confirms the universal set (`cv`/`passport`/`passport_photo`) plus any `CountryDocumentRequirement` extras for the candidate's chosen destination are all uploaded. This is the first real consumer of `CountryDocumentRequirement` — it existed with an admin UI but no reader until now. |
| `reported`/`verified`/`approved` | Unchanged. |

1. Recruiter auto-assignment for a self-service submission: new `src/server/services/recruiterAssignment.ts` (`assignNextRecruiterForCountry`), round-robin among the Regional Recruiters `assigned_country_id`-matched to the candidate's chosen current-location country — whose turn is next is derived from the most recently created candidate already assigned in that country (no new stored cursor), not a persisted rotation pointer. Only runs for an anonymous submission; a recruiter entering a walk-in lead is themselves the assigned recruiter (or, if a non-recruiter staff role does it — e.g. a supervisor stepping in — the same round-robin runs rather than misattributing the lead to them).
2. `Application.current_location_country` (free text) → `current_location_country_id` (`Country` FK) — needed to match against `User.assigned_country_id` for (1). Scoped in the UI to every region *except* "Europe" (the source-market regions already used for recruiter territory), the mirror image of the destination-country picker.
3. Section 3 (Document Checklist) turned out to be a self-reported "can you provide this?" checklist on the form itself (tick-boxes), not a file-upload step — corrected after initial confusion; added `Application.documents_available: DocumentType[]`, populated from the same static 12-item list the form displays (matching the source document's exact wording and "Required for: X" tags), distinct from the `Document` model (which tracks what's actually been uploaded and verified, later).
4. `POST /api/candidates` (the recruiter's old lightweight quick-add, `registerCandidateSchema`) removed outright — the CIF is now the only intake path for both self-service and recruiter-assisted leads. `RegisterCandidateForm.tsx` now opens the same shared `ApplicationForm` (with `includePersonalInfo`) in a modal instead of its own 7-field form. `CandidateApplyOnBehalf.tsx` was deleted — its only mount point (a `guided_to_apply`-gated "submit on behalf" action) no longer makes sense once that transition is system-only.
5. The public `/apply` page's login gate removed for the primary path: an anonymous visitor now sees the full CIF (`ApplicationForm` with `includePersonalInfo`) directly; the existing authenticated-candidate flow (`CandidateProfileForm` + `ApplicationForm`) is kept for the narrower case of an already-registered candidate with no active application yet. The anonymous submission endpoint is rate-limited (`lib/rate-limit.ts`, 5/min per IP) — this is a genuinely new unauthenticated write surface.
6. Shared `src/lib/documentTypes.ts` (`DOCUMENT_TYPE_LABELS`, `UNIVERSAL_DOCUMENT_TYPES`, `CIF_PROGRAMME_SPECIFIC_DOCUMENT_TYPES`) extracted after the same document-type label list started recurring a third time (admin's Sectors page, the CIF form's Section 3 checklist, the candidate dashboard's upload checklist) — the dashboard's own upload widget now shows the universal set plus whichever `CountryDocumentRequirement` extras apply to the candidate's chosen destination, instead of a hardcoded cv/passport pair.
7. Tests: `recruiterAssignment.integration.test.ts` (round-robin over 0/1/2 recruiters), `documentCompleteness.integration.test.ts`, rewritten `screening.test.ts` and `candidateLifecycle.test.ts` for the new gate/transition rules, and `e2e/candidate-lifecycle.spec.ts` rewritten end-to-end for the new order — including simulating the candidate's invite-claim step via a direct Prisma write (same pattern `global-setup.ts` already uses for `e2e-case-candidate@test.local`, since there's no SMTP in dev to actually intercept the invite email).

**A real gap this surfaced, deliberately accepted rather than solved now:** a candidate with an email who simply never creates an account (declines, loses the link, etc.) is stuck at `screened` indefinitely — `guided_to_apply` has no staff-driven fallback. Given the framework's own description of the process ("...before they submit documents via their account that they create...") treats account creation as the singular expected path, not one of several, the existing `admin` role-unrestricted override in `canSetLifecycleStatus` is the intended escape hatch for this edge case, not a dedicated new mechanism.

### Phase 5 — Partner CRM — delivered 2026-07-10
Scoped to the SRS's Must-priority items only (FR-5.1, FR-5.2) — confirmed with the business: no partner self-service portal (agencies keep submitting the Agency Application Form by email; staff re-key it), and no third-party integration accounts exist yet, so FR-5.3–5.9 are documented below as confirmed-deferred rather than built as unused stub/adapter code.

1. `Partner` (FR-5.1): travel agencies, visa consultancies, manpower suppliers that source candidate leads via the Agency Application Form — `partner_type`/`status` (`pending`/`active`/`suspended`)/`mou_status` (`none`/`sent`/`signed`, `mou_signed_at` auto-stamped on the transition to `signed`) + contact fields. `country_of_operation` is free text (not a `Country` FK) since an agency can be based anywhere, unlike Vertex's own programme-destination reference list.
2. `EmployerClient` (FR-5.2): the employer a vacancy is actually for, linked via new `Job.employer_client_id` (nullable — not every posting has one). Deliberately simpler than `Partner` — just `status` (`active`/`inactive`), no MOU workflow, since nothing in the SRS asks for one.
3. Candidate attribution: `Candidate.partner_id` (nullable, `onDelete: SetNull`) + new `CandidateSource.partner_sourced` value, set only at creation time — same one-shot pattern as `recruiter_id`, not editable afterward via a general edit form. The Agency Application Form turned out to be structurally the CIF plus one leading "Agency Information" section and an "Agency Declaration" in place of the Candidate Declaration, which is why partner-sourced intake reuses the *same* `ApplicationForm` + `POST /api/applications` new-candidate branch built for the CIF pivot, rather than a second form or pipeline — just with `partner_id` threaded through (staff-only: rejected outright if an anonymous self-service submitter or a logged-in candidate tries to set it, since a candidate can't attribute their own sourcing agency).
4. Two intake surfaces for a partner-sourced lead, both ending at the same endpoint: the recruiter's own `RegisterCandidateForm` gained an optional "Sourced via partner" picker (defaults to "walk-in lead"); the new Partner detail page (`/management/partners/[id]`) has its own "Register Candidate" action with the partner preset. The second path is the more interesting one operationally — since the submitter there (In-House/Director) isn't a `regional_recruiter` themselves, it exercises the *real* round-robin `assignNextRecruiterForCountry` assignment (Phase 2) rather than the self-assignment a recruiter's own quick-add takes.
5. UI: `/management/partners` (list + create) and `/management/partners/[id]` (contact info, status/MOU controls, candidates sourced, register-candidate action) and `/management/employer-clients` (list + create + inline status toggle) — both under Management's nav, same reasoning as Fee Policy (a management/CRM concern, not system admin). `marketing/jobs/new`(+edit) gained an optional Employer/Client picker. `CandidateList` shows a small "via {partner name}" tag under the recruiter column when `source === "partner_sourced"`.
6. KPI: new `computePartnerPerformance` (candidates sourced + how many reached `approved`, per partner, within the filter period) — additive to the existing `computeRecruiterResponseRate`, which stays as-is rather than being repurposed now that a real `Partner` entity exists (it's already honestly labeled "Recruiter Response Rate" in the UI and well-tested). Surfaced as a table on the Management Control Dashboard.
7. Both `Partner` and `EmployerClient` added to `AUDITED_MODELS` — same tier as `FeePolicy`/`Contract` (real business/compliance weight — MOU/agreement status), unlike unaudited pure reference data (`Region`/`Country`/`Sector`).
8. Tests: `kpi.test.ts` gained 2 cases for `computePartnerPerformance` (counts scoped to the period; a partner with none in-period is omitted); `e2e/partner-crm.spec.ts` covers the full path — management adds a partner, signs its MOU, registers a candidate against it (exercising round-robin assignment), and confirms the partner attribution shows on the main candidate list.

**Confirmed with the business — deliberately deferred, not oversights (FR-5.3–5.9, all Should/Could):** Microsoft 365/Teams, Calendly, e-signature vendor (the Phase 4 `Contract` model is exactly the groundwork a vendor swap sits behind), a BI/analytics layer, WhatsApp Business API, and partner-acquisition/email-marketing tooling — all blocked on third-party accounts that don't exist yet. Per the platform recommendation's "Build core, integrate edges, buy commodity" framework these are all "Integrate," not "Build," so no adapter-interface stub code was written with zero caller — that would be speculative work against a vendor that isn't chosen yet. Revisit once real accounts exist.

### Partner intake corrected to self-service — delivered 2026-07-10
Same-day correction after the business clarified the real process, which the initial Phase 5 build (above) got wrong: partners are **not** staff-managed leads re-keyed by a recruiter — they get their own admin-provisioned login and submit candidates themselves, and those candidates **never enter Vertex's internal recruiter/screening/verification funnel** at all (the partner has already screened/verified them). Vertex's role narrows to reviewing for completeness and eventually assigning a job/programme — item 3/4/8 above (staff-attributed `partner_id` on the CIF, the `RegisterCandidateForm` partner picker, round-robin assignment for partner leads) are **reverted**; `Partner`/`EmployerClient`/`computePartnerPerformance` from the original build stand unchanged.

1. `Role` gains `partner` — an external login, deliberately kept out of `STAFF_ROLES` (same precedent as `marketing`). `Partner.user_id` (nullable, unique) links to it once provisioned.
2. New `PartnerCandidate` model — deliberately **not** `Candidate`/`Application`, a genuinely separate funnel: mirrors the Agency Application Form's Sections 2–6 (Programme Selection, Candidate Personal Info, Document Checklist, Payment Plan Ack, Visa & Travel Readiness — Section 1, Agency Information, is already on the `Partner` record itself, not per-submission). New `PartnerCandidateStatus` (`submitted`/`under_review`/`job_assigned`/`rejected`) — not the internal 7-stage `CandidateLifecycleStatus`, which describes screening/verification work Vertex doesn't do for these candidates.
3. Account provisioning: `POST /api/admin/partners/:id/provision-account` (same manager tier as the rest of Partner CRUD — In-House/Director/admin) reuses the exact temp-password pattern from `POST /api/admin/users` (now-shared `generateTemporaryPassword()` in `lib/auth.ts`) — returned once, admin shares it out of band. UI: a "Create Partner Login" action on `/management/partners/[id]`, replacing the reverted "Register Candidate" button.
4. New Partner portal at `/partner` (role-gated in three separate places — `rbac.ts`'s `PORTAL_ACCESS`/`ROLE_HOME`/`INTERNAL_PORTAL_PREFIXES` **and** `src/proxy.ts`'s `PROTECTED_PATHS`/`config.matcher`, confirmed by direct inspection that gating a new portal path requires all of them, not just `rbac.ts`) — a partner logs in, sees only its own `PartnerCandidate` submissions, and submits new ones via a new `PartnerCandidateForm.tsx` (modeled on `ApplicationForm.tsx`'s fields, but no Candidate Declaration/consent section — that's the CIF's own semantics). `GET/POST /api/partner/candidates` scoped to the caller's own `Partner` via `Partner.user_id`.
5. Best-effort staff notification: `sendPartnerCandidateSubmittedEmail` (`lib/email.ts`) fires on submission — recipient is `PARTNER_SUBMISSION_NOTIFY_EMAIL`, unset for now (the business hasn't provided the address yet); no-ops with a console note rather than throwing until it's configured.
6. **The staff-side review/assignment queue (picking a `Job` for a submitted `PartnerCandidate`, and the bridge that would create a real `Candidate`/`Application`/`Case` from it) is deliberately out of scope for this round** — confirmed with the business. `PartnerCandidate.reviewed_by`/`rejection_reason`/`bridged_candidate_id` are schema groundwork for it, but no route or UI exists yet; a submission just sits at `status: "submitted"`, and the email above is currently the only staff-facing signal one exists. Revisit once the assignment workflow is actually needed.
7. `e2e/partner-crm.spec.ts` rewritten for the corrected flow: management adds a partner → provisions its login (captures the one-time temp password from the UI) → logs in as the partner in the same browser context → submits a candidate → confirms it shows up on the partner's own list. No round-robin/recruiter-attribution assertions anymore — those never applied to this path in the first place.

### Post-Phase-5 review batch — Admin scope narrowing, reusable UI primitives, admin-managed document types — delivered 2026-07-10
A first full pre-team review pass across every role's pages, driven by direct comments on the built CRM rather than new SRS scope. Bundled because most items are small and independent; the document-requirement-type change is the one genuine architecture decision in the batch (confirmed with the business via an explicit fork question, below).

1. **Public site:** Jobs nav link is now conditional (`Navbar.tsx` checks `GET /api/jobs?limit=1` client-side; only renders when jobs actually exist) rather than removed outright — re-appears automatically once Marketing posts one. The hero's "What can we help with?" Recruitment CTA now points to `/apply` ("Apply Now") instead of `/jobs` ("Browse Opportunities"), matching the CIF-first flow. Dev DB's Jobs/Candidates were wiped for a clean review (the original demo candidate `grace.wanjiru@example.com` didn't survive this — see `docs/ROLES_AND_PERMISSIONS_REVIEW.md`'s test-accounts section for the replacement).
2. **Admin scope narrowed to system administration:** `/admin/candidates`, `/admin/finances`, and their backing routes (`GET /api/admin/candidates`, `GET /api/payments/admin`) are deleted outright (confirmed orphaned via grep first) — a system administrator provisions accounts and reference data, it doesn't run recruitment operations. Admin's Overview page (`/admin`) is now a staff/regions/countries/sectors snapshot, not a jobs/applications/candidates dashboard. Admin's underlying API access to candidates (`isStaffRole`) and Jobs (`JOB_MANAGER_ROLES`) is unchanged — only the dedicated bulk-browse UI and its specific backing routes were removed.
3. **Auth pages:** new `PasswordInput` component (show/hide toggle, Phosphor `Eye`/`EyeSlash`) wraps both password fields on login and register.
4. **Regions & Countries UI** (`/admin/regions`): inline rename for regions and countries (including moving a country to a different region), plus country deletion — `DELETE /api/admin/countries/:id` catches the Prisma `P2003` FK-violation error and returns a friendly "still referenced by a partner candidate submission" 409 instead of a raw DB error (most other Country references `SetNull`; only `PartnerCandidate`'s three country FKs `Restrict`, so this is the one real blocking case).
5. **Staff & Roles** (`/admin/users`): row edits (role/supervisor/country) are staged in local `Draft` state and only committed on an explicit per-row Save button, rather than applying on every keystroke/selection — same reasoning as a form, not a live-bound control, since a supervisor/country change has real downstream effects (row-level scoping). Added `DELETE /api/admin/users/:id` (self-delete blocked) and `POST /api/admin/users/:id/reset-password` (reuses the same one-time temp-password pattern as staff creation and partner provisioning).
6. **`SearchableSelect`** (`src/components/SearchableSelect.tsx`): a combobox (search-filter + keyboard nav) replacing every native `<select>` app-wide, per the standing rule against long unfiltered native dropdowns once several had 10+ options (countries, staff, sectors). Behaves like a native select from the outside (`value`/`onChange(value: string)`); internally a button + listbox with ARIA `role="combobox"`/`"listbox"`/`"option"` — added specifically so Playwright's `getByRole` locators still resolve, since `.selectOption()` no longer applies to a non-`<select>` control. All 8 affected E2E `.selectOption()` call sites (across `candidate-lifecycle`, `case-lifecycle`, `partner-crm` specs) were rewritten to an open-then-click-option pattern.
7. **Pagination** (`src/lib/usePagination.ts` + `src/components/Pagination.tsx`): every list/table across the app paginates to 15 rows client-side (all list endpoints already return their full result set in one call, so this is display-only slicing, not a new cursor/offset API layer) — clamps down automatically if a filter shrinks the list under the current page.
8. **Document requirement types — enum replaced with an admin-managed table.** The ask ("admin should be able to add to the list of requirements and that should automatically add to CIF and all other respective forms") can't be satisfied by a Postgres enum, which is fixed at schema-deploy time — confirmed with the business via an explicit two-option fork (replace the enum entirely vs. an additive parallel "custom types" table alongside it) rather than guessing; the business chose the full replacement for one consistent model.
   - New `DocumentRequirementType` model (`key` unique slug, `label`, `is_universal`, `sort_order`) replaces the 19-value `DocumentType` enum. `Document.type`, `CountryDocumentRequirement.document_type` become `String` FKs against `DocumentRequirementType.key` (`Restrict`/`Cascade` respectively — a real uploaded `Document` blocks deleting its type, a country's requirement-list membership doesn't); `Application.documents_available`/`PartnerCandidate.documents_available` become plain `String[]` (self-reported checklist, not FK-enforced).
   - `POST /api/admin/document-types` (admin-only): admin supplies just a label; the key is derived by slugifying it server-side, so admin only ever thinks in display labels, never stable identifiers. Immediately usable everywhere else that reads this table — no code change, no deploy.
   - `GET /api/apply/options` (the existing public CIF/Agency-form reference-data endpoint) widened with `documentTypes`/`documentRequirements`, so `ApplicationForm.tsx`'s and `PartnerCandidateForm.tsx`'s Section 3/4 checklists — previously a hardcoded array with static "Required for: X" hints — now render entirely from admin-managed data, with the "Required for" hint computed live from the real per-country requirement rows instead of a fixed one-country-per-type string.
   - The admin-managed set only covers the CIF/country-requirement concept; a small fixed exclusion list (`NON_PROGRAMME_TYPE_KEYS`/`CASE_UPLOAD_EXCLUDED_KEYS` in `lib/documentTypes.ts`) keeps `cv` (its own dedicated screening-gate upload button, never a checklist item) and the six pre-existing Phase 4 mobility-lifecycle types (transcript/certificate/medical/contract/visa/other) out of the CIF checklist and admin's per-country toggle list, exactly matching their pre-migration behavior — new admin-added types are never in this list, so they always propagate.
   - **Migration note:** converting the enum columns in-place (`prisma db push`) fails outright once rows exist (`document_type`/`type` can't be cast enum→text automatically when required+non-empty) — resolved with a manual `ALTER COLUMN ... USING col::text` + `DROP TYPE` on both `vertex_dev`/`vertex_test` before pushing, preserving the dev DB's existing test accounts/reference data rather than a destructive `--force-reset`. The new FK constraints were added in a second `db push` pass, after seeding `DocumentRequirementType` in between — adding a FK against an empty lookup table fails validation for any existing referencing row.

### Cascading role review, Regional Recruiter phase — delivered 2026-07-11
First phase of a planned role-by-role review (recruiter → country supervisor → in-house supervisor → director), driven by direct comments on the built portals. Built in an isolated git worktree (`recruiter-review-1`) against a dedicated scratch database (`vertex_dev_recruiter_review`/`vertex_test_recruiter_review`), since a second, unrelated session was concurrently editing the same shared working directory and dev database on its own branch (the "Opportunities catalog" / "Public-forms email bridge" work immediately below) — see the "Concurrent-session isolation" entry in CLAUDE.md's bug log for why. Both branches merged into `staging` together; see that entry's "Resolved 2026-07-11" note for the shared-database sync this made possible.

1. **Candidate detail page.** `GET /api/candidates/:id` widened to include the candidate's `Application` data (Section 1/3/5 of the CIF — preferred countries/sector, documents self-reported as available, current location, visa readiness, payment plan ack), previously not exposed by this route at all. New shared `CandidateDetail.tsx` (same pattern as `CaseDetail.tsx` — one component, thin per-portal page wrappers) renders it alongside lifecycle status/edit/document-upload actions. `CandidateList.tsx` gained an optional `basePath` prop: when set, a candidate row links to `${basePath}/${id}` instead of expanding the old inline `CandidateEditDetails` popover and inline `CandidateStatusControls`/`CandidateDocumentUpload` widgets — wired in for the recruiter portal only (`/recruiter/candidates/[id]`) this phase; supervisor/management keep the old inline behavior until their own review phase.
2. **Candidate list search + filter.** Added to `CandidateList.tsx` unconditionally (benefits every portal using it, not just recruiter) — client-side text search (name/contact) and a lifecycle-status `SearchableSelect` filter, layered on top of the existing client-side pagination (`GET /api/candidates` already returns the full scoped result set in one call).
3. **Per-recruiter targets, allocated from a campaign target.** Confirmed with the business via an explicit fork question: rather than either (a) reusing country-wide campaign targets directly as a recruiter's own number, or (b) a fully standalone per-recruiter target with no connection to Campaigns, the real requirement is a Country Supervisor allocating a slice of their country's active `CampaignTarget` to each of their own recruiters. New `RecruiterTarget` model (`campaign_target_id` + `recruiter_id` + `target_value` + `set_by`, unique per campaign-target/recruiter pair) captures exactly that relationship. `POST /api/recruiter-targets` checks server-side that the caller actually supervises the recruiter and that the campaign target is scoped to the caller's own country — not left to the UI. New `computeRecruiterTargetsVsActuals` (kpi.ts) mirrors the existing `computeTargetsVsActuals`, narrowed to one recruiter's allocations, reusing the same `recruiterId`-scoped KPI functions already built for the Management KPI dashboard. A minimal `/supervisor/targets` allocation page ships now — ahead of the Country Supervisor review phase — only because the recruiter's reports need real target data to show; flagged in the roles doc as a placeholder to revisit properly later, not a finished design.
4. **Weekly/monthly reports auto-populate from a date range.** `GET /api/candidates` gained optional `period_start`/`period_end` (both required together) and now returns `country.region`. Daily reports are untouched (a single notes field, per instruction — "Daily is good with the current structure"). Weekly reports snapshot the full candidate list for the picked period (name/region/role/contact/screening result/status/date of application) into `Report.content` at submission time; monthly reports snapshot an aggregated summary (totals, by-status breakdown, screening pass rate) instead of the raw list — both computed live in the UI as a preview before submit, then frozen into the report on save, since a report is meant to reflect state *at the time it was filed*, not a live-updating view that would silently change after the fact. Both also include the recruiter's target-vs-actual for the period and new free-text Challenges/Performance Updates fields. `Report.content` stays the existing unstructured `Json` field (no schema change) — shape now varies genuinely by `type`, whereas before every type wrote the same `{ notes }` shape.
5. **Recruiter Overview tab** (`/recruiter/overview`, new first nav item — "My Candidates" moved off the `Gauge` icon to make room). Current-month target-vs-actual, candidate/conversion/screening stat tiles (derived client-side from the recruiter's own full candidate list, same aggregation logic as the monthly report's summary), a reports-due banner, and supervisor feedback. "Communication from country supervisor" is deliberately **not** a new messaging system — no such model exists and none was asked for beyond this; it surfaces the recruiter's own `returned`-status reports and their `return_reason`, data that already exists. The reports-due banner is a pure client-side computation (last submitted report's `period_end` per type + that type's natural cadence, compared to today) — not a background scheduler or notification service, consistent with the standing deferral of FR-3.4-style automated reminders elsewhere in this codebase.
6. `RecruiterTarget` added to `AUDITED_MODELS` (`lib/audit.ts`) — a supervisor's target allocation is a real management decision, same tier as `FeePolicy`/`Contract`.
7. `e2e/candidate-lifecycle.spec.ts` updated for the new detail-page flow: the recruiter's status-advance steps now click into the candidate row first (`page.getByRole("link", {name: candidateName})`) before acting, instead of finding the status button inline in the list. The supervisor's own "Return to X" combobox lookup is now scoped to the candidate's row (`page.locator("tr", {hasText: candidateName})`), since the new search/filter dropdown on `CandidateList` made an unscoped `page.getByRole("combobox")` ambiguous.

### Cascading role review, Country Supervisor phase — delivered 2026-07-12
Second phase of the role-by-role review (recruiter → country supervisor → in-house supervisor → director), driven by direct comments on the supervisor portal. Built on a fresh branch (`supervisor-review-1`, off `staging`) in the same worktree/scratch-database setup established last phase.

1. **Overview tab stopped being a candidate list.** `/supervisor` (previously just `<CandidateList canVerify />`) now shows country-level stats — recruiter count, candidate count, candidates awaiting the supervisor's own verification (`lifecycle_status: "reported"`), recruiter reports awaiting review, and the country's progress against its active `CampaignTarget`(s) this month. New `GET /api/supervisor/overview` and `computeCountryTargetsVsActuals` (kpi.ts, mirrors `computeTargetsVsActuals` but scoped directly to a country rather than looping a campaign's full target set — a country can sit under several concurrent campaigns). The candidate list itself moved to a new `/supervisor/candidates` tab, finally giving the supervisor portal the same click-through-to-detail-page pattern the recruiter phase established (`CandidateList` with `basePath="/supervisor/candidates"`, `canVerify`; `/supervisor/candidates/[id]` reuses the same `CandidateDetail` component with `canVerify={true}`).
2. **New Recruiters tab.** `/supervisor/recruiters` lists every recruiter under the caller with an all-time candidates-sourced/conversion-rate summary (`GET /api/supervisor/recruiters`); clicking through to `/supervisor/recruiters/[id]` (`GET /api/supervisor/recruiters/:id`) shows that one recruiter's performance this month, progress vs. target, a target-setting control per active campaign target (folding in what the standalone `/supervisor/targets` placeholder did last phase — now removed), their reports with inline verify/return, and a notes feed (below).
3. **"Communicate with that recruiter" → a one-way notes feed, not a messaging system.** New `RecruiterNote` model (`recruiter_id`, `author_id`, `message`) — deliberately not a two-way thread; report `return_reason` already carries per-report feedback, so this is scoped to "anything else a supervisor wants to flag." `POST/GET /api/recruiter-notes`, authorization checked both directions (a supervisor can only write to their own recruiters; a recruiter can only read their own notes). Surfaces on the recruiter's own `/recruiter/overview` "From your country supervisor" card, merged and sorted alongside returned-report reasons rather than as a separate card.
4. **Reports tab reorganized around two browsing modes**, not two different data sets, per the ask ("either by timeperiod... or outstanding to review"): a toggle between **Outstanding to review** (the existing default — recruiter reports at `status: "submitted"`) and **By period** (all recruiter reports grouped into Daily/Weekly/Monthly sections, sorted by period). "Executable actions based off content" interpreted concretely as: a weekly report's embedded candidate snapshot (`content.candidates`) now renders as clickable chips linking to `/supervisor/candidates/[id]`, so a supervisor reviewing a report can act on a specific candidate it mentions without a separate lookup. `recruiter/reports/page.tsx`'s weekly snapshot gained a `candidate.id` field to make this possible (older reports submitted before this phase won't have it — the chip just renders unlinked in that case).
5. **Weekly/monthly country reports auto-consolidated themselves** — `maybeAutoConsolidate` (`src/server/services/reportConsolidation.ts`), called from `PATCH /api/reports/[id]/verify` right after a recruiter report was marked verified, would auto-create + auto-submit the supervisor's own country report the moment every recruiter report for that exact period was resolved. **Superseded 2026-07-21** (Supervisory Reporting Framework adoption, above): this now only *previews* the roll-up — the supervisor initiates and explicitly submits via `/supervisor/reports/new`, since several template fields need manual input that a silent auto-submit never gave a chance to fill in.
6. `RecruiterNote` added to `AUDITED_MODELS` — a supervisor's note to a recruiter is a real recorded interaction, same tier as `RecruiterTarget`.
7. `GET /api/reports` gained an optional `recruiter_id` filter (maps to `submitted_by`) — additive to the existing role-scoping, used by the recruiter detail page to narrow to one recruiter's reports without a new endpoint.
8. `e2e/candidate-lifecycle.spec.ts`'s supervisor steps updated for the new click-through flow (navigate to the Candidates tab, click the candidate, act on the detail page — same shape as the recruiter-side change last phase). Caught and fixed a genuine selector ambiguity this introduced: the Overview page's "Candidates in country" stat tile is itself a link, so `page.getByRole("link", { name: "Candidates" })` without `exact: true` matched both it and the nav item.

### Opportunities catalog — Service & Pricing List merged into the real Job model — delivered 2026-07-11
The business supplied its actual partner-facing pricing document (`Service and Pricing list.xlsx`, "Work Permits" sheet — 15 work-permit programmes across 12 countries) with the ask "add the available opportunities to jobs page ... it will also include the pricing info." First instinct was a separate static catalog; the business corrected this ("the opportunities are the jobs, find a way to merge the data in the jobs db also, the pricing information seems to be per opportunity not per country") — the 15 programmes are now real `Job` rows (`prisma/seed.ts`), not a parallel content list, and pricing lives on `Job` itself rather than a country-keyed table, since Czech Republic alone has 4 programmes at 4 different fees.

1. `Job` widened with `visa_type`, `duration_permit`, `processing_time`, `service_fee_gbp`, `visa_success_rates`. Every programme in the source guide follows the same fixed 20% / 40% / 40% (documentation / permit / visa) split of the total fee, so only the total is stored — stage amounts are derived at render time (`/jobs/[id]`), which also sidesteps a real arithmetic error in the source spreadsheet's own Bulgaria row (its 380/740/740 cells sum to 1860, not its own stated 1900 GBP total; 20/40/40 of 1900 is 380/760/760).
2. Portugal, Spain, and Czech Republic — 3 of the 15 programmes — were missing from the Europe region's `Country` seed entirely, so the CIF's destination picker couldn't select them even though pricing existed for them. Added, plus a new `General Labour` sector for the several programmes that are simply "Unskilled" with no more specific sector fit.
3. `POST /api/applications`'s `job_id` field, and the fee-gated payment flow keyed off `Job.application_fee`, already existed end-to-end server-side from the original job-listing build — but no client ever sent `job_id`, and `/jobs/[id]`'s "Apply for This Position" link went to `/apply?job=...` with nothing on the receiving end reading it. `/apply` now resolves that param (`GET /api/jobs/:id`) and both prefills `ApplicationForm`'s country/sector (name-matched against the live `/api/apply/options` list, not hardcoded IDs) and carries `job_id` through on submit. These 15 programmes deliberately leave `application_fee` at 0 — the real business process is staff-recorded milestone billing, not a Stripe/PayPal pay-to-apply checkout for the full service fee.
4. Caught in the same pass, unrelated to the opportunities work but in the same file: `/apply`'s signed-in-candidate layout rendered "Section 2 — Your Personal Information" (`CandidateProfileForm`) in its own card *above* `ApplicationForm`, whose first section is "Section 1 — Programme Selection" — the same class of ordering bug already fixed once before (Phase 2, inside `ApplicationForm` itself), just reintroduced at the page-composition level. Fixed by embedding `CandidateProfileForm` as a `personalInfoSlot` prop rendered between `ApplicationForm`'s Section 1 and Section 3, which required converting its own wrapping `<form>` to a `<div>` since HTML doesn't allow nesting `<form>` elements.
5. That embedding left a mid-form "Save Personal Information" button sitting between Sections 1 and 3, reading as a confusing second commit action ahead of the final "Submit Application" (user-flagged, not self-caught). Resolved by giving `CandidateProfileForm` an imperative handle (`forwardRef` + `useImperativeHandle`, `CandidateProfileFormHandle.save(): Promise<boolean>`) and a `hideSaveButton` prop; `/apply` holds a ref to it and passes `ApplicationForm` an `onBeforeSubmit` callback that saves the profile first and aborts the application submit (with an inline error) if that fails — one button, one click, in the embedded case. `/dashboard`'s standalone usage of `CandidateProfileForm` is untouched (no ref, `hideSaveButton` unset), so its independent save-anytime button still works exactly as before.

### Public-forms email bridge — deploy ahead of CRM sign-off (2026-07-11)
The business wants the site live on the main domain before the CRM's staff workflows (recruiter assignment, screening) are signed off for real public traffic. Rather than delay launch or half-trust an unproven pipeline, a `SystemSetting` toggle (`intake_mode`, "email" | "crm", defaults "email" when unset) controls whether the public Candidate Information Form touches the CRM at all — managed at `/admin/settings` ("Public Form Intake Mode").

1. **Scope of the toggle:** only the two `ApplicationForm` renders on the public `/apply` page (signed-out and signed-in-candidate) read it, via a new `useEmailIntakeIfConfigured` prop — `RegisterCandidateForm` (recruiter walk-in lead) and `PartnerCandidateForm` never set it, so staff already working inside the CRM are unaffected regardless of the setting. When "email", `ApplicationForm` posts to the new `POST /api/public-intake/application` instead of `POST /api/applications` — no `Candidate`/`Application` rows, no recruiter round-robin, nothing written to the CRM at all; it emails `PUBLIC_FORMS_NOTIFY_EMAIL` a formatted summary of the same data the CIF collects, plus a short confirmation to the applicant. `/api/apply/options` (already publicly fetched on mount) now also returns `intakeMode`.
2. **Known limitation of "email" mode:** since no `Application` row is created, the existing duplicate-submission guard (`GET /api/applications` → "you already have an application on file") never triggers for a signed-in candidate — they can resubmit repeatedly while in email mode. Acceptable for a temporary bridge; not fixed.
3. **Contact form** (`/contact`) had no backend at all — a `setTimeout` simulating success client-side. New `POST /api/contact` always emails `PUBLIC_FORMS_NOTIFY_EMAIL` unconditionally, not gated by `intake_mode` at all — there's no CRM-side concept of a general enquiry to gate.
4. **Failure semantics, deliberately different from every other email in `lib/email.ts`:** `sendPublicIntakeEmail`/`sendContactMessageEmail` *throw* if `PUBLIC_FORMS_NOTIFY_EMAIL` is unset, rather than the `sendPartnerCandidateSubmittedEmail` no-op-and-console.log precedent — caught during testing, not self-evident up front. That existing precedent is safe specifically because a DB record (`PartnerCandidate`) already exists regardless of whether the notification email sends; here there is no DB record at all, so a silently-unconfigured inbox would make a real submission vanish with zero trace while still telling the applicant "success." Both routes now surface a real 502 instead.
5. Requires real SMTP configured in `.env` (`SMTP_HOST`/`PORT`/`SECURE`/`USER`/`PASS`/`EMAIL_FROM`, currently still the placeholder example values) plus the new `PUBLIC_FORMS_NOTIFY_EMAIL`. Business has admin access to `vertex@vertexadmin.com` on Zoho Mail for this.

### Self-submission routing to HR — delivered 2026-07-31
Public `/apply` submissions previously got assigned to whichever Regional Recruiter covered the candidate's current-location country (round-robin), or bridged to email if none — confirmed with the business that this is wrong now: a self-submission should always go to HR for review, the same way partner submissions already do, with no recruiter/country_supervisor/inhouse_supervisor step involved at all. Two clarifying fork questions during planning: HR owns this pipeline **end-to-end**, and the CIF's Job/Opportunity picker (already shipped for the partner form) should also replace Section 1 on **both** the self-submission and recruiter walk-in forms, while document upload stays deferred on both (only Section 1 changed, not Section 3's self-report checklist).

1. **Routing.** `POST /api/applications` no longer calls `assignNextRecruiterForCountry` (deleted, with its test — zero remaining callers) — a self-registered candidate always gets `recruiter_id: null`. `job_id` (via a single required `SearchableSelect` "Opportunity" picker) replaces the old `preferred_country_1_id/_2_id/_3_id`/`preferred_sector_id` cluster on `ApplicationForm.tsx`, shared by the self-submission and recruiter-walk-in (`RegisterCandidateForm`) renders alike — the recruiter needed the same "pick the actual programme, see what's required for it" upgrade the partner form already had.
2. **Lifecycle ownership.** `canSetLifecycleStatus` (`candidateLifecycle.ts`) gained an optional `source` parameter and an `hr` branch, scoped to `source: "self_registered"` only, allowing exactly two forward skip-ahead transitions: `identified→screened` (screening gate, invite email) and `submitted→approved` (Case creation, approved email) — both reuse the *existing* side effects in `/api/candidates/:id/status` already keyed on target status, not new bespoke logic, since HR performing these two transitions with the candidate's own account-creation/document-upload steps in between naturally reproduces "invite without a case, then later a case." New `HrCandidateStatusControls.tsx` is a purpose-built sibling to `CandidateStatusControls` (not a retrofit) for this skip-ahead shape.
3. **HR portal.** New "Self Applications" queue at `/hr/self-applications` and `/hr/self-applications/[id]` (`CandidateDetail` with `hrMode`), alongside HR's existing "Partner Submissions" queue — both list a `Candidate`, but scoped by `source` so a recruiter-sourced candidate never appears in either. **Same day, user-flagged follow-up:** the list page was rewritten from a generic `CandidateList` reuse into its own bespoke dashboard (matching `/hr`'s Partner Submissions page), since HR had no way to tell a candidate had come back from screening (account created, documents uploaded, auto-advanced to "submitted") without reopening every candidate individually — two summary tiles ("ready for your approval" / "awaiting your reply") plus a per-row callout, backed by a shared `getCandidateAttentionSignals` (`src/server/services/candidateSignals.ts`) extracted from the Partner Submissions queue's existing per-candidate signal logic and reused via a new opt-in `signals=true` param on `GET /api/candidates`.
4. Screening gate fix caught by live testing before shipping: `evaluateScreeningGate` still unconditionally required `preferred_country_1_id`/`preferred_sector_id`, both always null for a job-linked application now — every self-submission failed screening on first try. Fixed by treating `job_id` as an alternative satisfier for those two checks.
5. `e2e/candidate-lifecycle.spec.ts`'s Section 1 fill updated to the job picker (Czech Republic, 0 extra `CountryDocumentRequirement` rows, same opportunity `partner-crm.spec.ts` already uses); new `e2e/self-application.spec.ts` covers the whole anonymous-submission → HR-screens → candidate-claims-invite → uploads → HR-approves → Case-created path end to end.

### 2026 pricing revision + Stripe restricted to self-applicants — delivered 2026-07-31
The business supplied `Vertex Service and Pricing List 2026 for Candidates.xlsx`, replacing the original Service & Pricing List used to seed the Opportunities Catalog: the milestone split changes from 20/40/40 to 25/25/50, almost every programme's total fee changes, 3 new destination countries are added (Greece, Netherlands, Croatia), and Czech Republic collapses from 4 seeded programmes to 1. Alongside this, Stripe payment links are restricted to self-applicants only — partner/recruiter-sourced candidates are invoiced off-platform, so staff need to record that payment manually with a real receipt instead.

1. **Pricing.** `lib/fees.ts`'s `computeMilestoneSplit` (the one place the split is computed) becomes 25/25/50; every other hardcoded "20%/40%" display label across the app (fee-policy admin page, finance page, `ApplicationForm.tsx`, `CaseDetail.tsx`, `PartnerCandidateForm.tsx`, `email.ts`) updated to match. `prisma/seed.ts`'s `WORK_PERMIT_JOBS` rewritten row-for-row against the new sheet; the 3 retired Czech Republic seasonal Jobs were deleted outright (confirmed zero referencing `Application` rows first), not soft-retired. New `Job.tier` field (Premium/Skilled/Standard/Entry, the sheet's own categorization) is display-only, shown as a small badge on `/jobs`/`/jobs/[id]`. The seed script now calls `syncJobMilestonePricing` per Job after upserting, so `JobMilestonePrice` (and real Stripe Products/Prices — `.env` turned out to already have real Stripe test-mode keys, not the placeholders documented earlier) never silently drifts from `service_fee_gbp`.
2. **Stripe restricted to self-applicants.** `CaseDetail.tsx` only renders "Send Payment Link" when `Candidate.source === "self_registered"`, enforced again server-side in `POST /api/cases/:id/payments/link` (the UI gate is not the real authorization boundary). The existing manual "Record" form gained an optional real receipt file upload — new `CasePayment.receipt_document_id` FK to `Document` (additive to the existing free-text `receipt_reference`, not a replacement), reusing the existing `/api/upload` pipeline with a new `payment_receipt` `DocumentRequirementType` (excluded from every CIF/case checklist, staff-uploaded only, same shape as `issued_work_permit`/`issued_visa`). Caught live: `/api/upload`'s on-behalf-of-candidate role check didn't include `finance` at all (only the separation-of-duties directorate roles it already explicitly lists) — added, since Finance is the one recording these payments.
3. **Legal notice.** New shared `ServiceFeeNotice.tsx` — "Recruitment & Immigration Support Service Fees" heading, the business's exact verbatim wording (fees are for recruitment/immigration-support services, not employment itself), and a line clarifying these specific prices are for self-applicants (partner/recruiter-sourced candidates have their own separate arrangement). Wired into `/jobs`, `/jobs/[id]`, and `ApplicationForm.tsx`'s Payment Plan Acknowledgement section — one component, not three copies of the same paragraph.
4. `e2e/candidate-lifecycle.spec.ts`, `e2e/partner-crm.spec.ts`, and `e2e/self-application.spec.ts` all referenced the now-retired "Czech Republic — 6-Month Seasonal Work Permit" as their zero-extra-document-requirement test opportunity — updated to "Czech Republic — 2-Year Resident Card", the one surviving Czech Republic programme.

---

## 6. Cross-cutting

- **Testing:** Playwright E2E per role portal's critical path (screening gate, report consolidation, case stage transition); unit tests on the service layer (screening rules, KPI aggregation, scoping helper) — this is exactly the logic where a bug is an authorization or data-integrity bug, not a cosmetic one.
- **Migrations:** every schema change ships as an additive, reversible Prisma migration; nothing destructive without a staging soak first (NFR-9).
- **Security:** rate limiting extended to all new mutating routes (existing `lib/rate-limit.ts` pattern reused); OWASP Top 10 pass before each phase sign-off (NFR-4).
- **GDPR (NFR-5):** `Consent`/retention metadata is a Phase 1 data-model concern even though it's not customer-visible yet — added alongside `Candidate` so it's not retrofitted later onto records that already exist without consent capture.

## 7. Risks

| Risk | Level | Mitigation |
|---|---|---|
| One IT administrator delivering a 5-phase SRS | High | Phases are independently shippable; scope can pause after any phase without leaving the system broken |
| Third-party procurement (M365, e-signature, WhatsApp Business, BI) not yet in place | Low — confirmed-deferred, not blocking | Phase 5's core CRM (`Partner`/`EmployerClient`) shipped without these; no adapter-interface stubs were written against unchosen vendors (that would be speculative work) — build the real integration once an account actually exists |

Resolved / not applicable, confirmed with the business:
- **Candidate-fee policy** — no longer a blocking external decision. Implemented as an admin-configurable `FeePolicy` (§2, §5 Phase 4), defaulting to disabled. The System Administrator turns it on and sets amounts whenever ready; engineering isn't gated on it.
- **`Candidate.user_id` nullable / registration-flow regression** — confirmed no live candidate data exists in production yet, so there's no backfill or existing-row migration to get right. The schema change ships as a clean additive migration with no data-migration risk.
- **Storage bucket flip breaking hardcoded URLs** — confirmed no hardcoded public-URL references exist to worry about. The bucket flips to private and signed URLs from the start, with no call-site audit required.

**Delivery approach:** phase-by-phase, sequentially — not parallelized. Each phase is fully built, tested on staging, and signed off (System Administrator + a Director) before the next begins, per SRS §8.

**Resolved 2026-07-08:** this follow-up predicted that once Phase 2/3 landed, Applications review would need re-scoping away from pure admin — confirmed and fixed. `GET /api/applications` now scopes every staff role through `scopeCandidatesToRequester` (the same function the candidate list uses), not just `admin`, and read-only Applications views were added at `/recruiter/applications` and `/supervisor/applications` (FR-2.1's "guide and track applications" — recruiters previously had no application visibility at all, only candidate-pipeline visibility). `/admin/applications` is untouched and still the only place application *status* (interview/approved/rejected) is changed — this closes visibility, not editing rights, matching Phase 1's original decision to keep hiring-decision screens under System Administrator.

## 8. Complexity estimate

| Phase | Complexity | Primary risk driver |
|---|---|---|
| 1 | High | Foundational — every later phase depends on its RBAC/schema being right, even with no data-migration risk |
| 2 | High | New portals + the screening-gate rule engine |
| 3 | Medium-High | KPI aggregation correctness + dashboard build |
| 4 | High | Largest surface area (11 stages) + policy dependency |
| 5 | Medium | Mostly integration adapters, well-isolated |

---

**WAITING FOR CONFIRMATION** — proceed with this architecture and phased plan? (yes / modify: ... / different approach: ...)

Once confirmed, Phase 1 starts with the schema migration and RBAC/storage fixes (§5, Phase 1, items 1-4), since everything else in the SRS depends on them.
