# Vertex Project Guide

## 1. Project Summary

Vertex is an international recruitment and worker-mobility platform. It replaces disconnected forms, email threads, spreadsheets, and manual case tracking with one system of record for:

- Public job and programme discovery.
- Candidate intake and application processing.
- Recruiter, supervisor, HR, operations, finance, marketing, partner, director, and administrator workflows.
- Secure document collection and verification.
- Reporting, KPI targets, campaigns, exceptions, and scorecards.
- Work-permit, visa, payment, contract, departure, and retention case management.

The repository contains two projects:

1. `vertex/` is the implemented web platform.
2. `vertex_app/` is a Flutter multi-platform scaffold that currently contains the default counter example, not a connected Vertex mobile application.

The web application is the production product. It is a Next.js App Router application with React and TypeScript on the frontend and backend, PostgreSQL accessed through Prisma, JWT authentication, role-based access control, private Cloudflare R2 document storage, email notifications, Stripe and PayPal payments, and Vitest/Playwright tests.

## 2. Repository Map

```text
Vertex/
├── README.md                         Repository-level overview
├── vertex/                           Implemented Next.js application
│   ├── src/app/                      Pages, layouts, loading UI, and API routes
│   ├── src/components/               Shared React UI components
│   ├── src/lib/                      Auth, validation, integrations, hooks, constants
│   ├── src/server/                   Server-only access rules and domain services
│   ├── prisma/                       PostgreSQL schema, seed, and SQL hardening
│   ├── public/                       Public static assets
│   ├── e2e/                          Playwright end-to-end tests
│   ├── docs/                         Product, architecture, operations, and deployment docs
│   ├── package.json                  Scripts and dependencies
│   ├── next.config.ts                Next.js security/build configuration
│   ├── build-cpanel.mjs              cPanel standalone packaging script
│   ├── proxy.ts                      Authentication and portal redirects
│   └── configuration files            TypeScript, ESLint, Tailwind/PostCSS, Vitest, Playwright
└── vertex_app/                       Flutter application scaffold
    ├── lib/main.dart                 Default Flutter counter application
    ├── test/widget_test.dart          Default counter widget test
    └── platform folders               Android, iOS, web, Windows, macOS, and Linux runners
```

## 3. Runtime Architecture

```text
Browser / partner / candidate
          |
          v
Next.js App Router pages and client components
          |
          v
Route handlers under src/app/api
          |
          +--> JWT/API auth and Zod validation
          +--> RBAC and row-level scope checks
          +--> Domain services under src/server/services
          +--> Prisma client
                    |
                    +--> PostgreSQL
                    +--> Cloudflare R2 for private documents
                    +--> SMTP for email
                    +--> Stripe / PayPal for payments
                    +--> Google/OpenAI through the AI SDK for chat
```

### Request lifecycle

1. A browser requests a public page or an authenticated portal page.
2. `src/proxy.ts` checks the `auth_token` cookie for protected portal prefixes.
3. The JWT role is checked against the requested portal through `src/lib/rbac.ts`.
4. An API route authenticates the request, validates input with Zod, and applies role and row-level scope rules.
5. A server service performs the business operation and uses Prisma for persistence.
6. Mutations that require governance are audit logged.
7. The route returns a response to a page or client component.

The main architectural boundary is intentional: pages and route handlers coordinate requests, while `src/server` owns reusable business rules such as lifecycle transitions, scope, document completeness, reporting, KPI aggregation, and case progression.

## 4. Product Areas

### Public experience

- `/` is the branded homepage with featured programmes and service information.
- `/jobs` lists available jobs/programmes with category filtering and pagination.
- `/jobs/[id]` shows programme details, salary, requirements, fees, processing information, and application actions.
- `/apply` is the Candidate Information Form. It can collect a public self-application or support an authenticated flow.
- `/consultation` provides paid advisory consultation booking.
- `/contact`, `/help`, `/about`, `/privacy`, and `/terms` provide public information and support.
- The AI chat widget can appear on public pages and uses admin-managed knowledge articles and system settings.

### Candidate portal

