# Product Requirements Document
## Vertex International Recruitment & Mobility Platform
**Version:** 1.0 — Generated from live codebase (August 2026)
**Status:** Production (Vercel + Prisma Postgres)

---

## 1. Product Overview

Vertex International Recruitment Ltd. is a UK-based international recruitment and mobility company that places workers from Africa and the Middle East & Gulf into European work-permit programmes (Poland, Czech Republic, Germany, Netherlands, Greece, Croatia, Serbia, Bulgaria, Belarus, Italy, Portugal, Spain, and others).

The platform is a full-stack CRM and operations system built on Next.js 16 / PostgreSQL / Prisma. It replaces a fragmented email + spreadsheet workflow with a single system of record covering:

- Public candidate intake (Candidate Information Form)
- A three-tier internal agent network (Regional Recruiter → Country Supervisor → In-House Supervisor)
- Separation-of-duties directorates (HR, Operations, Finance)
- External partner/agency portal
- A full 11-stage mobility case lifecycle (work permit → visa → departure)
- Reporting, KPI dashboards, exception management, and staff scorecards

---

## 2. Business Goals

| Goal | Metric |
|---|---|
| Replace email/spreadsheet intake with a structured CRM | Zero candidate submissions processed outside the platform |
| Enforce the three-tier supervisory hierarchy | Every candidate attributed to a recruiter, country, and supervisor |
| Provide real-time KPI visibility to management | Targets vs. actuals dashboard live for every active campaign |
| Ensure document security and compliance | All documents stored in private Cloudflare R2, never public URLs |
| Support 15+ work-permit programmes across 12+ countries | All programmes seeded as real Job rows with milestone pricing |
| Enable partner agencies to self-submit candidates | Partner portal live, submissions reviewed by HR/Operations |

---

## 3. Users & Roles

The platform has 12 distinct roles across three categories.

### 3.1 Public / Anonymous
- Browse job listings at `/jobs`
- Submit the Candidate Information Form at `/apply` (rate-limited: 5/min/IP)
- Use the AI chat widget
- Book a paid consultation at `/consultation`

### 3.2 Internal Staff Roles

| Role | Portal | Description |
|---|---|---|
| `regional_recruiter` | `/recruiter` | Sources candidates, drives pre-approval lifecycle, submits reports |
| `country_supervisor` | `/supervisor` | Verifies recruiter work, consolidates reports, sets recruiter targets |
| `inhouse_supervisor` | `/inhouse` | Multi-country oversight, approves candidates, manages campaigns |
| `director` | `/management` | Same permissions as In-House Supervisor today |
| `hr` | `/hr` | Reviews self-submitted and partner-submitted candidates; creates Cases |
| `operations_team` | `/operations` | Owns case stage movement, contracts, document handoff |
| `operations_director` | `/operations` | Senior operations title; identical permissions to operations_team |
| `finance` | `/finance` | Records milestone payments, manages payment links |
| `marketing` | `/marketing` | Owns job postings only; outside the 3-tier hierarchy |
| `admin` | `/admin` | System administrator; provisions accounts and reference data |

### 3.3 External Roles

| Role | Portal | Description |
|---|---|---|
| `candidate` | `/dashboard` | Jobseeker with their own account; uploads documents, signs contract, tracks case |
| `partner` | `/partner` | External agency; submits candidates through its own portal |

---

## 4. Core Functional Requirements

### 4.1 Authentication & Access Control

- JWT-based authentication (cookie `auth_token`) with bcrypt password hashing
- Role-based access control via a central `lib/rbac.ts` permission table
- Row-level scoping: recruiters see only their own candidates; supervisors see their country; in-house sees their assigned countries; director/admin see everything
- Scoping enforced in `src/server/scope.ts` — never duplicated across route handlers
- Staff accounts provisioned by Admin via invite-link (`/auth/register?setup=<token>`)
- Partner logins provisioned by Management via one-time invite link
- Candidate accounts created via emailed invite after HR/recruiter screening approval
- Google OAuth backend wired but UI button hidden (pending business decision)
- Rate limiting on all mutating public routes (`lib/rate-limit.ts`)
- Security headers on all routes: `X-Frame-Options: DENY`, `X-Content-Type-Options`, `HSTS`, `Referrer-Policy`, `Permissions-Policy`

