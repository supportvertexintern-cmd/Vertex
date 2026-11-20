> **Historical record, copied from upstream staging (duncmv/vertex, 2026-11-13).** It's kept as the
> evidence for the stories excluded from this release (DEF-016, DEF-017): `tools/traceability.py`
> excludes a story only while its decision is recorded here as closed by its approver. Its notes on
> code describe upstream's Next.js/Prisma build, not this repository's.

# Phase 6 — Defect Report and Open-Question Decisions

**Source:** `Vertex_Test_Suite_Results.xlsx` (Phillip, 10 Nov 2026)
**Branch:** `phase-6-partner-commission-system`
**Staging DB:** re-seeded (`@va-demo.test` cast only)
**Report date:** 10 Nov 2026

Every defect raised in the test pack is listed below with its outcome. Defects that are **not**
fixed carry the reason. Section 2 records the answers to the ten Open Questions, which are now the
authoritative reading of the stories where the spec was silent.

---

## 1. Defects

### Addressed

| ID | Severity | Defect | Fix | Commit |
|---|---|---|---|---|
| DEF-001 | Medium | Duplicate VA email accepted when the letter case differs (`SARAH@VA-DEMO.TEST`) | Emails are lower-cased and compared case-insensitively on every user-creation path, registration and login | `a82bee5` |
| DEF-002 | High | Addis partner page crashes — React error #31 (report `content` stored as `{notes}`) | Panel derives a display string from object content; the seed now writes text. Re-seed cleared the offending row | `2ff8eaf` |
| DEF-003 | Low | MOU/SLA reverted from "signed" still shows the signed date | `mou_signed_at` / `sla_signed_at` cleared on revert | `a82bee5` |
| DEF-004 | Medium | No change/activity history | Audit-log driven **Activity** feed on every partner tracking panel (partner, reports, follow-ups, submissions, commissions, fees), VA-scoped | `ac81752` |
| DEF-005 | Medium | "Registered" differs between Partner Performance (8) and the partner page (7) | Performance counted submission rows *including drafts*; it now counts bridged candidates like every other surface, and shows "N initiated" underneath when drafts exist | `dd8b188` |
| DEF-006 | Medium | Manager rollup undercounts flagged partners (Daniel 1 vs 2) | The flag rule was duplicated; it now lives once in `server/services/partnerFlags.ts` and both the VA dashboard and the rollup read it | `dd8b188` |
| DEF-009 | **Critical** | Partner list API returned every partner (contacts, phones) to VAs | `virtual_assistant` removed from the partner list/detail selection — the data never reaches the browser; search scoped too | `2ff8eaf` |
| DEF-011 | Low | Empty report could be saved | Schema requires content (min 2 chars); submit disabled while empty | `a82bee5` |
| DEF-012 | Medium | Follow-ups had no date field | Due-date field wired to the existing `due_at`; overdue visible | `a82bee5` |
| DEF-013 | **Critical** | VAs could edit reports/follow-ups of partners not assigned to them | VA scope (403) added to both PATCH endpoints; create/read were already scoped | `2ff8eaf` |
| DEF-014 | Low | Completed follow-ups still counted on Partner Performance | Rollup counts open follow-ups only, in both the flag rule and the row badge | `dd8b188` |
| DEF-015 | Low | "No activity in 14 days" shown for a partner created 2 days earlier | Inactivity is measured from the partner's `created_at` when there is no candidate activity yet | `dd8b188` |

### Not addressed — with reason

| ID | Severity | Defect | Reason |
|---|---|---|---|
| DEF-007 | Low | No drill-down from dashboard figures | **Out of scope for this version** (confirmed 10 Nov). The ranking table's row links remain the way into a partner's page; figures do not open filtered lists. |
| DEF-008 | Medium | Invite email links to the staging alias, not the environment in use | **Not a defect — by design.** Invitation links always use the staging alias because of the deployment restrictions. Production invites resolve to the live domain. |
| DEF-010 | Medium | No candidate list in the VA portal | **Out of scope for this phase** (confirmed 10 Nov). VAs see per-partner candidate counts and the tracking panel, not a name list. |
| DEF-016 | Medium | No commission/financial export | **Closed by Mercy (10 Nov):** export is not required for this version. |
| DEF-017 | Medium | No partner communication history | **Closed by Mercy (10 Nov):** communication is handled off-platform. |

Also fixed while in the same code paths, unlisted in the pack: the VA dashboard's "report
outstanding" check sorted report statuses alphabetically and could miss a `pending` report behind a
`closed` one — it now flags when any report is pending or returned.

### Beyond the test pack (built this phase)

- **VA deactivation and reassignment** — `User.is_active`, immediate session revocation on the next
  request, deactivation that reassigns or unassigns every partner (audited, so it appears in the
  activity feed), and reactivation.
- Staging cleanup: the `QA duplicate check` account and the `TEST` records are gone (the seed
  recreates the cast).

### Merged from `qa/day-1` (security)

The QA security branch was merged into this branch (10 Nov). It brings its own test suites
(`tests/security`, `tests/e2e-security`, `tests/perf`) and these platform fixes:

- **Money races** — partner and referral commission approve/mark-paid only update a row still in the
  expected status, with the audit entry in the same transaction; five simultaneous requests per
  action were previously all accepted.
- **Engine races** — a lost unique-key race in the commission engine is a no-op, not a 500 inside
  HR's create-case.
- **Missing authorisation** — `/api/admin/emails` and `/api/admin/knowledge` were readable without
  logging in; both now require admin.
- **Cache leaks** — API responses send `Cache-Control: private, no-store`; `X-Powered-By` dropped.
- **Email injection** — every email escapes user values (31 of 32 did not; partner-controlled
  candidate names reached staff inboxes as raw HTML).
- **List filters** — unknown status/rule type/fee type values and NUL bytes no longer reach Prisma.
- **Open redirect** — `safeRedirectPath()` on `?redirect=`, the Google sign-in routes and the case
  `returnTo`.
- **CSV injection** — one shared escaper for both exports.
- **Uploads** — a failed record write removes its file; a replaced document is deleted only after its
  replacement saves; a draft's document link no longer crashes and is owner-only.
- **Login** — timing equaliser for unknown emails; a deactivated account now gets the same 401
  "Invalid email or password." as a wrong password, so the response cannot confirm that the password
  was correct. This replaces the distinct "account deactivated" message added with VA deactivation.

Both branches implemented the earned-month rule independently; it now lives once in
`src/lib/commissionEarned.ts` (`isCommissionDue`, `isAdminFeeDue`, `earnedCommissionWhere`), and the
duplicate helper from this branch was removed. Consequences of taking QA's version: rejected rows are
never counted as earned, and the statement still reports future months separately as *scheduled*.

---

## 2. Open Questions — decisions (10 Nov 2026)

| # | Question | Decision | Effect |
|---|---|---|---|
| 1 | Separate Approve step before Pay? | **Yes — keep Approve before Pay.** | Already built (`approve` stamps approver/time; `mark-paid` refuses anything not approved). TC-08-11 and TC-14-08 stand as valid tests. |
| 2 | Is the $10 application admin fee charged at Initiated or Submitted? | **At Submitted, via HR approval** — the fee row is written together with the registration commission when HR approves the submission and creates the case. | Matches current behaviour; no change. TS-11 can assert the fee appears at approval, not at draft. |
| 3 | Export format: CSV or Excel? | **Export not required** for this version. | DEF-016 stays closed; TS-10 export cases are N/A. |
| 4 | Inactivity threshold — 14 days? | **14 days.** | `RECENT_ACTIVITY_DAYS = 14`, measured from `created_at` for partners with no candidate activity yet (DEF-015). |
| 5 | Partner ranking formula undefined | **Earned → registered → name.** | Confirmed as the implemented sort: total commission earned desc, then registered desc, then A–Z. Explainable to partners. |
| 6 | Deployment commissions: 6 rows up front or one per month? | **6 rows scheduled up front, but only months whose period has arrived count as earned.** | **Code change.** Statement, performance dashboard, VA dashboard, payout queue and admin-fee ledger now recognise a month only when it arrives; the statement reports the remaining months as *scheduled*. Approve/pay reject a future month (`not_due`). |
| 7 | What commission figures may a VA see? | **Per-partner amounts, own partners only.** | Current behaviour: `commissions_due` per partner on `/va`, statement reachable for assigned partners only, always net of unearned months. |
| 8 | US-30 "Samuel moves to Daniel" deferred because reassignment was out of scope | **Un-defer; retest TC-13-04.** | Reassignment now exists (single-partner in the tracking panel, bulk on VA deactivation), so the scenario can be executed. |
| 9 | Report workflow statuses and transitions undefined | **4 statuses — pending / submitted / returned / closed — any order.** | Confirmed as built and validated; no transition rules, no status history beyond the activity feed. |
| 10 | Who is the "second candidate" in US-27? | **Meron Haile.** | Tester workflow: approve Meron's submission, drive her case to Departure & Arrival Support, then compare her statement with the first deployed candidate. |

---

## 3. Verification

- `npx tsc --noEmit` — clean.
- Unit tests: `partnerFlags.test.ts` (8), `partnerCommissions.test.ts` (7) and
  `commissionEarned.test.ts` (6) pass — 21 tests.
- `src/server/services` suite: 13 files pass; the only failure is `kpi.test.ts`, the known
  pre-existing test-database teardown failure that also reproduces on clean `main`.
- The `qa/day-1` suites (`tests/security`, `tests/e2e-security`) need the test database / containers
  and were not run as part of this report.
- Flag parity and count parity confirmed against the staging data: Daniel rolls up as 2 flagged
  (matching his dashboard); the partner that showed 8 vs 7 now reads 7 registered / 8 initiated.

## 4. Status

Nothing from the test pack remains open for this version. The five items in section 1 are closed
for a stated reason — two by design, two by Mercy's scope call, and DEF-007 by decision on 10 Nov:
dashboard drill-down is not in scope, and the ranking rows stay the way into a partner's page.