The `/dashboard` portal lets a candidate manage their profile, view application status, upload documents, communicate with their assigned recruiter, view case progress, sign a contract, and complete eligible payments.

### Internal operational network

- **Regional recruiter (`/recruiter`)** registers and manages sourced candidates, progresses the early funnel, submits reports, and manages assigned cases within permitted boundaries.
- **Country supervisor (`/supervisor`)** reviews recruiter work, verifies candidates, consolidates country reports, sets recruiter targets, and writes recruiter notes.
- **In-house supervisor (`/inhouse`)** oversees multiple countries, manages campaigns, approves internal candidates, reviews portfolio reporting, and manages exceptions.
- **Director (`/management`)** has management-level visibility and controls for KPI dashboards, campaigns, partners, employers, fee policies, cases, and escalations.

### Separation-of-duties portals

- **HR (`/hr`)** reviews self-submitted and partner-submitted candidates, performs screening/approval decisions, and creates or rejects cases.
- **Operations (`/operations`)** owns the case journey, document handoff, contracts, reminders, and operations review gates.
- **Finance (`/finance`)** records milestone payments, manages payment links and receipts, and monitors payments due.
- **Marketing (`/marketing`)** owns job and programme listings and does not inherit the wider candidate workflow permissions.
- **Partner (`/partner`)** is an external agency portal restricted to that partner's submissions and case visibility.
- **Admin (`/admin`)** provisions users and manages reference data, settings, document requirements, countries, regions, sectors, knowledge articles, and backups.

## 5. Main Business Workflows

### Candidate intake and screening

The candidate lifecycle is:

```text
identified -> screened -> guided_to_apply -> submitted
           -> reported -> verified -> approved -> Case created
                                              \-> rejected
```

The screening service evaluates required identity, contact, age, passport, consent, and selected-job data. Document completeness then checks universal requirements and destination-country requirements. A candidate may be recruiter-sourced before having a `User` account; this is why `Candidate.user_id` is nullable.

### Partner submissions

Partner candidates use a separate funnel and are reviewed by HR and Operations rather than entering the internal recruiter/supervisor pipeline. Once approved, a real candidate/application relationship is created or linked and the mobility case process can begin.

### Case lifecycle

An approved application produces one case. Operations controls the eleven-stage journey from registration and document submission through work-permit processing, visa preparation, pre-departure, and arrival support. Stage events preserve ownership and timing. Finance handles payment milestones, HR owns the initial decision, and operations must satisfy the operations review gate before advancing applicable stages. A retention follow-up is created after the final stage.

### Reporting and governance

Reports can be daily, weekly, or monthly and operate at recruiter, country, or in-house scope. Reports move upward through verification and consolidation. Exceptions provide an ad hoc escalation path, while scorecards and KPI targets support structured staff performance management.

### Payments and contracts

Self-applicants can use Stripe or PayPal flows where enabled. Partner- and recruiter-sourced payments can be recorded manually with a receipt document. Fee policies are configurable and disabled by default. Operations generates contracts; candidates sign using an authenticated typed-name attestation, timestamp, and IP address.

## 6. Source Code Directory Guide

### `src/app`

This is the Next.js App Router. Folders with `page.tsx` are user-facing routes; folders under `api` contain backend route handlers.

#### Application shell and public routes

- `layout.tsx`: root metadata, fonts, global shell, and shared providers.
- `globals.css`: Tailwind import, Vertex tokens, typography, buttons, inputs, cards, badges, and animation utilities.
- `loading.tsx`: shared loading state.
- `opengraph-image.tsx`: generated social preview image.
- `page.tsx`: homepage.
- `about/`, `contact/`, `help/`, `privacy/`, `terms/`: informational and support pages.
- `jobs/`: public job list, job details, filtering, and payment/application entry points.
- `apply/`: Candidate Information Form entry point.
- `consultation/`: consultation landing and confirmation pages.

#### Authentication routes

- `auth/login/`: password login and redirect handling.
- `auth/register/`: account creation, including invite/setup-token flows.
- `auth/forgot-password/` and `auth/reset-password/`: password recovery.
- `auth/verify-email/`: email verification.