### 4.2 Candidate Intake — Candidate Information Form (CIF)

The CIF is the universal intake form for all candidate sources.

**Sections:**
1. Programme Selection — single Job/Opportunity picker (links to a real `Job` row)
2. Personal Information — name, DOB, nationality, passport, gender, marital status, education, occupation, address, WhatsApp, contact preference
3. Document Checklist — self-reported "can you provide this?" tick-list (not file uploads)
4. Payment Plan Acknowledgement — explicit tick required
5. Visa & Travel Readiness — current location country, Schengen visa status, prior refusals, embassy availability, 30-day start readiness

**Submission paths:**
- Anonymous self-service at `/apply` → creates `Candidate` + `Application`, routed to HR's Self Applications queue
- Recruiter walk-in via `RegisterCandidateForm` in the recruiter portal → same endpoint, recruiter becomes attributed
- Partner agency via `PartnerCandidateForm` at `/partner` → creates `PartnerCandidate` (separate funnel)

**Intake mode toggle:** Admin can switch between `"crm"` (writes to database) and `"email"` (emails `PUBLIC_FORMS_NOTIFY_EMAIL` with no DB write) via `/admin/settings`. Only affects the public `/apply` page; staff-entered leads always go to CRM.

### 4.3 Candidate Lifecycle (Internal Pipeline)

Seven lifecycle statuses for internally-sourced candidates:

```
identified → screened → guided_to_apply → submitted → reported → verified → approved
                                                                           ↘ rejected
```

| Status | Trigger | Who |
|---|---|---|
| `identified` | CIF submitted (anonymous or recruiter walk-in) | System |
| `screened` | Screening gate passes; invite email sent | HR (self-submitted) or Recruiter (walk-in) |
| `guided_to_apply` | Candidate claims invite link and creates account | System |
| `submitted` | Universal documents + country-specific extras all uploaded | System |
| `reported` | Recruiter manually advances | Regional Recruiter |
| `verified` | Supervisor verifies | Country Supervisor |
| `approved` | Final approval; Case auto-created | In-House Supervisor / Director / HR |
| `rejected` | Terminal rejection | HR |

**Screening gate** (`src/server/services/screening.ts`) checks: full name, nationality, DOB (18+), passport number, passport expiry (≥6 months validity), phone, email, consent, and `job_id` present.

**Document completeness** (`src/server/services/documentCompleteness.ts`) checks: universal set (CV, passport, passport photo) + any `CountryDocumentRequirement` extras for the candidate's chosen destination.

### 4.4 Partner Candidate Pipeline

Partners submit candidates through `/partner` using the Agency Application Form (Sections 2–6 of the CIF). These candidates:
- Never enter the internal recruiter/supervisor lifecycle
- Are reviewed by HR (`/hr/partner-candidates`) and Operations (`/operations/partner-candidates`)
- HR can approve (creates Case) or reject
- `PartnerCandidate` has its own status: `submitted → under_review → job_assigned → rejected`
- Partner-submitted candidates get a real `Candidate` + `Application` row immediately on submission (`source: partner_sourced`, `lifecycle_status: submitted`)

### 4.5 Case Lifecycle (11 Stages)

A `Case` is auto-created the moment a candidate reaches `approved`. It tracks the full mobility journey:

| Stage | Description |
|---|---|
| `registration_document_submission` | Candidate Registration & Document Submission |
| `document_preparation_legalization` | Document Preparation, Translation & Legalization |
| `permit_application_submission` | Work Permit Application Submission |
| `permit_processing_followup` | Work Permit Processing & Government Follow-up |
| `permit_authorization_approved` | Work Permit & Work Authorization Approval |
| `original_documents_dispatch` | Dispatch of Original Documents |
| `partner_receives_permit` | Partner Receives Work Permit |
| `visa_interview_preparation` | Embassy Appointment & Visa Interview Preparation |
| `visa_interview_decision` | Embassy Interview & Visa Decision |
| `pre_departure_arrangements` | Pre-Departure & Flight Arrangements |
| `departure_arrival_support` | Departure & Arrival Support |

