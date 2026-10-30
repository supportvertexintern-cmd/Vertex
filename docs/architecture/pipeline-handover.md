# Candidate pipeline handover (backend plan step 6)

Status: **switched** (step 6.7): FastAPI writes the candidate pipeline. Decided by the owner on 2026-10-29 (§3). Follows `data-ownership.md`
§2.2, which makes the pipeline one ownership handover.

## 1. What moves

Every write to these tables moves from Next.js to FastAPI:

| Group | Tables |
|---|---|
| Candidates | `Candidate`, `CandidateMessage` |
| Documents | `Document` |
| Applications | `Application` |
| Cases | `Case`, `CaseStageEvent`, `CaseReminder`, `Contract`, `RetentionFollowUp` |
| Exceptions | `Exception`, `ExceptionCorrectiveAction` |
| Partner submissions | `PartnerCandidate` |
| Referral commissions | `ReferralCommission` (see §2.4) |

Today these are written from **32 Next.js files**: 27 route handlers and 5
services (`caseLifecycle.ts`, `screening.ts`, `partnerCandidateSubmission.ts`,
`referralMilestones.ts`, `document-access.ts`). `ExceptionCorrectiveAction`
has no writer yet.

As in steps 2–5, **writes move and reads stay** in Next.js until a later
step: the lists, detail pages and dashboards read these tables through the
scoping in `server/scope.ts`, and moving them adds risk without changing
who owns the data.

## 2. What makes this area different

### 2.1 Handlers write across the whole cluster

`POST /api/applications` writes `Candidate` and `Application`; rejecting a
case writes `Case`, `Candidate` and `Application`; partner routes write
`Candidate` and `Application`. That's why §2.2 makes the cluster one unit.
It also means the sub-steps below can't each hand over a table cleanly:
until the last one, a table can be written by a moved route (FastAPI) and
a not-yet-moved route (Next.js).

### 2.2 Eleven of these handlers send email

Submitting an application, an application's status change, approving a
candidate, inviting a screened candidate, a staff message, a case's stage
change, rejection and reminder, partner case creation and rejection, and a
referral commission send 13 kinds of email between them (`lib/email.ts`
has 35 senders in all, which read `EmailTemplate` overrides).
FastAPI sends no email today, and never calls back into Next.js.

### 2.3 Documents are files as well as rows

`POST /api/upload` stores the file (S3/MinIO, `lib/upload.ts`), scans it
(`lib/malware-scan.ts`), then creates the `Document` row; public form
uploads carry a signed `X-Upload-Token`. Security exception **E2** (MinIO)
expires on **2027-01-10 or the first real document on vertex-main**: the S3
cutover has to happen before documents are stored on main, whoever stores
them.

### 2.4 Referral commissions follow pipeline events

`generateReferralCommissionIfDue` (`lib/referralMilestones.ts`) writes a
`ReferralCommission` when a referred candidate reaches a milestone
(qualified, application submitted, case stages). Only pipeline flows call
it, so the table moves with the pipeline instead of waiting for Payments.

### 2.5 Registration claims a candidate

The Candidate already exists: the Candidate Information Form created it,
and screening emailed an invite. `POST /api/auth/register` creates the
`User` and claims the `Candidate` with it (links it, moves it to
`guided_to_apply`, and to `submitted` if the form already carried every
required document). Users stay in Next.js (§2.3 of `data-ownership.md`),
so registration keeps creating the `User` and claims the `Candidate`
through FastAPI.

## 3. Decisions

**Owner's decisions (2026-10-29):** D1 **A** (the website sends the
emails), D2 **A** (FastAPI handles uploads end to end), D3 **B** (one
switch), D4 **keep today's behaviour**. The options considered follow.

### D1. Who sends the pipeline's emails?

| Option | How | Cost |
|---|---|---|
| **A. Next.js, after FastAPI answers (recommended)** | The route passes the write to FastAPI; on success it sends the email it sends today, from the response | No email code moves; templates, `EmailTemplate` overrides and Mailpit stay as they are. An email can fail after the write succeeded, as it can today |
| B. FastAPI | Port the 13 senders, the HTML templates and the override lookup to Python; FastAPI gets SMTP settings | Duplicate templates until Users moves (account emails stay in Next.js), or all 35 move now |

### D2. Who handles document uploads?

| Option | How | Cost |
|---|---|---|
| **A. FastAPI, end to end (recommended)** | Next.js passes the multipart upload on; FastAPI checks the token, stores the file, scans it and creates the row in one place | Port the storage client and the scanner call to Python; the upload path gets a streaming pass-through in `callBackend()` |
| B. Split | Next.js stores and scans, then asks FastAPI to create the row; on failure, Next.js deletes the file | Two services per upload, and a stored file whose row failed must be cleaned up; the row's writer never sees the file |