#### Portal routes

- `dashboard/`: candidate profile, documents, messages, applications, and cases.
- `recruiter/`: recruiter overview, candidates, cases, reports, and exceptions.
- `supervisor/`: country supervision, recruiter management, candidates, cases, reports, and exceptions.
- `inhouse/`: multi-country oversight, campaigns, reports, cases, and exceptions.
- `management/`: KPI dashboards, cases, reports, partners, campaigns, fee policy, employer clients, exceptions, and backup.
- `hr/`: self-applications, partner candidates, cases, and backup.
- `operations/`: partner candidates, cases, consultations, and backup.
- `finance/`: case payment and consultation views.
- `marketing/`: job listing creation and editing.
- `partner/`: partner dashboard, candidate submissions, and cases.
- `admin/`: users, regions, sectors, settings, document requirements, and administrative tools.

### `src/app/api`

API route families are organized by business capability:

- `auth/`: login, logout, registration, verification, password reset, Google OAuth, and current-user lookup.
- `candidates/`: candidate creation, editing, status transitions, profile, application, exports, and messages.
- `applications/`: application reads and updates.
- `jobs/`: public and staff job operations.
- `documents/`: upload, signed URL issuance, secure file streaming, and verification.
- `cases/`: case reads, stage transitions, rejection, operations review, retention, reminders, contracts, audit, invoices, payments, and receipts.
- `partner-candidates/` and `partners/`: partner CRM and partner-scoped workflows.
- `reports/`: report submission, verification, return/resubmit, consolidation, and previews.
- `campaigns/`, `dashboard/kpis/`, and target routes: campaigns, KPI aggregation, and target management.
- `exceptions/`, `scorecards/`, `recruiter-notes/`, and staff target routes: governance and performance workflows.
- `regions/`, `countries/`, `sectors/`, `document-requirements/`, and `employer-clients/`: admin-managed reference data.
- `payments/`, `stripe/`, `paypal/`, and `consultation/`: payment and booking integrations.
- `chat/`, `contact/`, `rate-limit/`, `backups/`, and `settings/`: public communication, AI, backup, throttling, and platform settings.

### `src/components`

Shared components provide reusable UI and keep route pages focused on composition:

- `Navbar.tsx`, `Footer.tsx`, `HomeClient.tsx`, `WelcomePopup.tsx`, `WhatsAppButton.tsx`: public site shell and engagement.
- `ApplicationForm.tsx`, `CandidateProfileForm.tsx`, `CandidateMessages.tsx`, `CandidateCaseCard.tsx`: candidate workflows.
- `DocumentLink.tsx`, `DocumentVerifyControls.tsx`, `SupportingDocumentUpload.tsx`: private document operations.
- `AIChatWidget.tsx`, `CalendlyEmbed.tsx`, `ServiceFeeNotice.tsx`: chat, consultations, and payment notices.
- `AdminSettings.tsx`, `BackupExport.tsx`: administrative configuration and exports.
- `Pagination.tsx`, `SortableTh.tsx`, `SearchableSelect.tsx`, `JobsCategoryFilter.tsx`, `YesNoDetailField.tsx`: common table and form controls.
- `PasswordInput.tsx`: password input behavior and visibility control.

#### `src/components/portal`

- `PortalShell.tsx`: shared authenticated portal layout.
- `*Nav.ts`: role-specific navigation definitions.
- `CandidateList.tsx`, `CandidateDetail.tsx`, `CandidateEditDetails.tsx`, `CandidateStatusControls.tsx`: CRM candidate views and actions.
- `RegisterCandidateForm.tsx`: recruiter lead registration.
- `PartnerCandidateForm.tsx`, `PartnerSubmissionDetail.tsx`: agency submission workflows.
- `CaseList.tsx`, `CaseDetail.tsx`, `CaseStageProgress.tsx`, `caseStages.ts`: case views and stage presentation.
- `ApplicationEditDetails.tsx`, `CandidateDocumentUpload.tsx`, `HrCandidateStatusControls.tsx`, `OpsReviewBadge.tsx`: role-specific operations.
- `reports/`: report forms, tables, KPI tables, consolidation, and period views.
- `kpi/`: dashboard cards, charts, target-versus-actual displays, and filters.
- `exceptions/`: exception lists, detail views, decision controls, and corrective actions.
- `StaffKpiTargetPanel.tsx`, `StaffScorecardPanel.tsx`, `ConsultationBookingsList.tsx`, `DeadlineCell.tsx`, and `FilterBar.tsx`: portal dashboard controls.