**Case ownership:** Operations Team/Director owns stage movement. Finance owns milestone payments. HR owns the initial create/reject decision.

**Ops review gate:** Before stage advancement, Operations/Director must confirm documentation (`CaseOpsReviewStatus: pending → confirmed`).

**Case status:** `active` or `rejected` (Operations/Director can close a case entirely post-creation).

**Retention follow-up:** Auto-created at +90 days from the final stage.

### 4.6 Document Management

- All documents stored in Cloudflare R2 (sole backend — no local disk on Vercel)
- Never publicly accessible; served via a signed, time-limited JWT token
- `GET /api/documents/[id]/signed-url` → RBAC-checked, issues a short-lived token
- `GET /api/documents/file?token=...` → resolves the token and streams the file
- Document types are admin-managed (`DocumentRequirementType` table) — admin adds a new type from the UI and it immediately appears on all forms, no code change needed
- Universal types (CV, passport, passport photo) required for every programme
- Per-country extras configured at `/admin/sectors` (e.g. Poland requires all passport pages)
- Verification workflow: `pending → verified / rejected`, logged in `AuditLog`
- Staff can upload documents on a candidate's behalf (recruiter, supervisor, HR, operations, finance)

### 4.7 Reporting System

Based on the Vertex Supervisory Reporting Framework (v1.0, July 2026).

**Report types:** Daily, Weekly, Monthly
**Scope levels:** `recruiter`, `country`, `inhouse`

**Submission chain:**
1. Regional Recruiter submits → Country Supervisor verifies/returns
2. Country Supervisor consolidates into a country report → In-House Supervisor verifies/returns
3. In-House Supervisor submits portfolio report → Director/Management approves

**Report content schema** (`src/lib/reportTemplates.ts`): structured JSON with KPI table, pipeline/activity table, issues, achievements, priorities, competencies, executive summary, and certification. Role/cycle-specific KPI names supplied by `reportTemplates.ts`.

**Weekly/monthly reports** auto-populate from a date range (weekly snaps full candidate list; monthly snaps aggregated summary). Weekly periods are fixed Monday–Sunday.

**Exception reports** (`Exception` model): ad hoc, cadence-independent escalation reports raised at any tier, with a decision workflow (Approved/Modified/Rejected/Escalated) and corrective actions.

**Staff scorecards** (`StaffScorecard` model): monthly, supervisor-authored performance reviews with 7 weighted areas (20/20/15/15/15/10/5).

### 4.8 KPI Dashboard

Available to In-House Supervisor, Director, and Admin at `/management` and `/inhouse`.

Metrics:
- Agent sign-ups
- Recruiter response rate (% of identified candidates screened)
- Applicant flow funnel (by lifecycle stage)
- Stage-to-stage conversion rates
- Targets vs. actuals (per campaign, country, region)
- Partner performance (candidates sourced + % reaching approved)

All actuals are live aggregations over `Candidate`/`Application`/`Campaign` — never stored copies.

Filterable by: region, country, recruiter, campaign, date range.

### 4.9 Campaigns & Targets

- `Campaign`: bounded timeline (`start_date`/`end_date`), criteria JSON, status (draft/active/closed)
- `CampaignTarget`: metric (`verified_candidates` or `conversion_rate`), scoped to country, region, or campaign-wide
- `RecruiterTarget`: Country Supervisor allocates a slice of a `CampaignTarget` to each recruiter
- `StaffKpiTarget`: supervisor sets a personal KPI target for a direct report, keyed to the exact KPI-row label on that recipient's own report

### 4.10 Milestone Payments

Three-stage payment plan per the Candidate Information Form:
- Stage 1 — Documentation: 25% of total service fee
- Stage 2 — Permit: 25% of total service fee
- Stage 3 — Visa: 50% of total service fee

