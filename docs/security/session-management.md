# Session management and revocation (G19, exception E6)

Closes gap G19 from [phase2-baseline.md](phase2-baseline.md): a session used to be one 7-day JWT that nothing could revoke. Demoting, deleting or changing the password of a user did not end their sessions.

**Goal.** Any session can be killed. High-risk events take effect on the next request.

## 1. Design

| Piece | What it is |
|---|---|
| Access token | JWT in the `auth_token` cookie, **15 minutes**, ES256, signed by FastAPI with a key only it holds and named by `kid`. Holds the user, the session ID (`sid`) and the user's `token_version` (`ver`). |
| Refresh token | Random 256-bit value in the `refresh_token` cookie. `HttpOnly; SameSite=Strict; Path=/api/auth` (`Secure` in production). The database keeps only its **SHA-256**. |
| Session | One refresh-token *family*: the `RefreshToken` rows that share a `family_id`. This is what users see and end. |
| Lifetime | Absolute; rotating the token doesn't extend it. **12 hours** for staff and admins, **14 days** for candidates and partners. |
| `User.token_version` | Bumped by the database trigger `user_token_version_bump` whenever `password_hash` or `role` changes, whatever code path makes the change. |

**Every request re-checks the session, in FastAPI.** `current_user` (`vertex_be/app/core/auth.py`, below) verifies the signature, then refuses the request if any of these holds:
- the user is gone;
- `token_version` has moved on;
- the family has no live token.

Role and email come from the database, never from the token. Postgres is the denylist.

Until reads handover R7d, the website's `getAuthUser` (`vertex/src/lib/api-auth.ts`) ran the same check against the database. Since R7d (D2 A) the website reads no data of its own: every read and write is a FastAPI call, which checks the session. So `getAuthUser` checks only the token's signature and expiry. That decides which page to show and the early refusal of a wrong role, never what data comes back. A revoked, deleted, demoted or re-passworded user gets no data from the next request. For at most the access token's 15 minutes, they may still see a page's frame, without its data. `vertex_web` can't read `RefreshToken` at all since R7d.

`src/proxy.ts` checks only the signature, and only to route portal pages. It sends a page with an expired or missing access token through `GET /api/auth/refresh?redirect=…`, which either renews the token or goes to sign-in.

**Rotation and reuse.** Each refresh spends the presented token (`used_at`) and adds a new row to the same family. If someone presents a spent token again, it is treated as theft:
- the whole family is revoked;
- a `refresh_token_reused` event is recorded;
- an alert is raised by email and in the log.

There is one exception: a spent token presented within **30 seconds** is answered 401 without revoking anything. That is two tabs refreshing at once.

**Browser side.** `components/SessionRefresh.tsx` wraps `fetch`. On a 401 from `/api/*` it refreshes once, sharing one refresh between concurrent calls, and replays the request. If the refresh fails, a portal page goes to sign-in.

**Mobile app.** The Flutter app has no cookie jar, so it signs in through `/api/auth/app/login`, `/refresh` and `/logout` (`vertex/src/lib/app-auth.ts`).
- **The same sessions as the browser:** the same password check (`lib/password-login.ts`), the same families, rotation, reuse detection, lifetimes and revocation. Only the transport differs: the tokens are in the JSON body, and these routes never read or set the session cookies.
- **The cookie is never accepted for refresh.** `/api/auth/app/refresh` takes the refresh token from the body only; otherwise a script injected into the website could trade the HttpOnly cookie for raw tokens.
- **CORS** is allowed on these three routes only, for `APP_ORIGINS` (the Flutter web build), without credentials.
- **On the device** (`vertex_app/lib/core/auth/`):
  - the refresh token is in secure storage (Keychain / Keystore), and the access token only in memory;
  - `ApiService` renews the token a minute before it expires, or once after a 401, sharing one refresh between concurrent calls; if that fails, the user is signed out;
  - roles the app has no screens for (candidate, referral agent) are refused, and the session just opened is ended.

