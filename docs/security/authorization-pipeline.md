# Request authorization pipeline

Phase 2, Step 4. Every protected request goes through these stages in this
order. A route may implement a stage differently, or skip one that doesn't
apply to it (a public endpoint has no identity stage), but **no required
check may be skipped**, and nothing is read or changed before stages 2–6
have passed. Applies to Next.js today (the only system serving data, see
[trust-boundaries.md](trust-boundaries.md)) and to FastAPI when it serves
data.

## 1. The stages

| # | Stage | What it decides | Implemented by (Next.js) | Status |
|---|---|---|---|---|
| 1 | **Request validation** | Method, path, body size, content type, input schema | Method and path: Next.js routing (unknown method → 405). **Body size: `lib/request-size.ts`, applied by `src/proxy.ts` to every `/api` request** (1 MB JSON; upload = file limit + 1 MB; 411 for unsized streams). Schema: zod (`safeParse`) in 58 of 69 handlers that read a body; the rest validate by hand | ✅ size (new, G23); ⚠️ schema not uniform (§4) |
| 2 | **Identity verification** | Who is calling | `getAuthUser` (session cookie, session key and audience only, G17); signed single-purpose tokens for links; Stripe signature for the webhook | ✅ |
| 3 | **Credential and session checks** | Expiry, revocation, account status | 15-minute access token; every request checks the user, `token_version` and the session in the database ([session-management.md](session-management.md)) | ✅ G19 fixed 2026-10-12 |
| 4 | **Permission evaluation** | May this identity do this action at all | `requireRole(user, [...])` / `requireAdmin`, role lists in `lib/rbac.ts` | ✅ every non-public handler (CI-enforced) |
| 5 | **Resource authorization** | Is this identity allowed this specific record | `canAccessCandidate`, `canAccessCase`, `resolveAccess` (threads), ownership comparisons (`candidate.user_id === user.userId`, `partner_id`) | ✅ for candidate/partner paths (tested, §3); staff paths per Q1–Q3 |
| 6 | **Scope enforcement** | Data boundaries: region, country, assignment, partner | Lists: `scopeCandidatesToRequester`, `scopeCasesToRequester` in the query's `where`. Single records: stage 5 helpers apply the same rules | ✅ candidates/cases; ❓ partners, partner candidates, applications for reviewers (Q1–Q3) |
| 7 | **Contextual controls** | MFA, step-up, rate limits, risk | Per-IP rate limits (`limitByIp`) on public and auth routes. **No MFA or step-up** for any role | ⚠️ rate limits in memory (G5, G14); ❌ MFA (G24) |
| 8 | **Execution** | The operation itself | Handler body; writes through `auditedPrisma(actor)` | ✅ |
| 9 | **Security audit** | Record the decision and outcome | `auditedPrisma` (data changes), `auditAccess` (exports), `recordSecurityEvent` (sign-ins, denials via `requireRole`/`forbidden()`, document views; Phase 10). Never credentials (`lib/redact.ts`); filter values allowlisted (`auditFilters`) | ✅ G7, G20, G21 (Phase 10); ⚠️ some writes (G22) not recorded |

## 2. Rules