**Stripe** (self-applicants only): pre-provisioned Stripe Products/Prices per Job milestone (`JobMilestonePrice`). Finance generates a Payment Link; webhook confirms payment and flips `CasePayment.status` to `collected`.

**Manual recording** (partner/recruiter-sourced): Finance records payment with optional receipt file upload (`CasePayment.receipt_document_id`).

**Fee Policy** (`FeePolicy`): admin-configurable, defaults disabled. Global or per-destination-country override.

### 4.11 Contracts

- Operations generates a contract from candidate/job/case data
- Candidate signs with a typed full-legal-name attestation (simple electronic signature: name + authenticated session + timestamp + IP)
- `ContractStatus`: draft → sent → signed
- DocuSign/Dropbox Sign integration deferred to a future phase

### 4.12 Partner CRM

- `Partner` model: travel agencies, visa consultancies, manpower suppliers
- Fields: partner type, status (pending/active/suspended), MOU status (none/sent/signed), contact info
- `EmployerClient` model: the employer a vacancy is for; linked to `Job` via `employer_client_id`
- Partner login provisioned by Management; one-time invite link
- Partner portal at `/partner`: submit candidates, view own submissions only
- Staff notification email on new partner submission (`PARTNER_SUBMISSION_NOTIFY_EMAIL`)

### 4.13 Jobs / Opportunities Catalog

- 15 real work-permit programmes seeded from the 2026 Service & Pricing List
- Countries: Poland, Czech Republic, Germany, Netherlands, Greece, Croatia, Serbia, Bulgaria, Belarus, Italy, Portugal, Spain, and others
- Job fields: title, country, city, category, salary range, description, requirements, visa type, permit duration, processing time, service fee (GBP), visa success rates, tier (Premium/Skilled/Standard/Entry)
- Jobs managed exclusively by Marketing role at `/marketing/jobs`
- Public listing at `/jobs` with category filter and pagination
- Job detail at `/jobs/[id]` with full programme info and fee breakdown

### 4.14 Consultation Booking

- Public `/consultation` page: paid advisory consultation ($50)
- Stripe Checkout; webhook creates `ConsultationBooking` row on `checkout.session.completed`
- No authentication required

### 4.15 AI Chat Widget

- Available on all public pages
- Powered by Google Gemini / OpenAI via the Vercel AI SDK
- Knowledge base articles managed by Admin at `/admin/settings`
- Can be toggled on/off via system settings

### 4.16 Audit Logging

- Append-only `AuditLog` table: entity type, entity ID, action, actor, before/after JSON
- Written automatically via a Prisma Client extension (`$extends`) — cannot be forgotten in a new code path
- Immutable at the database level: `BEFORE UPDATE`/`BEFORE DELETE` triggers reject any modification (`prisma/audit-log-immutability.sql`)
- Audited models: Candidate, Application, Case, CaseStageEvent, Document, Report, Contract, FeePolicy, Partner, EmployerClient, RecruiterTarget, RecruiterNote, StaffKpiTarget

### 4.17 Messaging

- `CandidateMessage`: one continuous thread per candidate between the candidate and their assigned recruiter
- `RecruiterNote`: one-way note from Country Supervisor to a specific recruiter (not a two-way thread)

---

## 5. Public-Facing Pages

| Route | Description |
|---|---|
| `/` | Homepage with featured jobs, hero, services overview |
| `/jobs` | Job listings with category filter, pagination, legal fee notice |
| `/jobs/[id]` | Job detail with programme info, fee breakdown, Apply CTA |
| `/apply` | Candidate Information Form (anonymous or authenticated) |
| `/about` | Company information |
| `/contact` | Contact form (emails `PUBLIC_FORMS_NOTIFY_EMAIL`) |
| `/consultation` | Paid advisory consultation booking (Stripe) |
| `/help` | Help centre |
| `/privacy` | Privacy policy |
| `/terms` | Terms of service |
| `/auth/login` | Login |
| `/auth/register` | Registration (invite/setup token required for staff/partners) |