Code: FastAPI issues, rotates and revokes sessions since users and sessions step 8.2 (`vertex_be/app/services/sessions.py`, `vertex_be/app/api/v1/sessions.py`; `docs/architecture/users-handover.md`). The website's `/api/auth` routes pass requests on and set the cookies (`vertex/src/lib/auth-backend.ts`); `vertex/src/lib/session.ts` keeps the cookies. The website can't sign a session: since session keys K3 a session is ES256, signed with a private key only FastAPI holds (`vertex_be/app/core/session_keys.py`), and `vertex/src/lib/jwt.ts` only verifies it with the listed public keys. Tests make tokens with `vertex/src/lib/test-tokens.ts`. Schema: migration `0005` (`vertex_be/alembic/versions/20261012_0005_session_revocation.py`).

**FastAPI verifies the same sessions (G9).** Since step 8.2 FastAPI is also the issuer, with the same key and format (exception E8). `current_user` (`vertex_be/app/core/auth.py`) applies these checks:
- the signature, with the listed public key the token's `kid` names (`app/core/tokens.py`, `app/core/session_keys.py`; the website checks the same, pinned by the golden vector in `tests/node_session_vectors.py`);
- the user still exists, and `token_version` matches;
- the family has a live token.

So logout, the kill switch, and a password or role change end FastAPI access on the next request too. Differences, both deliberate:
- **Bearer only.** FastAPI reads the token from `Authorization: Bearer`, never from the `auth_token` cookie, so other sites can't make a browser send authenticated requests to it (CSRF). The Flutter app and Next.js's server-side calls send the header.
- **Session rows.** Since step 8.2 `vertex_api` writes `RefreshToken`, and the website has no database access since reads handover R8. The request check still asks `vertex_session_is_live(user_id, family_id)` (migration `0007`), a `SECURITY DEFINER` function that answers only yes or no and is executable by `vertex_api` alone.

## 2. What ends a session

| Event | Effect | Mechanism |
|---|---|---|
| Logout | This session | `POST /api/auth/logout` revokes the family |
| "Log out" on one session | That session | `DELETE /api/auth/sessions/:id` (own sessions only; another user's ID → 404) |
| "Log out everywhere" | All of the user's sessions | `DELETE /api/auth/sessions` |
| Password change or reset | All of the user's sessions, next request | trigger bumps `token_version` |
| Role change | All of the user's sessions, next request | trigger bumps `token_version` |
| Account deleted (offboarding) | Immediately | user lookup fails; rows cascade |
| Admin "Sign out everywhere" | All of the user's sessions, next request | `DELETE /api/admin/users/:id/sessions` (admin only) |
| Admin "End session" on one of a user's sessions | That session | `DELETE /api/admin/users/:id/sessions/:sessionId` (admin only; another user's session → 404) |
| Account deactivated (by an admin, or by suspending its partner agency) | All of the user's sessions, next request | `POST /api/admin/users/:id/deactivate`: the families are revoked in the same commit, and `current_user` and refresh both refuse a deactivated account (§2a) |
| Refresh token reused | That session | family revoked, alert |
| Kill switch | Every session on the stack | `deploy/sessions-kill-switch.sh` (§5) |

Not applicable today:
- **MFA reset:** the app has no MFA.

## 2a. Deactivated accounts (admin monitoring, phase 1, 2026-11-07)