### `src/lib`

- `auth.ts`: password hashing, authentication helpers, and account operations.
- `jwt.ts`: JWT creation/verification, including short-lived document tokens.
- `api-auth.ts`: authenticated API request helpers and current-user resolution.
- `rbac.ts`: central role permissions, portal access, and role home paths.
- `prisma.ts`: shared Prisma client instance.
- `audit.ts`: audited Prisma operations and audit persistence.
- `upload.ts`: R2 storage, MIME and size validation, private file handling, and signed access.
- `validations.ts`: Zod request and form schemas.
- `candidateLifecycleStatus.ts`, `partnerCandidateStatus.ts`, `documentTypes.ts`: domain status and document definitions.
- `reportPeriods.ts`, `reportTemplates.ts`: reporting periods and role/cadence-specific report shapes.
- `fees.ts`, `invoice.ts`, `stripe.ts`, `paypal.ts`: fee calculations, invoices, and payment providers.
- `email.ts`: SMTP email and notification templates/workflows.
- `rate-limit.ts`: throttling for public and mutating requests.
- `gender.ts`, `maritalStatus.ts`, `worldCountries.ts`: controlled reference values.
- `useDebouncedValue.ts`, `usePagination.ts`, `useUrlListState.ts`: client-side list and search hooks.
- Test files such as `rbac.test.ts`, `fees.test.ts`, and `upload.test.ts` test focused library behavior.

### `src/server`

- `scope.ts`: row-level access rules for candidates, cases, reports, partners, HR, Operations, Finance, directors, and administrators.
- `services/candidateLifecycle.ts`: legal candidate status transitions.
- `services/screening.ts`: screening gate evaluation and invite behavior.
- `services/documentCompleteness.ts`: universal and country-specific document requirements.
- `services/caseLifecycle.ts`: case creation and stage transitions.
- `services/paymentSchedule.ts` and `services/stripeProvisioning.ts`: payment milestones and Stripe setup.
- `services/publicJobs.ts`: public job queries and visibility rules.
- `services/reportWorkflow.ts` and `services/reportConsolidation.ts`: report permissions, verification, and rollups.
- `services/kpi.ts`: live KPI aggregation and target-versus-actual calculations.
- `services/exceptionWorkflow.ts`: escalation and corrective-action rules.
- `services/scorecardScoring.ts`: staff scorecard categories and scoring.
- `services/candidateSignals.ts`: attention and urgency signals for staff queues.

## 7. Database Model

`prisma/schema.prisma` defines a PostgreSQL schema. The model groups are:

### Identity and reference data

- `User`: account identity, role, supervisor, assigned country, and relationships to staff work.
- `Region` and `Country`: destination and organizational reference data.
- `Sector`: controlled job/work taxonomy.
- `SystemSetting`, `KnowledgeArticle`, and `EmailTemplate`: runtime configuration and content.

### Candidate and application data

- `Candidate`: identity, passport/contact data, source, recruiter/country attribution, lifecycle, consent, and screening outcome.
- `Application`: a candidate's application for a `Job`, preferred destinations, readiness information, and status.
- `Document`: private candidate or payment-receipt files and their verification status.
- `DocumentRequirementType` and `CountryDocumentRequirement`: admin-configurable document checklists.
- `CandidateMessage`: one continuous candidate/recruiter conversation.
- `AuditLog`: append-only before/after records for governed mutations.

### Jobs, payments, and consultations

- `Job`: public work-permit programme listing.
- `JobMilestonePrice`: per-job milestone pricing.
- `Payment`: candidate payment records.
- `ConsultationBooking`: paid consultation bookings.
- `FeePolicy`: global or country-specific payment policy.