---

## 6. Internal Portals

### 6.1 Candidate Dashboard (`/dashboard`)
- View profile, application status, lifecycle status
- Upload required documents
- View and sign contract
- View mobility case (read-only)
- Pay application fee (Stripe/PayPal where applicable)

### 6.2 Recruiter Portal (`/recruiter`)
- Overview: monthly target vs. actual, stats, reports-due banner, supervisor notes
- Candidates: register walk-in leads, search/filter, click-through detail page
- Applications: read-only view of own candidates' applications
- Cases: forward-only stage advancement
- Reports: daily/weekly/monthly submission with auto-populated snapshots

### 6.3 Supervisor Portal (`/supervisor`)
- Overview: country-level stats, campaign target progress
- Recruiters: list with performance stats; detail page with target-setting, report review, notes
- Candidates: full country candidate list with verify/return actions
- Applications: country-scoped read-only
- Cases: country-scoped case management
- Reports: outstanding-to-review and by-period views; country report consolidation

### 6.4 In-House Portal (`/inhouse`)
- Multi-country overview
- Candidate approval (the only role that can approve in the internal pipeline)
- Campaign management
- Portfolio reports (submitted to Director/Management)
- Exception management
- Staff scorecards

### 6.5 Management Portal (`/management`)
- KPI dashboard with full filter controls
- Campaign creation and target-setting
- Partner CRM (add partners, provision logins, MOU tracking)
- Employer client management
- Fee policy configuration
- Full case management (Director/Admin only)
- Report escalation trail

### 6.6 HR Portal (`/hr`)
- Self Applications queue: self-submitted candidates awaiting screening/approval
- Partner Submissions queue: partner-submitted candidates awaiting review
- Attention signals: "ready for approval" and "awaiting reply" summary tiles
- Create Case or Reject for both queues

### 6.7 Operations Portal (`/operations`)
- Case stage management (owns the 11-stage lifecycle)
- Contract issuance
- Document handoff
- Reminders (document/payment)
- Partner candidate review

### 6.8 Finance Portal (`/finance`)
- Milestone payment recording (manual + Stripe Payment Links)
- Receipt file upload
- Payments-due visibility across all cases

### 6.9 Marketing Portal (`/marketing`)
- Job listing CRUD
- Link jobs to Employer Clients
- Manage job status (active/closed/draft)

### 6.10 Partner Portal (`/partner`)
- Submit candidates via Agency Application Form
- View own submissions and their status

### 6.11 Admin Portal (`/admin`)
- Staff account management (create, edit role/supervisor/country, reset password, delete)
- Regions & Countries reference data
- Sectors & Document requirement types
- Per-country document requirements
- System settings (intake mode, AI chatbot toggle, WhatsApp number)
- Knowledge base articles
- Email template overrides

---

## 7. Data Model Summary

### Core Entities

| Model | Description |
|---|---|
| `User` | All platform users; role, supervisor chain, country assignment |
| `Candidate` | Pre-registration or account-linked candidate; lifecycle status, source, recruiter attribution |
| `Application` | CIF submission; programme selection, visa readiness, document checklist |
| `Case` | 11-stage mobility lifecycle; 1:1 with an approved Application |
| `Document` | Uploaded file; stored in R2; verification status |
| `Job` | Work-permit programme; pricing, visa type, permit duration |
| `Partner` | External agency; MOU status, login provisioning |
| `PartnerCandidate` | Agency-submitted candidate; separate from internal pipeline |
| `EmployerClient` | Employer a vacancy is for |
| `Report` | Daily/weekly/monthly submission; rollup chain |
| `Exception` | Ad hoc escalation report with decision workflow |
| `StaffScorecard` | Monthly supervisor-authored performance review |
| `Campaign` | Bounded recruitment drive with targets |
| `CampaignTarget` | Metric target scoped to country/region/campaign |
| `RecruiterTarget` | Supervisor's allocation of a campaign target to a recruiter |
| `StaffKpiTarget` | Supervisor's personal KPI target for a direct report |
| `FeePolicy` | Admin-configurable milestone payment amounts |
| `Contract` | Generated contract with simple e-signature capture |
| `CasePayment` | Milestone payment record (manual or Stripe) |
| `JobMilestonePrice` | Pre-provisioned Stripe Product/Price per Job milestone |
| `ConsultationBooking` | Paid advisory consultation (Stripe) |
| `AuditLog` | Immutable append-only audit trail |
| `CandidateMessage` | Candidate ↔ recruiter messaging thread |
| `RecruiterNote` | One-way supervisor → recruiter note |
| `Region` / `Country` | Geographic reference data; doubles as destination-programme picker |
| `Sector` | Type-of-work taxonomy |
| `DocumentRequirementType` | Admin-managed document type registry |
| `CountryDocumentRequirement` | Per-country extra document requirements |
| `SystemSetting` | Key-value feature flags and configuration |
| `KnowledgeArticle` | AI chatbot FAQ content |
| `EmailTemplate` | Overridable transactional email templates |

