# Users and sessions handover (backend plan step 8)

Status: **proposed, awaiting the owner's decisions** (§3). Security
review of 2026-10-30: approved with conditions, folded into §6. Follows
`data-ownership.md` §3 (Users and sessions) and §2.3 (the owner's decision
of 2026-10-27: `Partner` and `ReferralAgent` move with this area), and
reuses the patterns of `pipeline-handover.md` and `payments-handover.md`.

This is the last area. When it is done FastAPI is the session issuer and
`vertex_web` writes no business table.

## 1. What moves

Every write to these tables moves from Next.js to FastAPI (scan of `dev`,
2026-10-30):

| Table | Written today by (Next.js) |
|---|---|
| `RefreshToken` | `lib/session.ts`: sign-in (`/api/auth/login`, `/api/auth/app/login`, Google callback), refresh (`/api/auth/refresh`, `/api/auth/app/refresh`, rotation and reuse detection), sign-out (`/logout`, `/app/logout`), revoking (`/api/auth/sessions`, `/sessions/[id]`, `/api/admin/users/[id]/sessions`) |
| `User` | `/api/auth/register` (create, then the candidate claim through FastAPI; removed again if the claim fails), `/api/auth/verify-email`, `/api/auth/reset-password`, the Google callback (links `google_id`); `/api/admin/users` (create, with an account-setup email), `/api/admin/users/[id]` (update, delete), `/api/admin/users/[id]/reset-password`; `/api/admin/partners/[id]/provision-account`, `/api/admin/partners/[id]` (contact email re-points the login; delete), `/api/admin/partners/[id]/reset-password`; `/api/admin/referral-agents/[id]/approve` |
| `InhouseCountryAssignment` | `/api/admin/users` (with the user), `/api/admin/users/[id]` (replace the list) |
| `Partner` | `/api/admin/partners` (create), `/api/admin/partners/[id]` (update, delete), `/provision-account` (links the user) |
| `ReferralAgent` | `/api/referral-agents/register` (public), `/api/referral-agents/verify-email`, `/api/admin/referral-agents/[id]` (approve, reject, suspend), `/approve` (creates the user) |
| `ReferralAgentTarget` | `/api/admin/referral-agents/[id]/targets` (create). `data-ownership.md` §2.4 still lists it with no writer; that's out of date and is corrected with this plan |

That's about 30 writes in 17 files, plus `lib/test-session.ts`, which is
for tests only: they run as the database superuser, so it can stay as it is.

As before, **writes move and reads stay** in Next.js. That includes the
per-request session check: `getAuthUser()` (`lib/api-auth.ts`) keeps reading
`User` and `RefreshToken` through `loadSession()`, and the proxy keeps
checking the access token's signature to route portal pages.

## 2. What makes this area different

### 2.1 Sessions are on every request

Today Next.js signs the 15-minute access token, sets both cookies, and
checks the session against the database on every API call. FastAPI already
verifies the same tokens (`app/core/tokens.py`, `app/core/auth.py`,
including the live-session check) but issues none.

The refresh token is an opaque random value stored only as a hash, so
**moving the issuer doesn't sign anyone out**. A refresh after the switch is
answered by FastAPI from the same `RefreshToken` row.

FastAPI isn't published, so the browser and the mobile app keep calling
the website's `/api/auth/*` URLs. The website passes each call on and sets or
clears the cookies from FastAPI's answer, which is the same pass-through
pattern as the Stripe webhook (payments D1). The Flutter app needs no
change.

### 2.2 Passwords

Hashes are bcrypt (`bcryptjs`, cost 12, `$2a$`/`$2b$`). FastAPI needs the
`bcrypt` package to check and create them. There is no data migration:
existing hashes are read as they are.

### 2.3 Google sign-in

The callback exchanges Google's code for tokens, reads the user's email,
and signs in an account that already exists, linking `google_id` on first use.