### Case operations

- `Case`: one mobility case for an approved application.
- `CaseStageEvent`: stage history, owner, timing, and notes.
- `CaseReminder`: operational reminders by channel.
- `RetentionFollowUp`: post-arrival follow-up.
- `CasePayment`: milestone payment status and receipt linkage.
- `Contract`: generated contract, signature, and lifecycle status.

### Reporting, targets, and governance

- `Report`: daily, weekly, monthly, recruiter, country, or in-house reporting.
- `Exception` and `ExceptionCorrectiveAction`: escalations and decisions.
- `StaffScorecard` and `StaffScorecardArea`: structured performance reviews.
- `Campaign` and `CampaignTarget`: time-bounded campaigns and aggregate targets.
- `RecruiterTarget`: distribution of campaign targets to recruiters.
- `InhouseCountryAssignment`: multi-country in-house supervision.
- `StaffKpiTarget`: direct-report KPI targets.
- `RecruiterNote`: supervisor-to-recruiter notes.

### Partner and employer CRM

- `Partner`: agency identity, type, status, contacts, and MOU status.
- `PartnerCandidate`: partner-owned submission funnel.
- `EmployerClient`: employer relationship linked to jobs.

The schema uses enums for roles, statuses, report cycles, case stages, payment states, partner states, and governance decisions. Indexes are placed on common scope and status fields such as recruiter, country, lifecycle status, entity/actor audit lookups, and dates.

`prisma/seed.ts` creates initial reference and application data. `prisma/audit-log-immutability.sql` adds database triggers that reject updates and deletes of audit records, complementing application-level audit logging.

## 8. Security and Data Protection

- Passwords are bcrypt-hashed.
- Sessions use JWTs in the `auth_token` cookie.
- Portal access is checked at the proxy and API/service layers.
- Row-level scope prevents users from reading unrelated candidates, cases, reports, or partner data.
- Public mutating endpoints are rate limited.
- Documents are stored privately in Cloudflare R2 and read through short-lived signed tokens, never permanent public URLs.
- MIME type and file-size checks protect the upload path.
- Security headers include frame protection, MIME sniffing protection, strict referrer policy, permissions policy, and HSTS.
- Audit records capture actor, action, entity, and before/after state.
- The database immutability SQL protects audit records even if an application path is compromised.

## 9. Visual Theme and Frontend Design System

The brand language is a restrained editorial recruitment and mobility interface rather than a generic admin dashboard.

### Palette

- `midnight-950` `#03120d`: deepest green-black background and navigation.
- `midnight-900` `#062119` and `midnight-800` `#0a3326`: dark surfaces and headings.
- `midnight-500` `#1ca36a`: green brand accent.
- `ivory-50` `#fbf9f4`, `ivory-100` `#f5f1e8`, `ivory-200` `#eae3d3`: warm paper-like backgrounds and borders.
- `gold-300` `#e6cd85`, `gold-400` `#d4af5c`, `gold-500` `#c8a24b`: restrained premium accent for active states, labels, and calls to action.

### Typography and components

- The primary font is Outfit, configured as the Tailwind sans family.
- `.eyebrow` and `.section-title` create an editorial hierarchy for public pages.
- `.btn-primary`, `.btn-secondary`, `.btn-gold`, and `.btn-ghost-dark` express action priority.
- `.input-field` standardizes forms.
- `.card` supplies white framed content on ivory surfaces.
- `.badge-*` classes provide compact state communication.
- `.glass`, perspective utilities, and `animate-marquee` support selected homepage effects.

The portal shell carries the same brand into dense operational screens: dark navigation, ivory workspace, gold emphasis, consistent status badges, clear tables, filters, and workflow controls. Google Translate styling is normalized in the global stylesheet.

## 10. Configuration and Integrations