---

## 8. Technical Architecture

### Stack
- **Framework:** Next.js 16 (App Router, `output: standalone`)
- **Language:** TypeScript
- **Database:** PostgreSQL via Prisma ORM v6
- **Auth:** Custom JWT (cookie-based) + bcrypt
- **Storage:** Cloudflare R2 (sole document backend)
- **Email:** Nodemailer (SMTP — Zoho Mail in production)
- **Payments:** Stripe (milestone payment links + consultation booking) + PayPal (application fees)
- **AI:** Google Gemini + OpenAI via Vercel AI SDK
- **Validation:** Zod
- **Testing:** Vitest (unit/integration) + Playwright (E2E)
- **Hosting:** Vercel (production) + cPanel Node (documented alternative)
- **Database hosting:** Prisma Postgres (`db.prisma.io`)

### Key Architecture Decisions

- **Service layer:** domain logic lives in `src/server/services/*.ts`; route handlers only parse/validate (Zod) → call service → shape response
- **Row-level scoping:** `scopeToRequester()` in `src/server/scope.ts` — single source of truth for all candidate/case/report list queries
- **Audit logging:** Prisma Client extension (`$extends`) — automatic, cannot be bypassed
- **Document security:** R2-only, never public URLs; signed JWT tokens with RBAC check before issuance
- **No API versioning:** single consumer (own frontend); `/api/v1/` deferred until external partner API access is introduced
- **Design system:** `globals.css` tokens (midnight-950/900/800, gold-400/500, ivory-50/100), Outfit font, Phosphor icons, shared `PortalShell` layout

### Security
- All documents private (R2, never public)
- Signed time-limited document URLs
- Immutable audit log (DB-level triggers)
- Rate limiting on all public mutating routes
- RBAC enforced at API layer (not just UI)
- Row-level scoping prevents cross-tenant data leaks
- Security headers on all routes (HSTS, X-Frame-Options, etc.)
- No secrets in code; `.env`-only

---

## 9. Integrations

| Integration | Status | Purpose |
|---|---|---|
| Stripe | Live (test-mode keys) | Milestone payment links, consultation booking |
| PayPal | Wired | Application fees |
| Cloudflare R2 | Live | Document storage |
| Nodemailer / Zoho Mail | Live | Transactional email |
| Google Gemini / OpenAI | Live | AI chat widget |
| Prisma Postgres | Live | Production database |
| Vercel | Live | Hosting and deployment |
| Google OAuth | Backend wired, UI hidden | Candidate login (pending) |
| Calendly | Deferred | Consultation scheduling |
| DocuSign / Dropbox Sign | Deferred | E-signature vendor |
| Microsoft 365 / Teams | Deferred | Staff communication |
| WhatsApp Business API | Deferred | Candidate messaging |

---

## 10. Non-Functional Requirements