Either way, **the S3 cutover (E2) comes first**, as its own step.

### D3. How does the cluster switch over?

| Option | How | Cost |
|---|---|---|
| **A. Move group by group, revoke at the end (recommended)** | Each sub-step moves a group's write routes to FastAPI and ships; `vertex_web` keeps its write grants on the cluster until the last sub-step, which revokes them all and removes the dead Next.js code | For the weeks in between, some tables have two writers (both audited). Each PR is reviewable on its own, like steps 2–5 |
| B. One big switch behind a flag | Build every group in FastAPI with the Next.js routes unchanged, then flip all routes and revoke grants in one release | One very large PR and one risky release; nothing reaches dev until all of it is done |

### D4. Q2 and Q3 (open since Phase 2)

- **Q2:** any HR or operations user can read any partner-submitted candidate.
- **Q3:** reviewer roles see every application, regardless of region.

FastAPI checks access on every write it takes over, so it needs the
intended rule. **Decided: keep today's behaviour** (global for those
roles). Tightening it is a separate change with its own tests.

## 4. Steps

D3 B means nothing switches until every group is built, but the building
still happens in reviewable PRs. Each group's FastAPI endpoints ship behind
`PIPELINE_WRITES_ENABLED` (off by default): they answer 503 until the
switch, so the website keeps writing as today and nothing else (the staff
app included) can write through them early. Their tests turn the setting on.