- `package.json`: development, build, seed, lint, unit-test, and E2E scripts; dependencies for Next.js, React, Prisma, payments, AI, email, uploads, icons, animation, and testing.
- `tsconfig.json`: TypeScript compiler and `@/*` source alias.
- `eslint.config.mjs`: ESLint rules.
- `postcss.config.mjs`: Tailwind/PostCSS integration.
- `vitest.config.ts` and `vitest.setup.ts`: unit/service test configuration.
- `playwright.config.ts`: Chromium E2E configuration, web server, and test setup.
- `next-env.d.ts`: generated Next.js type declarations.
- `next.config.ts`: security response headers and self-hosted standalone output behavior.
- `vercel.json`: legacy/interim Vercel region configuration; cPanel is the documented production target.
- `build-cpanel.mjs`: builds the standalone app, relocates static assets for Passenger, and creates `app.js`.
- `probe.js`: legacy diagnostic file; it is excluded from deployment and should not contain live credentials.

External integrations are isolated behind library modules:

- SMTP/Nodemailer for transactional email.
- Stripe for checkout, payment links, prices, and webhooks.
- PayPal for supported candidate payments.
- Cloudflare R2 through the AWS S3 client for document storage and backup.
- Google Gemini/OpenAI through the Vercel AI SDK for chat.
- Google OAuth backend support for account authentication.

## 11. Testing Strategy

- **Unit tests:** `src/lib` and `src/server/services` cover RBAC, scopes, lifecycle rules, fees, upload validation, screening, document completeness, reports, cases, KPIs, exceptions, scorecards, and payment behavior.
- **Integration tests:** validate service interactions such as cases, document completeness, and KPI aggregation.
- **Playwright E2E:** `e2e/candidate-lifecycle.spec.ts`, `case-lifecycle.spec.ts`, `partner-crm.spec.ts`, `rbac.spec.ts`, `report-workflow.spec.ts`, and `self-application.spec.ts` exercise complete browser workflows.
- **Flutter test:** `vertex_app/test/widget_test.dart` currently tests the generated counter app and does not cover Vertex behavior.

Common web commands from `vertex/`:

```bash
npm install
npm run dev
npm run lint
npm run test
npm run test:e2e
npm run build
npm run db:seed
```

Database setup uses `DATABASE_URL` and Prisma. For a new database, run `npx prisma db push`, seed data, and apply the audit immutability SQL.

## 12. Deployment

The current production deployment target is cPanel Node hosting with Passenger:

1. Run `node build-cpanel.mjs` from `vertex/`.
2. Upload the generated standalone package without `.env`.
3. Set environment variables in cPanel, including database, JWT, SMTP, payment, R2, AI, and rate-limit settings.
4. Configure `app.js` as the Passenger startup file.
5. Restart the application and verify CSS/static assets, login, database access, uploads, and payments.

The app uses `output: 'standalone'` so it can run as a self-hosted Node process. Older README/PRD text mentions Vercel, but the dedicated cPanel deployment guide and current storage architecture are the authoritative production path.

## 13. Current Status and Boundaries

Implemented web capabilities are broad and cover the full recruitment-to-mobility workflow. The following boundaries are important when explaining the repository:

- The Flutter project is not yet a mobile client; it is generated platform scaffolding plus the default counter screen.
- `docs/PLATFORM_ARCHITECTURE.md` is a delivery plan and contains superseded decisions. Use the live Prisma schema and implementation files for current behavior.
- The public forms can be configured for CRM persistence or notification-email intake through admin settings.
- Partner candidates intentionally use a separate pipeline from internally sourced candidates.
- Audit immutability requires the raw SQL trigger to be applied; Prisma schema synchronization alone does not install it.
- Production secrets belong in environment variables and must never be committed or included in deployment archives.

## 14. Recommended Reading Order

1. `README.md` for the shortest setup path.
2. `docs/PRD.md` for business requirements and user workflows.
3. `prisma/schema.prisma` for the authoritative data model.
4. `src/lib/rbac.ts` and `src/proxy.ts` for access control.
5. `src/server/scope.ts` for row-level authorization.
6. `src/server/services/` for domain behavior.
7. `src/app/` and `src/components/portal/` for user interfaces.
8. `docs/CPANEL_DEPLOYMENT.md` for production operations.
9. `e2e/` and service tests for executable workflow examples.
