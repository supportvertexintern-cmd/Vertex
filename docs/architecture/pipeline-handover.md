# Candidate pipeline handover (backend plan step 6)

Status: **proposal, for the owner's decision** (2026-10-29). Follows
`data-ownership.md` §2.2, which makes the pipeline one ownership handover.

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

### 2.5 Registration creates a candidate

`POST /api/auth/register` creates the `User` and, for candidates, the
`Candidate` (§2.3 of `data-ownership.md`). Users stay in Next.js, so
registration keeps creating the `User` and creates the `Candidate` through
FastAPI.

## 3. Decisions for the owner

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
intended rule. Recommended: **keep today's behaviour** (global for those
roles) and record it as the owner's decision; tightening it is a separate
change with its own tests.

## 4. Steps (with the recommended options)

| Step | What | Notes |
|---|---|---|
| 6.0 | S3 cutover (E2) | Storage only; closes E2 before any real document lands on main |
| 6.1 | Foundations | FastAPI's resource authorization and scoping for candidates, cases and partner candidates (`docs/security/authorization-pipeline.md` stages 5–6), with drift tests against `server/scope.ts`; the referral-milestone service |
| 6.2 | Candidates | Profile, staff edit, lifecycle status, screening and invites, messages; registration creates the `Candidate` through FastAPI |
| 6.3 | Documents | Upload (with the CIF upload token), verify, access records |
| 6.4 | Applications | Self-submission and staff entry, review, the candidate's application edit; referral commissions |
| 6.5 | Cases | Creation (case lifecycle), stage, ops review, reject and overturn, reminders, contract and signing, retention, exceptions |
| 6.6 | Partner submissions | Partner drafts and submission, HR review, create case, reject and overturn |
| 6.7 | Handover | Revoke `vertex_web` writes on the whole cluster and `ReferralCommission`; remove the dead Next.js code; update `data-ownership.md` |

Each step is one or more PRs, with the same checks as before: role and
scoping drift tests against the Next.js files, the audit trail, writes as
`vertex_api`, and an e2e journey through the website. The existing e2e
journeys (self-application, candidate lifecycle, partner submission) are
the regression net for the whole area.

## 5. Risks

- **Two writers during 6.2–6.6** (D3 A): a row can be changed by a moved
  route and an unmoved one. Both are audited, and each sub-step moves whole
  user actions, not half of one.
- **Email after a write** (D1 A): an email can fail once the write has
  committed. Same as today; failures are logged.
- **Scope drift:** the scoping rules exist in Next.js and FastAPI until
  reads move. Drift tests compare them.
- **Size:** 32 files. Expect several PRs per step.
