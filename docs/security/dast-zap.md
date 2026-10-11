# Dynamic application security testing (OWASP ZAP)

Phase 8. Scans run 2026-10-11 against the local **vertex-staging** stack, at
commit `26a83f6`, with ZAP 2.17.0. vertex-main (real data) and any hosted
system were out of scope; `scan-staging.sh` refuses vertex-main.

## 1. Method

`vertex_be/deploy/zap/scan-staging.sh vertex-staging .env.staging` (from `vertex_be/`):

- **Placement.** ZAP runs in a container on the stack's `edge` network and targets `nextjs:3000` and `backend:8000` directly. Nothing new is published, and ZAP can't reach the database network.
- **Coverage.** Two passes:
  1. **Unauthenticated.**
  2. **Authenticated** as a temporary admin, `zap-scan-admin`. Admin is the role with the widest reach. The account is created for the run and removed by an `EXIT` trap, even if the run fails.
- **Seeding.** Every API route from the code inventory (`routes.json`, 155 handlers) is requested, because Next.js API routes aren't linked from pages and a spider would miss them. The backend is imported from its OpenAPI document. Then come the spider, the passive scan and an active scan (25 min on Next.js, 5 min on the backend).
- **Session handling.** The session token is filled into the plan inside the container's `/tmp`, so it is never on the host disk or a command line. ZAP 2.17 does not expand `${ENV}` in replacer rules.
- **Canary.** Each pass first requests `/api/auth/me`, expecting 200 when authenticated and 401 when not, and the run fails if the code differs. That is how we learned the first authenticated run was **not** authenticated (see §4). Its results were discarded.
- **Reports.** Saved to `D:/VertexData/security-scans/<project>-<stamp>/` and passed through `sanitize_report.py`, which removes session cookies, `token=` values, bearer tokens and JWT-shaped strings (0 left in every report).

## 2. Findings and disposition

Valid run: `vertex-staging-20261011-131303`.

| ZAP alert | Risk | Where | Verdict | Fix |
|---|---|---|---|---|
| Content Security Policy not set (10038) | Medium | all Next.js pages | **Valid** | CSP in `next.config.ts`: `default-src 'self'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, `frame-ancestors 'none'`. External sources limited to Google Translate and Calendly, the only external scripts the pages load. Google Translate is now loaded over `https://` (it was protocol-relative) |
| X-Powered-By: Next.js (10037) | Low | all Next.js responses | **Valid** | `poweredByHeader: false` |
| X-Content-Type-Options missing (10021) | Low | backend | **Valid** | `SecurityHeadersMiddleware`: `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Cross-Origin-Resource-Policy`, and a `default-src 'none'` CSP except on `/docs` and `/redoc` |
| Application error disclosure (90022), 3 unauthenticated | Low | `/api/auth/google`, `/api/chat`, `/api/consultations/checkout` | **Valid** (wrong status; bodies were generic, no stack traces) | Not configured → 503. Chat: invalid body → 400/422; no AI key → 503. Checkout: Stripe failure → 503, logged |
| Application error disclosure (90022), 11 more authenticated | Low (symptom of a **High** defect) | case, payment, finance and job routes | **Valid: schema drift** (§3) | Migration `0004`, and CI now tests against the deployed schema |
| Sensitive information in URL (10024) | Info | `/contact?email=…` | **Valid** | 29 forms in 26 files had no `method` and fell back to GET before hydration, which would put the field values in the URL, including the login password. All now `method="post"`. With JavaScript running nothing changes |
| User-controllable HTML attribute (10031) | Info | `/jobs?q=…&country=…` | **False positive** | React escapes attribute values. No change |
| User agent fuzzer (10104) | Info | both | **Informational** | No change |

**Not found in either pass:**

- SQL injection
- XSS (reflected or stored)
- path traversal
- remote code execution
- access-control failures (the authenticated pass reached the same set of errors as the unauthenticated one plus the drift endpoints)
- missing session cookie flags

**Also fixed while triaging:** `/api/chat` accepted any message role, so a caller could inject `system` instructions into the assistant. Now only `user`/`assistant` turns are accepted, at most 30, 4,000 characters each. The widget sends its last 20.

## 3. Schema drift (the High finding)

The authenticated 500s came from Prisma errors (`P2021`/`P2022`). The Next.js code and the deployed database had diverged:

- **Prisma needed, the database lacked:**
  - the `JobMilestonePrice` table
  - the `MilestonePaymentType` enum
  - `Case.stage_deadline`
  - `CasePayment.type`
- **The database had, Prisma didn't know:**
  - the referral tables
  - the job sector and position tables
  - `JobPaymentStage`
  - 8 columns
  - extra enum values

Case lists, case details, payments and job edits failed on **every** stack, vertex-main included.

**Why tests didn't catch it.** CI built its databases with `prisma db push`, from the Prisma schema. Deployed stacks are built with Alembic. Each path was internally consistent, so every test passed.

**Fix (owner decision: additive):**

- **Migration `0004`** adds what the app needs and drops nothing.
  - `CasePayment.type` is backfilled from each payment's stage: on main, 44 `documentation`, 25 `permit`, 11 `visa`. The migration aborts if any payment can't be mapped.
  - `CasePayment.job_payment_stage_id` becomes nullable, because the app doesn't set it.
  - Rehearsed on a disposable copy of main's data before release.
- **CI** now builds the Next.js and end-to-end test databases with `alembic upgrade head`, the deployed path. The full Next.js suite passes against it: 302 tests plus the 3 expected failures.

**Still open (tracked):** vertex-main has 5 `PartnerCandidate` rows with status `draft`, a value the Next.js enum doesn't have. Two of them have NULLs in fields Prisma treats as required. Listing partner candidates on main fails while they exist. The fix touches about 12 query sites and the `job` relation, so it's a separate change.

## 4. Problems with the scanning itself

| Problem | Effect | Fix |
|---|---|---|
| Script resolved its own directory as `/d/…` | First run never started ZAP, and left the scan account behind | `pwd -W`; the account is removed in an `EXIT` trap |
| ZAP 2.17 doesn't expand `${ENV}` in replacer and requestor fields | The "authenticated" pass was unauthenticated (every request 401) | Placeholder filled inside the container; the canary now fails any run whose session doesn't work |

## 5. Retest

After the fixes are deployed to staging, the same scan is run again. Expected: no CSP, X-Powered-By, `nosniff` or error-disclosure alerts, and both canaries pass.

Results: *(added after the staging deploy)*