Offboarding no longer needs a delete. An admin deactivates the account under **Admin → Monitoring → User Accounts**, with a reason (`User.deactivated_at`, `deactivated_by`, `deactivation_reason`, migration 0012). Suspending a partner agency deactivates its login too (owner's decision D2); making the agency active again leaves the login deactivated until an admin reactivates it.

While an account is deactivated:

- password and Google sign-in are refused (`account_deactivated`, only after the password is right, so it tells a guesser nothing); Google never links to it;
- a refresh is refused and that family revoked; a still-valid access token is refused on its next request (`current_user`);
- account setup and password reset links are refused, forgot-password sends nothing (with its usual answer), and staff or partner password resets wait for reactivation.

Reactivating clears the three fields and nothing else: `activated_at` and `welcomed_at` stay, so a partner never sees the first-time welcome twice. Nobody deactivates their own account, and a deactivated admin doesn't count towards "at least one admin" (`keep_an_admin`). Both actions record `account_deactivated` / `account_reactivated` (who, why, the address) and the row's own audited change.

## 3. Where users and admins do this

- **Every portal** (`PortalShell`) has **Active sessions** in the sidebar. It lists each signed-in browser (device, signed in, last active, "This browser"), with **End session** per row and **Log out everywhere**.
- **Admin → Users** has a **Sign out everywhere** button on every row.
- **Admin → Monitoring → User Accounts** lists every staff, partner and referral-agent login with its status (not yet activated, active, deactivated), who created it, its latest sign-in and address, and its live sessions. An account's view adds each session with **End session**, its last 50 sign-ins and refused sign-ins (read through `vertex_sign_in_history`, migration 0012; opening it records `audit_trail_viewed`), and **Deactivate** / **Reactivate**, **End all sessions**, **Resend setup email**, **Reset password**.

## 4. Logging and alerts

| Event | Where |
|---|---|
| `session.issued`, `session.refreshed`, `session.refresh_rejected` (with reason), `session.revoked`, `session.revoked_all` | application log (JSON) |
| `auth.session_rejected` (user gone, version changed, session ended) | application log |
| `sessions_revoked` (user, admin or kill switch, with reason and count) | audit trail + log |
| `account_deactivated`, `account_reactivated` (admin, reason, address, sessions ended) | audit trail + log |
| `audit_trail_viewed` (an admin opened an account's sign-in history) | audit trail + log |
| `refresh_token_reused` | audit trail + log + **alert** (rule `refresh_token_reused`, high, email to `SECURITY_ALERT_EMAILS`) |

Refreshes happen every 15 minutes per active user, so they go to the log only, not the audit trail.

## 5. Runbook: emergency kill switch and key rotation

**Sign everyone out of a stack** (suspected mass compromise, leaked database or cookies):

```sh
cd vertex_be
bash deploy/sessions-kill-switch.sh staging "reason, ticket or incident id"
CONFIRM_MAIN=yes bash deploy/sessions-kill-switch.sh main "reason"
```

What it does:
- In one transaction, revokes every live refresh token and writes one `sessions_revoked` audit row with the reason and counts.
- Takes effect on each user's next request, with no restart.
- Exits non-zero if any live token is left.

**Rotate the session key** (routine, or a suspected `SESSION_PRIVATE_KEY` leak). FastAPI signs sessions with an ES256 private key only it holds; FastAPI and the website verify them with the listed public keys (session keys K3, [session-keys-handover.md](../architecture/session-keys-handover.md)). Nobody is signed out:

1. `bash deploy/session-keys.sh --stage .env.<stack>`, then redeploy: the new public key is listed, nothing signs with it yet.
2. `bash deploy/session-keys.sh --promote .env.<stack>`, then redeploy: new sessions are signed with the new key.
3. 15 minutes later at the earliest (the last access token signed with the old key has expired): `bash deploy/session-keys.sh --retire .env.<stack>`, then redeploy.

For a suspected leak, run the kill switch above after step 2 and go straight to step 3: tokens signed with the leaked key stop working at once, and every browser gets a new one on its next request.

**Rotate the account-link secret** (suspected `ACCOUNT_LINK_SECRET` leak): `bash deploy/session-keys.sh --new-link-secret .env.<stack>`, then redeploy. Every verification, reset and setup link already sent stops working: re-send pending invites.

**Rotate `JWT_SECRET`** (suspected leak): it no longer touches sessions or account links, only the tokens the website signs itself (candidate invites, CIF uploads, document links).

1. Put a new secret in the stack's env file, without printing it:
   ```sh
   new=$(openssl rand -base64 48 | tr -d '
'); sed -i "s|^JWT_SECRET=.*|JWT_SECRET=$new|" .env.<stack>; unset new
   ```
2. Redeploy the running tag: `ENV_FILE=.env.<stack> bash deploy/deploy.sh vertex-<stack> <tag>`.

Effects: invite, CIF upload and document links already issued stop working. Re-send pending invites.

**Tested:** see §7.

## 6. Tests

| Test | File |
|---|---|
| Live session accepted; demotion, deletion and password change refused on the next request; revoked session refused | `vertex_be/tests/test_auth.py` (the website's `session-revocation.integration.test.ts` until reads handover R7d) |
| The website: a pre-G19, foreign-key or expired token is nobody; a valid one is its claims, with no database read | `vertex/src/lib/session-check.test.ts` |
| Rotation spends the old token; only hashes stored; reuse revokes the family and raises the alert; two-tab race keeps the family; revoked, expired and unknown tokens refused | same |
| 15-minute access tokens, 12 h / 14 d sessions, cookie flags and path | same, and `jwt.test.ts` |
| Logout, per-session end (and not another user's), log out everywhere, admin revoke (and non-admin refused) | same |
| Trigger bumps `token_version` on password or role change only | `vertex_be/tests/test_schema.py` |
| Since step 8.2, only FastAPI (`vertex_api`) writes `RefreshToken` and Next.js reads it; runtime roles can't disable or replace the trigger; new columns hidden from the read-only role | `vertex_be/tests/test_db_roles.py` |
| Live: a validly signed token without a live session → 401; refresh without a token → 401 | `deploy/verify-stack.sh` |
| Deactivation blocks password, Google, refresh, a live token, setup and reset links; reactivation keeps the activation and the welcome; reason required; not oneself or the last active admin; suspending a partner deactivates its login; only admins | `vertex_be/tests/test_account_monitoring.py` |
| An admin deactivates a partner's login, the partner is refused, reactivated it signs in without a second welcome | `vertex/e2e/partner-crm.spec.ts` |

## 7. Evidence

| Date | What | Result |
|---|---|---|
| 2026-10-12 | Backend tests (throwaway Postgres) | 91 passed |
| 2026-10-12 | Next.js tests (throwaway Postgres + MinIO, CI layout) | 327 passed; 1 ClamAV timeout under parallel load, passes alone |
| 2026-10-12 | Local production build in real Chromium (with E3, [csp.md](csp.md) §6) | The following all passed: UI sign-in; cookie flags (`HttpOnly`, `SameSite=Strict`, refresh cookie path `/api/auth`); 15-minute access cookie; silent refresh on page navigation and on an API call; refresh token rotated; spent token replayed → 401; log out everywhere → sign-in, and portal pages stay closed |
| 2026-10-12 | Kill-switch SQL on a throwaway database | 3 sessions / 2 users ended, 0 live tokens left, reason stored verbatim (quoting-safe) |
| 2026-10-13 | Migration `0005` on vertex-dev and vertex-staging (deploy of `a378352`) | Applied on start; `verify-stack.sh`: staging 54/54, dev 51 (only red rows: the owner's pgAdmin); G19 rows 401 |
| 2026-10-13 | **Kill switch on vertex-staging** (`sessions-kill-switch.sh`, throwaway account) | Signed in → `/api/auth/me` 200; switch ended 1 session; same cookies → 401, refresh → 401, 0 live tokens; audit row `sessions_revoked` with the reason; new sign-in → 200; account removed |
| 2026-10-13 | Rollback of `0005` on a copy of vertex-main's pre-release backup | 0005 → 0004 → 0001 → head; 1,255 rows at every step, `alembic check` clean. Effect of a rollback: everyone signs in again |

**Deployment note.** Access tokens issued before this change have no session ID, so they are refused, and everyone signs in once after the deploy.