| Step | What | Notes |
|---|---|---|
| 6.0 | S3 cutover (E2) | Storage only; closes E2 before any real document lands on main |
| 6.1 | Foundations | `PIPELINE_WRITES_ENABLED`; FastAPI's resource authorization and scoping for candidates, cases and partner candidates (`docs/security/authorization-pipeline.md` stages 5–6), with drift tests against `server/scope.ts`; the referral-milestone service |
| 6.2 | Candidates (built, off) | Profile, staff edit, lifecycle status, screening and invites, messages, and the `Candidate` that registration creates |
| 6.3 | Documents (built, off) | Upload end to end (storage, scan, the CIF upload token), verify, access records |
| 6.4 | Built, off (#115): `vertex_be/app/api/v1/applications.py` (submission, review, staff corrections) with the "registered" commission and the duplicate-referral flag. The `notify` shapes moved to `app/api/notices.py`. Rejecting and overturning a case (which also write applications) come with 6.5, partner submissions with 6.6 |
| 6.5 | Built, off (#117, #118): `vertex_be/app/api/v1/cases.py` (6.5a, #117: approval opening the case, stage, ops review, reject, overturn, reminders; 6.5b: contract, signing, retention) and `exceptions.py` (raise, escalate, decide). `CaseReminder`, `Exception` and `ExceptionCorrectiveAction` are now audited on both sides |
| 6.6 | Built, off (#119): `vertex_be/app/api/v1/partner_submissions.py` (drafts, submission, corrections, abandoning a draft; HR's create-case, reject, overturn, delete). Overturning a partner rejection set the candidate to "approved" with no case (as the website did); fixed 2026-10-30 by the owner's decision: an overturn reinstates the previous status, so the candidate keeps the status it had |
| 6.7 | **Switched**: every pipeline route passes requests on (`vertex/src/lib/pipeline.ts`) and sends the emails FastAPI lists; `PIPELINE_WRITES_ENABLED` defaults on; `vertex_web` has no writes on the cluster or `ReferralCommission` (`db-roles.sql`); the website's write code is gone. Commission payouts (approve, mark paid) moved too: they were the last other writers of `ReferralCommission` |
| 6.4 | Applications (built, off) | Self-submission and staff entry, review, the candidate's application edit; referral commissions |
| 6.5 | Cases (built, off) | Creation (case lifecycle), stage, ops review, reject and overturn, reminders, contract and signing, retention, exceptions |
| 6.6 | Partner submissions (built, off) | Partner drafts and submission, HR review, create case, reject and overturn |
| 6.7 | **The switch** | Every pipeline route in Next.js passes requests on (sending its email on success, D1); the setting turns on; `vertex_web` loses its writes on the whole cluster and `ReferralCommission`; the dead Next.js code goes. One PR, one release, with the full e2e suite and a rollback plan (turn the setting off and restore the grants) |

Each building PR has the same checks as before: role and scoping drift
tests against the Next.js files, the audit trail and writes as
`vertex_api`. The existing e2e journeys (self-application, candidate
lifecycle, partner submission) are the regression net for the switch.

### 4.1 What the built endpoints promise the switch

Step 6.7 wires the website to these, so they are fixed here:

- **Emails (D1).** A response that leaves an email due lists it in
  `notify`, next to `data`: `{kind, ...}` with what that email's sender in
  `lib/email.ts` takes (`candidate_invite`, `referral_commission_earned`,
  `candidate_message` with a `view_path` the website puts its own URL in
  front of). The website sends each one after FastAPI answers, and never
  passes `notify` on to the browser.
- **Registration** calls `POST /api/v1/candidates/claim` as itself
  (`callBackend(..., { asUser: false })`; FastAPI refuses it from anyone
  else) with the invite token and the new user's id. FastAPI verifies the
  invite itself and checks the account is that candidate's.
- **Approving a candidate** opens their case on their latest application
  (`app/services/case_lifecycle.py`, step 6.5) and earns the "application
  submitted" commission.
- **Case reminders** are recorded by FastAPI and sent by the website after
  (today the website sends first, then records).
- **Signing a contract** records the signer's address. Through the website
  FastAPI sees Next.js's connection, so the website forwards the browser's
  `X-Forwarded-For`; FastAPI trusts it only alongside Next.js's service
  credential (`callBackend` sends the header from 6.7).
- **Uploads** (D2): `POST /api/upload` passes the multipart body on to
  `POST /api/v1/documents` with the user's session, or, with an
  `X-Upload-Token` and no session, to `/documents/form-upload` as itself.
  FastAPI checks, scans and stores the file in the same bucket with the
  same keys (`S3_*`, `CLAMD_*`), so files stored by either service read
  the same.
- **Submitting the form** (`POST /api/applications`) calls
  `POST /api/v1/applications/submit` as Next.js itself, with the user's
  session when there is one (an anonymous self-applicant has none). Next.js
  keeps rate-limiting anonymous submissions, and signs the form's upload
  token when the response says `screening_passed`.
- **Opening a document:** before serving a stored file (download, email
  attachment), the website asks `POST /api/v1/documents/readable`, which
  scans an unscanned file and refuses an infected one (403
  `document_blocked`). FastAPI logs `security.scanner_unavailable` when
  clamd is unreachable; the website's alert email for it stays until the
  security monitor reads FastAPI's logs.

### 4.2 Progress

| Step | State |
|---|---|
| 6.0 | **Decided** (owner, 2026-10-29): MinIO on every local stack, main included, while Vertex runs locally; no S3 cutover until it's hosted. E2 re-decided to match (`docs/security/exceptions.md`) |
| 6.1 | Done (#112) |
| 6.2 | Built, off (#113): `vertex_be/app/api/v1/candidates.py`; the lifecycle rules are checked move for move against the website's through `candidateLifecycle.matrix.json` |
| 6.3 | Built, off (#114): `vertex_be/app/api/v1/documents.py` (upload, the form's upload, verify, readable), `services/storage.py`, `services/malware_scan.py`. Moving a partner draft's documents onto its candidate comes with 6.6 |

## 5. Risks

- **A large switch** (D3 B): 6.7 changes every pipeline route at once.
  Mitigated by building and testing each group first (6.2–6.6), the full
  e2e suite on the switch PR, and a rollback that needs no code change:
  turn `PIPELINE_WRITES_ENABLED` off and restore `vertex_web`'s grants.
- **Built but unused code** (6.2–6.6): FastAPI's pipeline endpoints exist
  weeks before they're used. They refuse every request until the switch.
- **Email after a write** (D1 A): an email can fail once the write has
  committed. Same as today; failures are logged.
- **Scope drift:** the scoping rules exist in Next.js and FastAPI until
  reads move. Drift tests compare them.
- **Size:** 32 files. Expect several PRs per step.

## 6. Rolling the switch back

No code change. On the stack:

1. Set `PIPELINE_WRITES_ENABLED=false` for the backend and restart it. Every
   pipeline write in FastAPI then answers 503 `pipeline_not_enabled`.
2. Give `vertex_web` its writes back, as the database owner:
   `GRANT INSERT, UPDATE, DELETE ON "Candidate", "CandidateMessage", "Document", "Application", "Case", "CaseStageEvent", "CaseReminder", "Contract", "RetentionFollowUp", "Exception", "ExceptionCorrectiveAction", "PartnerCandidate", "ReferralCommission" TO vertex_web;`
3. Deploy the release before the switch: its Next.js routes write the
   pipeline themselves.

Rows written by FastAPI in between are ordinary rows, audited like any
other; nothing needs converting.

## 7. Known gaps after the switch

- **The demo site** (`docs/demo-site.md`) runs Next.js without FastAPI, so
  its pipeline writes now fail, as its job, campaign and report writes have
  since those areas moved. Its seed, which loads data as `vertex_web`, can
  no longer write these tables either. Giving the demo a FastAPI (or
  seeding it as the owner) is a separate change.
- **Scanner and malware alerts** are raised by the website from FastAPI's
  answers (an upload rejected or stored unscanned, a download blocked);
  FastAPI also logs `security.scanner_unavailable`.