| Requirement | Implementation |
|---|---|
| Security (NFR-4) | RBAC + row-level scoping + signed URLs + rate limiting + security headers |
| GDPR (NFR-5) | Consent capture on `Candidate`; data scoped to minimum necessary per role |
| Audit trail (NFR-6) | Immutable `AuditLog` via Prisma extension + DB-level triggers |
| Document backup (NFR-7) | Cloudflare R2 as sole backend (Vercel-compatible) |
| Staging environment (NFR-9) | `staging` branch; every phase merged to staging before production |
| Multi-language (NFR-10) | Google Translate integration on all public pages |
| Performance | Composite DB indexes on high-frequency query shapes; client-side pagination (15 rows) |
| Accessibility | ARIA roles on all custom components (combobox, listbox, option); table-view fallback for every chart |

---

## 11. Testing Strategy

### Unit / Integration (Vitest)
- `lib/rbac.ts` — portal access matrix
- `server/scope.ts` — row-level scoping (real DB, not mocked)
- `lib/upload.ts` — path-traversal guard, token validation, R2 integration
- `lib/fees.ts` — milestone split computation
- `server/services/screening.ts` — screening gate rules
- `server/services/kpi.ts` — KPI aggregation
- `server/services/reportWorkflow.ts` — report submission/verification chain
- `server/services/caseLifecycle.ts` — case creation and idempotency

### E2E (Playwright)
- `candidate-lifecycle.spec.ts` — full recruiter → supervisor → HR → candidate journey
- `case-lifecycle.spec.ts` — admin approves → case opens → stage advance → contract → candidate signs
- `partner-crm.spec.ts` — management adds partner → provisions login → partner submits candidate
- `self-application.spec.ts` — anonymous submission → HR screens → candidate claims invite → uploads → HR approves → Case created
- `report-workflow.spec.ts` — recruiter submits → supervisor verifies → management escalation (stale, needs rewrite)
- `rbac.spec.ts` — portal access matrix regression coverage

---

## 12. Deferred / Out of Scope

The following are confirmed-deferred, not oversights:

| Feature | Reason |
|---|---|
| Automated report reminders | Needs background scheduler; not required by SRS FR-3.4 wording |
| PDF export | CSV export satisfies FR-3.8; no new dependency justified |
| DocuSign / Dropbox Sign | No vendor account yet; Contract model is the groundwork |
| Microsoft 365 / Teams | No account yet |
| Calendly integration | No account yet |
| WhatsApp Business API | No account yet |
| BI / analytics layer | No account yet |
| Partner-acquisition email marketing | No account yet |
| Staff-side partner candidate assignment queue | Confirmed deferred by business (2026-07-10) |
| Google OAuth UI button | Hidden pending business decision; backend fully wired |
| API versioning (`/api/v1/`) | No external consumer yet; deferred until partner API access introduced |
| Automated permit/visa deadline reminders | Same reasoning as report reminders |
| Content Security Policy | Needs dedicated pass accounting for Google Translate + widget embeds |

---

## 13. Known Gaps & Open Items

| Item | Priority | Notes |
|---|---|---|
| `e2e/report-workflow.spec.ts` is stale | Medium | Predates Supervisory Reporting Framework UI rewrite; needs full rewrite |
| Staff-side partner candidate assignment queue | High | Submissions sit at `submitted` forever; only signal is a notification email to an unset address (`PARTNER_SUBMISSION_NOTIFY_EMAIL`) |
| `PARTNER_SUBMISSION_NOTIFY_EMAIL` not configured | High | Partner submissions generate no staff notification until set |
| `PUBLIC_FORMS_NOTIFY_EMAIL` required for email intake mode | High | Public form submissions vanish silently if unset in email mode |
| Real SMTP credentials needed | High | `.env` has placeholder values; no email sends in dev |
| Stripe keys are test-mode | Medium | Need live-mode keys before real payments |
| `PATCH /api/candidates/:id` excludes `inhouse_supervisor`/`director` | Low | Likely an oversight; worth reviewing |
| Candidate stuck at `screened` if invite never claimed | Low | No staff-driven fallback; admin override is the escape hatch |
| No demo candidate in `vertex_dev` | Low | Register via `/apply` or recruiter portal to create one |