**Fixed ahead of the move (#131):** the callback linked by email without
checking Google's `email_verified`; it found accounts by `google_id` *or*
email, so a linked account also let in another Google account reporting the
same address; and `state` carried no nonce (login CSRF). It now checks a
state nonce against a short-lived cookie, finds linked accounts by
`google_id` only, links by email only when Google has verified it, never
re-links an account linked elsewhere, and drops a password set on an
unverified account when linking (pre-hijack). FastAPI keeps these rules
in 8.2.

### 2.4 Tokens sent by email

Verification, password reset, account setup and referral-agent verification
links each carry a signed token (`lib/jwt.ts`, one HKDF key per purpose).
Today Next.js signs them, and Next.js checks them when the link is used. Once
FastAPI owns the writes those links lead to, it should check them, and so
sign them too.

### 2.5 Audit and alerts

`User`, `InhouseCountryAssignment`, `Partner`, `ReferralAgent` and
`ReferralAgentTarget` are in `AUDITED_MODELS`. Some of their writes today
skip the audit (plain `prisma` in the Google callback, email verification and
the referral-agent flows); under FastAPI every write is audited (owner's
decision 2026-10-26).

`RefreshToken` isn't audited. Every refresh rotates a row, about every 15
minutes per signed-in user, so auditing it would put a token hash in the
append-only log each time (D5).

Two security hooks must come across unchanged:
- the login and session security events (`login_succeeded`,
  `login_failed` with an email fingerprint, `login_rate_limited`,
  `refresh_token_reused`);
- the alert when a user is made admin (`onPrivilegeGranted` in
  `lib/audit.ts`).

### 2.6 `vertex_api` and `RefreshToken`

`vertex_api` has no grant on `RefreshToken` today, and `data-ownership.md`
§2.1 keeps the test "vertex_api cannot write `RefreshToken`". This move
reverses that on purpose: the test becomes "`vertex_web` cannot write it".
`deploy/sessions-kill-switch.sh` keeps working (it runs as the superuser),
and so does the `user_token_version_bump` trigger, which fires whoever
writes `User`.

## 3. Decisions

Each one has a recommended option, as in the earlier handovers.

### D1. How are session tokens signed?

| Option | How | Cost |
|---|---|---|
| **A. The same key and format for the migration, then asymmetric (recommended)** | FastAPI signs access tokens exactly as `lib/jwt.ts` does (HS256, the HKDF `session` key from `JWT_SECRET`, the same claims). The proxy and `getAuthUser()` keep verifying them unchanged. After 8.5, the key is rotated to B | No change for the website or outstanding tokens during the move. Next.js keeps `JWT_SECRET`, and it can read `RefreshToken` (it checks sessions), so a compromised website could read a live session's id and mint a token for that user. Registered as exception E8 until the rotation |
| B. Asymmetric keys from the start | FastAPI signs with a private key (EdDSA); Next.js and FastAPI verify with the public key; `JWT_SECRET` is removed from the website for sessions | A new key to manage and rotate while everything else is moving; tokens issued before the switch stop working within 15 minutes (refresh mends them) |

### D2. Where are sign-in attempts rate-limited?

| Option | How | Cost |
|---|---|---|
| **A. The website keeps the per-address limits; FastAPI adds a per-account one (recommended)** | The limits stay in each handler (`route-guards.test.ts` checks them), and the website tells FastAPI about a blocked attempt so `login_rate_limited` is still recorded. FastAPI adds a per-account limit on failed sign-ins as a backstop | A little more than today. The per-address limit is only as good as the address (§6, #5) |
| B. FastAPI | The website would forward the client address and FastAPI would have to trust it | No gain while FastAPI is reachable only through the website |

### D3. Who talks to Google?

| Option | How | Cost |
|---|---|---|
| **A. FastAPI (recommended)** | The website passes the `code` on; FastAPI exchanges it, reads the user, links and signs in. **It links by email only when Google says `email_verified`** (the §2.3 finding) | Google's client secret moves to the backend only, as Stripe's and PayPal's did. A Google account with an unverified email can no longer link itself |
| B. The website exchanges, FastAPI signs in | FastAPI takes the website's word for who the user is | The pattern rejected for PayPal (payments D2) |

### D4. Email links

| Option | How | Cost |
|---|---|---|
| **A. FastAPI signs and checks them; the website sends the emails (recommended)** | Same as payments D3: FastAPI lists the email in `notify` with the link's token; the website renders and sends it | No email code moves. The website sees the token, as it does today when it sends the email |
| B. The website keeps signing | FastAPI would need the website's word that a link was issued | Two services own one token |

### D5. Is `RefreshToken` audited?

| Option | How | Cost |
|---|---|---|
| **A. No: sessions are recorded as security events (recommended)** | Exempt `RefreshToken` from `test_audit_coverage.py`, by name and with this reason; the test asserts the exemption list is exactly `{RefreshToken}`. Starting, refreshing after reuse, revoking and the kill switch stay recorded as events, as they are today | One named exception to the 2026-10-26 rule, registered as E9 |
| B. Yes, like every table | Every rotation writes an audit row | The log grows by one row per user every 15 minutes, each holding a token hash |

### D6. How does it switch?

| Option | How | Cost |
|---|---|---|
| **A. In sub-steps, like payments (recommended)** | §4. `User` keeps two writers, both audited, between 8.2 and 8.4 (as `CasePayment` did between 7.2 and 7.3) | One release per sub-step. The two writers are registered as E10, ending at 8.4 |
| B. Built behind a flag, one switch | As the pipeline did | Sign-in, every account page and partner provisioning would switch in one release |

## 4. Steps

| Step | What | Revokes from `vertex_web` |
|---|---|---|
| 8.1 | Referral-agent targets: the admin create | `ReferralAgentTarget` |
| 8.2 | Sessions: password sign-in (web and app), refresh, sign-out, the session lists and revoking, Google sign-in; bcrypt and the session signer in FastAPI | `RefreshToken` |
| 8.3 | Accounts: registration (with the candidate claim in the same transaction, so no rollback is needed), email verification, forgot and reset password, the admin user pages (create, update, delete, reset, country assignments) | `InhouseCountryAssignment` |
| 8.4 | Partners and referral agents: partner create, update, delete, provisioning and reset; referral-agent registration, verification, approval, rejection and suspension | `User`, `Partner`, `ReferralAgent` |
| 8.5 | Clean-up: remove the website's session signing and its password, Google and token helpers; update `data-ownership.md` and the session docs | none |

Each PR has the usual checks: role drift tests against the Next.js files,
the audit trail, writes as `vertex_api`, Google mocked in the backend tests,
the response shapes kept (including the cookies and the app's token body),
and the end-to-end journeys, which sign in on every run.

## 5. Risks

- **FastAPI down means no sign-in or refresh.** Today a database outage
  already does the same. Pages already signed in keep working until their
  15-minute token runs out, because the website verifies it itself.
- **Lockout during the switch:** none expected, since refresh tokens carry
  over (§2.1). The end-to-end suite signs in, refreshes and signs out on every
  run.
- **Two writers of `User` between 8.2 and 8.4** (D6 A), both audited and
  both firing the `token_version` trigger.
- **Behaviour change in 8.2:** with D3 A, a Google account with an
  unverified email can no longer link itself by email.

## 6. Security review (2026-10-30)

An outside design review approved the plan with conditions. Each finding,
checked against the code where it could be, and where it lands:

| # | Finding | Checked in the code | Where |
|---|---|---|---|
| 1 | Google links by email without `email_verified` | Confirmed | **Fixed, #131** |
| 2 | Pre-hijack through Google linking | Confirmed in principle; hard to reach today, because a password is set only from an invite or setup link sent to the address | **Fixed, #131**: linking drops a password on an unverified account |
| — | Accounts found by `google_id` *or* email; `state` without a nonce | Found while fixing #1 | **Fixed, #131** |
| 3 | D1 A: the website could mint tokens for live sessions | Confirmed: `loadSession()` reads `RefreshToken.family_id` | D1, exception E8, rotation after 8.5 |
| 4 | Email tokens resting in the database | Not the case: `notify` exists only in the response, isn't stored, audited or logged (`lib/backend.ts` logs path and status only) | 8.3: tokens short-lived and single-use (#9), never logged; a test checks `notify` is absent from logs |
| 5 | How FastAPI knows a call came from the website; spoofable client address | The first holds already: every call carries the website's service token (`X-Vertex-Service`, G18). The second is **confirmed**: the stacks publish Next.js directly, so `X-Forwarded-For` is whatever the client sends, and the per-address limits (sign-in, forgot password, Google) can be dodged by changing it | Before 8.2: take the address from a trusted proxy hop only (or the socket when there's none); a test sends a forged header |
| 6 | 422 errors echoing a password | Already safe: FastAPI's validation handler (`app/core/api.py`) returns field names and messages, never the input | 8.2: a test on every `/auth` route that the submitted values never come back or reach the logs |
| 7 | Blocked sign-ins unrecorded; no limit in FastAPI | Follows from D2 | D2 A as revised |
| 8 | The website can read password and token hashes | Confirmed: `vertex_web` has `SELECT` on all of `User` and `RefreshToken` | After 8.3: column-level grants; `vertex_web` loses `password_hash`, `token_hash` and `google_id` |
| 9 | Reset tokens not single-use | Confirmed: stateless JWTs, valid until expiry | 8.3: bound to the current password hash, so a used link or a password change ends it; a password change bumps `token_version` (the trigger does) |
| 10 | bcrypt differences, blocking, timing | `bcryptjs` truncates at 72 bytes, Python's `bcrypt` rejects longer input; no maximum length in the schemas | 8.2: truncate to 72 bytes exactly as `bcryptjs` does (tested with a long password set on the website), hash in a worker thread, a dummy check for unknown emails |
| 11 | Mass assignment on public writes | — | 8.3, 8.4: schemas forbid unknown fields; the server sets role and status |
| 12 | Who may grant admin; `onPrivilegeGranted` | — | 8.3: checked in FastAPI; the last admin can't be removed or demoted, nobody promotes themselves; the alert moves |
| 13 | Concurrent refreshes | The 30-second grace exists today | 8.2: kept, with a test |
| 14 | Cookie flags from FastAPI's answer | — | 8.2: the website still sets the cookies; a test pins the flags to today's |
| 15 | Google flow details | `state` now has a nonce (#131) | 8.2: exact redirect URI, ID token checks (issuer, audience, expiry, signature), match on `sub` after the first link |
| 16 | The D5 exemption growing quietly | — | D5 A: exact-list test; expired-row clean-up keeps its `DELETE` |

**Exceptions to register** (owner sign-off needed; `docs/security/exceptions.md`):

| Id | Exception | Compensating controls | Expiry |
|---|---|---|---|
| E8 | Shared symmetric session key (D1 A) | Secret in the environment only; the live-session check on every request; column-level grants (#8) | Key rotation to asymmetric keys after 8.5 |
| E9 | `RefreshToken` not row-audited (D5 A) | Security events for every session decision; the exact-list test | Reviewed at 8.5 |
| E10 | Two writers of `User` between 8.2 and 8.4 (D6 A) | Both audited, both fire the `token_version` trigger | 8.4 |

After 8.2 and again after 8.5, run the kill-switch drill on staging and
check the G19 rows of `verify-stack.sh`.

## 7. Progress

| Step | State |
|---|---|
| Google fix | #131: state nonce, verified email, linked accounts by `google_id`, pre-hijack |
| 8.1 | Done (this PR): `vertex_be/app/api/v1/referral_agents.py`, `create_target`; `vertex_web` loses its writes on `ReferralAgentTarget`. Needs none of D1–D6 or E8–E10 |
| 8.2–8.5 | Not started: 8.2 waits for D1–D6 and the signing of E8–E10 |
