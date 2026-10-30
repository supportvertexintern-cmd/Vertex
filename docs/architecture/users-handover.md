# Users and sessions handover (backend plan step 8)

Status: **proposed, awaiting the owner's decisions** (§3). Follows
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

**Finding:** the callback matches an existing account by email **without
checking Google's `email_verified`**. A Google account whose address isn't
verified could link itself to, and sign in as, the Vertex account with that
email. The fix is proposed with the move (D3).

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
| **A. The same key and format (recommended)** | FastAPI signs access tokens exactly as `lib/jwt.ts` does (HS256, the HKDF `session` key from `JWT_SECRET`, the same claims). The proxy and `getAuthUser()` keep verifying them unchanged | No change for the website or outstanding tokens. Next.js keeps `JWT_SECRET` and so *could* still mint a token, but it would need a live session to pass, and a compromised website already sees every user's cookies |
| B. Asymmetric keys | FastAPI signs with a private key (EdDSA); Next.js and FastAPI verify with the public key; `JWT_SECRET` is removed from the website for sessions | A new key to manage and rotate; tokens issued before the switch stop working within 15 minutes (refresh mends them). Small gain, for the reason in A |

### D2. Where are sign-in attempts rate-limited?

| Option | How | Cost |
|---|---|---|
| **A. The website keeps the limits (recommended)** | It sees the client's address; the limits stay in each handler (`route-guards.test.ts` checks them). FastAPI records the security events | None: today's behaviour |
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
| **A. No: sessions are recorded as security events (recommended)** | Exempt `RefreshToken` from `test_audit_coverage.py`, by name and with this reason. Starting, refreshing after reuse, revoking and the kill switch stay recorded as events, as they are today | One named exception to the 2026-10-26 rule |
| B. Yes, like every table | Every rotation writes an audit row | The log grows by one row per user every 15 minutes, each holding a token hash |

### D6. How does it switch?

| Option | How | Cost |
|---|---|---|
| **A. In sub-steps, like payments (recommended)** | §4. `User` keeps two writers, both audited, between 8.2 and 8.4 (as `CasePayment` did between 7.2 and 7.3) | One release per sub-step |
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

## 6. Progress

| Step | State |
|---|---|
| 8.1–8.5 | Not started: waiting for D1–D6 |