1. **Order.** Stages 2, 4, 5 and 6 complete before any data is read or
   changed, any email is sent or any external call is made. Stage 1 runs
   first; a stage-1 lookup of *reference data* (for example, checking an
   upload's `type` against `DocumentRequirementType`) is allowed and must be
   named in the test's exception list. Enforced by `route-guards.test.ts`
   ("guarded handlers check the caller before touching data").
2. **Body schema after identity.** Most handlers parse and validate the
   body after the caller is checked. That is deliberate: anonymous callers
   don't learn the schema from validation errors. Size is still checked
   first (proxy), so an unauthenticated caller can't make the server buffer
   a large body.
3. **Scope in the query, not after it.** List endpoints put the requester's
   scope in the `where` clause (`scope*ToRequester`); they never fetch
   everything and filter in code. Single-record endpoints load the record,
   then apply the same rules through `canAccess*`.
4. **Never trust identifiers from the client for authorization.** The
   acting user always comes from the verified token (`user.userId`), never
   from a body or query field. A record ID in the URL identifies the target;
   it never grants access.
5. **Denial responses.** 401 without a valid identity; 403 when the role
   may not perform the action; 403 or 404 when the record is outside the
   caller's reach. Existing routes return 403 for "exists but not yours";
   record IDs are random (cuid), so this doesn't make records enumerable.
   New routes should return 404 for both cases.
6. **Fail closed.** Any error in stages 1–6 denies. `getAuthUser` returns
   `null` on any verification error; access helpers return `false` for an
   unknown role (`default: return false`).
7. **Audit without data.** Audit rows record who, what, which record and
   the outcome; never tokens, passwords, file contents or free-text filter
   values.

## 3. Worked example: a candidate requests application A

`GET /api/applications/A` (`src/app/api/applications/[id]/route.ts`):

| Stage | What happens |
|---|---|
| 1 | Next.js routes `GET` to the handler; the proxy passes it (no body) |
| 2 | `getAuthUser` verifies the session cookie; no cookie or a bad one → **401** |
| 3 | Token expiry and the live session checked: a deleted or demoted candidate is refused on the next request (G19, fixed) |
| 4 | Any authenticated user may ask; the handler decides per record |
| 5 | Application A is loaded; unless the caller is an application reviewer, `application.candidate.user_id` must equal the caller's `userId`, else **403** |
| 6 | Candidates are scoped by ownership (stage 5). Reviewers currently see every application regardless of region (**Q3**, awaiting an owner's answer) |
| 7 | No extra control for this read |
| 8 | Application returned |
| 9 | Not recorded (reads aren't audited, by design, except exports and, once G21 is fixed, documents) |

**Changing the ID in the URL doesn't help**: proven by
`resource-authorization.integration.test.ts`, which calls the real
handlers with real sessions. For each route a candidate or partner can call
with a record ID, the owner gets 200, another user of the same role with
the owner's ID gets 403/404, and no session gets 401:

| Route | Candidate B's record, requested by candidate A | Partner B's record, requested by partner A |
|---|---|---|
| `GET /api/applications/[id]` | denied | — |
| `GET /api/cases/[id]` | denied | denied |
| `GET /api/documents/[id]/signed-url` | denied | denied |
| `GET /api/candidates/[id]/messages` | denied | — |
| `GET /api/partner/candidates/[id]` | — | denied |

Mutation-checked: removing the ownership check in the application route,
or making the partner rule in `canAccessCandidate` always true, fails the
test.

## 4. Gaps against the pipeline

| # | Stage | Gap | Status |
|---|---|---|---|
| G23 | 1 | No request body size limit; `/api/upload` buffered the whole form before checking the caller or the file size | **Fixed** (proxy-level limits, `request-size.test.ts`) |
| — | 1 | 11 body-reading handlers don't use a schema: admin email templates, knowledge, settings, PayPal/Stripe checkout, chat (others validate by hand: messages, upload, webhook) | Phase 5: zod schemas for the remaining handlers |
| G19 | 3 | No revocation or account status | **Fixed 2026-10-12** ([session-management.md](session-management.md)) |
| Q1–Q3 | 6 | Partner, partner-candidate and application scope for staff roles undecided | Owner decision |
| G5, G14 | 7 | Rate limits in memory, keyed on a client-settable header | Phase 4 |
| G24 | 7 | No MFA or step-up authentication for any role, including admin, finance and directors | Phase 4 (authentication) |
| G7, G20, G21, G22 | 9 | Denials, sign-ins, document views and some writes aren't audited | G21, G22 Phase 2 candidates; G7, G20 Phase 5 |

## 5. What enforces this

| Check | Test |
|---|---|
| Every non-public handler has a stage 2/4 guard | `route-guards.test.ts` |
| No data access before the guard | `route-guards.test.ts` (ordering) |
| Public endpoints have their claimed protection (rate limit, signed token, signature) | `route-guards.test.ts` |
| Body size limits | `request-size.test.ts` |
| Tokens accepted only for their own purpose | `jwt.test.ts` |
| ID swapping denied (stage 5) | `resource-authorization.integration.test.ts` |
| Exports audited | `route-guards.test.ts`, `audit-access.integration.test.ts` |
| Revocation gap stays visible | `session-revocation.integration.test.ts` (strict expected failures) |
