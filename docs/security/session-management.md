# Session management and revocation (G19, exception E6)

Closes gap G19 from [phase2-baseline.md](phase2-baseline.md): a session used to be one 7-day JWT that nothing could revoke. Demoting, deleting or changing the password of a user did not end their sessions.

**Goal.** Any session can be killed. High-risk events take effect on the next request.

## 1. Design

| Piece | What it is |
|---|---|
| Access token | JWT in the `auth_token` cookie, **15 minutes**. Holds the user, the session ID (`sid`) and the user's `token_version` (`ver`). |
| Refresh token | Random 256-bit value in the `refresh_token` cookie. `HttpOnly; SameSite=Strict; Path=/api/auth` (`Secure` in production). The database keeps only its **SHA-256**. |
| Session | One refresh-token *family*: the `RefreshToken` rows that share a `family_id`. This is what users see and end. |
| Lifetime | Absolute; rotating the token doesn't extend it. **12 hours** for staff and admins, **14 days** for candidates and partners. |
| `User.token_version` | Bumped by the database trigger `user_token_version_bump` whenever `password_hash` or `role` changes, whatever code path makes the change. |

**Every request re-checks the session.** `getAuthUser` (`vertex/src/lib/api-auth.ts`) verifies the signature, then loads the user and the session in one query. It refuses the request if any of these holds:
- the user is gone;
- `token_version` has moved on;
- the family has no live token.

Role and email come from the database, never from the token. Postgres is the denylist; there is no Redis in this stack, and none is needed.

`src/proxy.ts` checks only the signature, and only to route portal pages. It sends a page with an expired or missing access token through `GET /api/auth/refresh?redirect=…`, which either renews the token or goes to sign-in.

**Rotation and reuse.** Each refresh spends the presented token (`used_at`) and adds a new row to the same family. If someone presents a spent token again, it is treated as theft:
- the whole family is revoked;
- a `refresh_token_reused` event is recorded;
- an alert is raised by email and in the log.

There is one exception: a spent token presented within **30 seconds** is answered 401 without revoking anything. That is two tabs refreshing at once.

**Browser side.** `components/SessionRefresh.tsx` wraps `fetch`. On a 401 from `/api/*` it refreshes once, sharing one refresh between concurrent calls, and replays the request. If the refresh fails, a portal page goes to sign-in.

Code: `vertex/src/lib/session.ts`. Schema: migration `0005` (`vertex_be/alembic/versions/20261012_0005_session_revocation.py`).

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
| Refresh token reused | That session | family revoked, alert |
| Kill switch | Every session on the stack | `deploy/sessions-kill-switch.sh` (§5) |

Not applicable today:
- **MFA reset:** the app has no MFA.
- **Account disable:** there is no disabled state. Offboarding deletes the account, or uses the admin "Sign out everywhere" first. If a disabled flag is added later, it must end sessions the same way, through the trigger or `revokeAllForUser`.

## 3. Where users and admins do this

- **Every portal** (`PortalShell`) has **Active sessions** in the sidebar. It lists each signed-in browser (device, signed in, last active, "This browser"), with **End session** per row and **Log out everywhere**.
- **Admin → Users** has a **Sign out everywhere** button on every row.

## 4. Logging and alerts

| Event | Where |
|---|---|
| `session.issued`, `session.refreshed`, `session.refresh_rejected` (with reason), `session.revoked`, `session.revoked_all` | application log (JSON) |
| `auth.session_rejected` (user gone, version changed, session ended) | application log |
| `sessions_revoked` (user, admin or kill switch, with reason and count) | audit trail + log |
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

**Rotate the signing secret** (suspected `JWT_SECRET` leak):

1. Run the kill switch above.
2. Put a new secret in the stack's env file, without printing it:
   ```sh
   new=$(openssl rand -base64 48 | tr -d '\n'); sed -i "s|^JWT_SECRET=.*|JWT_SECRET=$new|" .env.<stack>; unset new
   ```
3. Redeploy the running tag: `ENV_FILE=.env.<stack> bash deploy/deploy.sh vertex-<stack> <tag>`.

Effects:
- Every access token fails its signature check.
- Email-verification, password-reset, invite and document links also stop working, because all purposes derive their keys from `JWT_SECRET`. Re-send pending invites.

**Rollover without logging anyone out.** Rotate the secret without step 1. Access tokens fail, but refresh tokens are opaque database values, so every browser gets a new access token, signed with the new key, on its next request.

**Tested:** see §7.

## 6. Tests

| Test | File |
|---|---|
| Live session accepted; demotion, deletion and password change refused on the next request; revoked session refused; pre-G19 and forged-session tokens refused | `vertex/src/lib/session-revocation.integration.test.ts` |
| Rotation spends the old token; only hashes stored; reuse revokes the family and raises the alert; two-tab race keeps the family; revoked, expired and unknown tokens refused | same |
| 15-minute access tokens, 12 h / 14 d sessions, cookie flags and path | same, and `jwt.test.ts` |
| Logout, per-session end (and not another user's), log out everywhere, admin revoke (and non-admin refused) | same |
| Trigger bumps `token_version` on password or role change only | `vertex_be/tests/test_schema.py` |
| FastAPI (`vertex_api`) has no access to `RefreshToken`; runtime roles can't disable or replace the trigger; new columns hidden from the read-only role | `vertex_be/tests/test_db_roles.py` |
| Live: a validly signed token without a live session → 401; refresh without a token → 401 | `deploy/verify-stack.sh` |

## 7. Evidence

| Date | What | Result |
|---|---|---|
| 2026-10-12 | Backend tests (throwaway Postgres) | 91 passed |
| 2026-10-12 | Next.js tests (throwaway Postgres + MinIO, CI layout) | 327 passed; 1 ClamAV timeout under parallel load, passes alone |
| 2026-10-12 | Kill-switch SQL on a throwaway database | 3 sessions / 2 users ended, 0 live tokens left, reason stored verbatim (quoting-safe) |

**Deployment note.** Access tokens issued before this change have no session ID, so they are refused, and everyone signs in once after the deploy.
