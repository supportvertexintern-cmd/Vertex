# Audit, logging and monitoring

Phase 10. Recorded 2026-10-11 from branch `security/audit-logging-monitoring`.
Closes baseline gaps **G7** (denials not audited), **G20** (sign-ins not
audited) and **G21** (document views not audited); see
[phase2-baseline.md](phase2-baseline.md).

## 1. Structured logs

Both services write one JSON object per line to stdout, with the same shape:

```json
{"ts":"2026-10-11T09:25:43.092Z","level":"warn","service":"nextjs","env":"staging",
 "event":"security.login_failed","request_id":"6f1c…","reason":"bad_password","email_fp":"9b2e…","ip":"203.0.113.7"}
```

| Field | Meaning |
|---|---|
| `ts`, `level` | UTC time; `debug` / `info` / `warn` / `error` / `alert` |
| `service`, `env` | `nextjs` or `backend`; the stack's `APP_ENV` |
| `event` | Stable dotted name to search and alert on (`security.access_denied`, `alert.raised`, `http.request`) |
| `request_id` | Correlation ID (§2) |
| other fields | Event details, always redacted (§4) |

- **Next.js:** `vertex/src/lib/log.ts` (`log.info|warn|error|alert(event, fields)`). Every server-side `console.*` call was converted; only two browser-side calls in `AIChatWidget.tsx` remain.
- **FastAPI:** `vertex_be/app/core/logging.py`. Uvicorn's access log is replaced by one `http.request` line per request: method, path **without the query string**, status and duration.
- **Logging never throws.** A broken log line can't change a request's outcome (tested in both services).
- **Storage and protection:** Docker keeps each container's log on the host (`json-file`, rotated at 10 MB × 5 files, set in `docker-compose.deploy.yml`). Only host administrators can read them. On a cloud host, ship stdout to the provider's log service (e.g. CloudWatch Logs) with the same rotation and an access policy limited to operators.

## 2. Correlation IDs

Every request gets one ID, used everywhere:

1. **Source.** `src/proxy.ts` (Next.js) and `RequestContextMiddleware` (FastAPI) take the caller's `X-Request-ID` if it matches `^[A-Za-z0-9._:-]{8,128}$`. Anything else is replaced with a fresh UUID, so log lines can't be injected.
2. **Response.** The ID is returned in the `X-Request-ID` response header. That includes redirects and 4xx responses, and FastAPI also exposes it to browsers through CORS.
3. **Handlers.** Next.js passes the ID and path to handlers as request headers. The client's own `x-vertex-path` is always overwritten.
4. **Logs and audit.** The ID goes into every log line written during the request and into `AuditLog.request_id` (new column, migration `0003`, indexed).
5. **Between services.** Next.js does not call FastAPI today (trust-boundaries P2: N/A). When it does, it must forward `X-Request-ID`. Both services already accept and keep a caller's ID, so one trace will span both.

To trace an event, take the `request_id` from an audit row or an alert email, then:

```sh
docker logs vertex-staging-nextjs-1 2>&1 | grep '"request_id":"<id>"'
docker logs vertex-staging-backend-1 2>&1 | grep '"request_id":"<id>"'
```

## 3. What is recorded

Security events go through `recordSecurityEvent()` (`lib/audit.ts`). Each one becomes an `AuditLog` row and a log line, and is then checked by the monitor (§6).

| Action | Where | Recorded detail |
|---|---|---|
| `login_succeeded` | password login, Google sign-in | user, method, role |
| `login_failed` | unknown account, no password set, bad password, unverified email, unknown Google account | reason, method, `email_fp` (§4), IP |
| `login_rate_limited` | login over its rate limit | IP |
| `logout` | logout with a valid session | user |
| `access_denied` | `requireRole` (wrong role) and `forbidden()` (record or scope check, 65 call sites) | user, role, allowed roles, path |
| `password_reset_requested` / `password_reset_completed` | forgot-password, reset-password (including invalid links) | fingerprint or user, outcome |
| `document_link_issued` | signed URL for a candidate document (G21) | user, document, type, candidate |
| `document_downloaded` / `document_link_rejected` | document file endpoint (G21) | storage key, size; never the token |
| `malware_rejected` / `malware_blocked_download` | Phase 9 scanner | signature |
| `alert_raised` | security monitor (§6) | rule, severity, counts |

These were already recorded and are unchanged:

- **Data changes** (create, update, delete on 21 models) through `auditedPrisma`, now with `request_id`.
- **Bulk exports** (`auditAccess`), which fail closed.

**Privileged operations** are data changes made by admin and staff routes: user and role changes, password resets for others, partners, fee policies and so on. `auditedPrisma` records them with before/after snapshots, and granting `admin` raises an alert (§6).

**FastAPI** (`vertex_be/app/core/audit.py`, step 0.3 of the backend plan) writes to the same trail, in the same row shape:

- **Data changes:** a flush hook on every SQLAlchemy session records each create, update and delete of the same audited models as `auditedPrisma`. `tests/test_audit.py` fails CI if the two lists differ. Unlike `auditedPrisma`, the audit row is in the **same transaction** as the change, so a change can't commit unrecorded.
- **Fail closed:**
  - the actor must be declared (`AuditedDb` in a route, `set_audit_actor(db, None)` for system work), or the write raises;
  - bulk `UPDATE`/`DELETE` statements on audited tables are refused;
  - SQL sent straight to the connection bypasses the hook, so code review covers that.
- **Security events:** `record_security_event()` logs and appends in its own transaction. `require_role()` uses it for `access_denied`.
- **The alert monitor** (§6) is FastAPI's since reads handover R7a: `record_security_event()` passes every event to `app/services/security_monitor.py`.
- **The website's own events** (its rate limit, its early role check, download links, exports) are recorded through `POST /api/v1/audit-events` since R7a, with its service credential; the actor is the session's user. An export is refused (503) if it can't be recorded.

**Not audited, by design:**

- A 401 with no session at all is ordinary anonymous traffic.
- An expired session token is logged (`auth.invalid_token`, info) but not audited.
- Business-rule 403s (feature switched off, payments not enabled, stage transition not allowed) aren't access decisions, so they keep their plain responses.

## 4. Keeping credentials out

`lib/redact.ts` (and its Python twin in `app/core/logging.py`) runs on every log line, audit snapshot and audit detail:

- **By key.** Any field named like `password`, `secret`, `token`, `authorization`, `cookie`, `api_key`, `credential`, `database_url`, `dsn` or `session` is replaced with `[redacted]`, at any depth. Two business fields that merely match are allowlisted: `permit_authorization_approved` and `stripe_checkout_session_id`. Passport fields are not caught, because the pattern doesn't match plain `pass`.
- **By shape**, anywhere in free text:
  - JWTs
  - `Bearer …` tokens
  - `token=` and `password=` parameters
  - connection strings with credentials (`postgresql://user:<password>@` becomes `postgresql://[redacted]@`)
- **Failed sign-ins** store a SHA-256 fingerprint of the address (`email_fp`), never what was typed. Users sometimes type their password into the email field.
- `User.password_hash` stays explicitly redacted in snapshots, as before.
- **Verified:**
  - Unit and integration tests cover all of the above.
  - `verify-stack.sh` counts JWT-, connection-string- and bcrypt-shaped strings in each stack's container logs and expects 0. It only counts and never prints a match.

## 5. Who can read and change audit data

| Who | Read | Append | Change or delete |
|---|---|---|---|
| Next.js | ❌ no database access since reads handover R8 | ❌ it records through FastAPI (`POST /api/v1/audit-events`) | ❌ |
| `vertex_api` (FastAPI) | ❌ **no `SELECT`** (revoked in Phase 10). Functions only it may run: a case's history without snapshots and the dates submissions were rejected (migration 0008, R5), and the alert monitor's counts (0009, R7a), numbers only | ✅ the only writer | ❌ |
| `vertex_readonly` (pgAdmin) | ❌ no `AuditLog` columns granted | ❌ | ❌ |
| `vertex_migrator` (owner) | ✅ | ✅ | ❌ triggers refuse even the owner |
| Runtime roles: disable or drop the triggers | n/a | n/a | ❌ not the owner (tested) |

- **In the app:** two pages show it, both answered by FastAPI since reads handover R5 (owner's decision 2026-11-02). A case's history (`GET /api/v1/cases/{id}/audit-log`) applies the case's own access check and returns summaries only (actor name, action, time); rejected submissions show each one's rejection date. The functions return no snapshots, so FastAPI never sees them.
- **Where it's enforced:** `deploy/db-roles.sql`.
- **How it's tested:** `tests/test_db_roles.py` (including the functions, and that the website can neither read nor append) and live `verify-stack.sh` rows.

## 6. Monitoring and alerts

Rules agreed with the owner on 2026-10-11. Since reads handover R7a they run in FastAPI (`vertex_be/app/services/security_monitor.py`, moved from the website's `lib/security-monitor.ts` rule for rule), on the events it records. The counts come from `vertex_security_count` (migration 0009), which answers only the four questions below and refuses any other:

| Rule | Fires when | Severity | Repeats at most |
|---|---|---|---|
| `brute_force_account` | ≥ 10 failed sign-ins for one address (by fingerprint) in 15 min | high | once / 15 min |
| `brute_force_ip` | ≥ 20 failed sign-ins from one IP in 15 min | high | once / 15 min |
| `authorization_probing` | ≥ 20 denials for one user in 10 min | high | once / 10 min |
| `malware_detected` | an upload is rejected as infected, or a stored file is blocked | critical | once / file / hour |
| `privilege_granted` | a user becomes `admin` (promotion or creation) | critical | every time |
| `audit_write_failed` | an audit row can't be written | critical | once / 15 min |
| `malware_scanner_unavailable` | clamd unreachable, so uploads are accepted unscanned | high | once / hour |
| `refresh_token_reused` | a spent refresh token is used again (E6); the session is revoked | high | once / session / 15 min |
| `shared_ip_sign_ins` | ≥ 5 accounts sign in from one address in 60 min (checked on each sign-in) | medium | once / address / hour |
| `sign_in_after_reset_new_ip` | a sign-in within 24 h of a password reset, from an address the account never signed in from before the reset | high | once / account / day |
| `partner_login_not_activated` | a partner login still unused 7 days after it was created (scheduled) | medium | once / account / 30 days |
| `inactive_account` | an activated login, not deactivated, with no sign-in for 60 days (decision D5; scheduled) | medium | once / account / 30 days |
| `sign_in_new_country` | a sign-in from a country none of the account's earlier sign-ins came from (the first known country is the baseline; flag only, D4) | high | once / account / country / day |
| `rapid_sign_ins` | ≥ 10 successful sign-ins by one account in 10 min | medium | once / account / 10 min |
| `unusual_read_rate` | ≥ 1,500 signed-in reads by one account in 5 min (about 5 a second: a script, not a person) | medium | once / account / 5 min |
| `unusual_write_rate` | ≥ 150 signed-in changes by one account in 5 min | high | once / account / 5 min |

The last four come from admin monitoring phase 5 (owner's requirements 2026-11-07, §4.4).

- **Medium alerts are rows on Suspicious Activity, not emails.** A scheduled scan could otherwise mail every stale login at once. High and critical alerts are emailed as before.
- **The two scheduled checks** run every `MONITOR_CHECKS_INTERVAL_MINUTES` (default 360; 0 turns them off) in each backend worker, and also from **Run account checks** on the Security Overview. Each rule's window, checked on the trail, stops an account being raised twice.
- **The last four** are the owner's additions (2026-11-07):
  - The rates are counted per account on each signed-in request (`app/services/activity.py`, from `current_user`): in Redis when `REDIS_URL` is set, otherwise in the process. Each window is fixed and starts at the account's first request.
  - **Countries** come from DB-IP's free "IP to Country Lite" database (CC BY 4.0; the pages credit it).
    - `scripts/fetch_geoip.py` bundles it into the backend image at `/opt/geoip`. It takes the build's month (`GEOIP_MONTH`, from `build.yml` and `ci.yml`), so the first build each month fetches the new file.
    - If the download fails, the build still succeeds. The image then has no database: every country is "unknown", the new-country check is off, and the Security Overview says so.
    - Each sign-in and refused sign-in records its country (`detail.country`).

The last two were added at the owner's invitation to "raise any concern": one means the audit trail is silently failing, the other that the fail-open malware policy is in effect.

**An alert produces:**

1. A log line at level `CRITICAL` (`event: alert.raised`).
2. An `alert_raised` audit row, keyed by rule and subject, which gives deduplication across processes.
3. A `SecurityAlert` row (admin monitoring phase 2, migration 0013), written in the same transaction as the audit row, for **Admin → Monitoring → Suspicious Activity**. It names the account the alert is about when one is known (the target of a brute force on a known address, the user denied, the session's owner, the uploader, the promoted user) and the address.
4. A plain-text email to `SECURITY_ALERT_EMAILS` (comma-separated). If that's unset, it goes to every admin user. FastAPI sends it (`app/core/mailer.py`, the backend's own `SMTP_*` settings) off the request, so a slow mail server never holds one.

The email has the rule, environment, time, counts and the request ID, and never credentials.

**Reviewing alerts (Suspicious Activity, admins only):** each alert is a row, newest first, filtered by status, severity, type, account and date. The sidebar's badge counts the open ones. An admin marks one **reviewing**, then **resolved** or **dismissed** (a false positive). Closing or reopening one needs a note, and it can't go back to open. Each change is an audited row change (who, when, the note). From an alert, the admin can open its account, end its sessions, or deactivate it (phase 1). An account's open and reviewing alerts are its **Flags** in User Accounts. The rows are never deleted and never exported (`backup.NEVER_EXPORTED`); like the trail, they stay whole in the database backups. Migration 0013 copied in the alerts already on the trail, as open.

**Partners & Logins (admin monitoring phase 3, admins only):** one row per agency, with who added it (`Partner.created_by`, migration 0014, backfilled from the trail's create rows) and its login: when and by whom it was created, its status and latest sign-in. Its CSV (`GET /monitoring/partners.csv`, the filtered list) records an `export` event, with the row count and the filters but never the search text, before it leaves. If the event can't be written, it's refused (503). Cells a spreadsheet would run as formulas are prefixed with an apostrophe.

**Audit Trail (phase 4, admins only):** Admin → Monitoring → Audit Trail lists the trail newest first.

- **How it's read:** through `vertex_audit_trail` (migration 0015). `vertex_api` still can't read `AuditLog`. A call returns at most 200 rows.
- **Filters:** actor, action, record type, record id, dates. An account's id also matches its security events (`user:<id>`).
- **What each entry shows:** for a row change, the fields that changed (before → after). For a security event, what it recorded and the address.
- **Every read** records `audit_trail_viewed`, with its filters. Nothing on the page changes the trail.
- **"View history"** opens it on one account (from User Accounts) or one agency (from Partners & Logins).

**Security Overview (phase 5, admins only):**

- **Counts for the last 24 hours and the last 7 days:**
  - open suspicious items by severity;
  - alerts raised;
  - failed sign-ins and sign-ins (`vertex_monitoring_counts`);
  - accounts deactivated;
  - partner logins not activated after 7 days;
  - new partners and new partner logins;
  - active sessions.
- **The 10 latest alerts.**
- Each card opens the page that lists it.

**Locked Accounts (admins only):** Admin → Monitoring → Locked Accounts lists the accounts the per-account sign-in limit holds now (10 failed sign-ins in 15 minutes; `ACCOUNT_MAX_FAILURES` in `sessions.py`), with how long each lock has left.

- A lock is keyed by the email's fingerprint, so an address with no account can be held too.
- **Unlock** (here, or in an account's view) lifts the lock at once and records `login_unlocked`: who did it, and whether the account was locked. The failed attempts stay on the trail.
- The website's per-address limits are separate and expire on their own. Refused sign-ins are recorded as `login_rate_limited` and found on the Audit Trail.

**Delivery per environment:**

- **Local stacks:** email goes to each stack's own Mailpit, which never relays anything. Web UI:
  - dev: `127.0.0.1:8026`
  - staging: `127.0.0.1:8027`
  - main: `127.0.0.1:8028`
- **A real host:** set `SMTP_*` to a relay and `SECURITY_ALERT_EMAILS` to a monitored inbox.

**Limits:**

- Counts come from the audit trail, so they hold across processes and restarts.
- The per-process dedupe is only a first filter.
- IP-based rules trust `X-Forwarded-For` (G14): behind a proxy that sets it, they are accurate; without one, an attacker can rotate it. The account rule doesn't depend on it.

## 7. Failure behavior (logging can't grant access)

| Failure | Result |
|---|---|
| Audit write fails during a denial (`requireRole`, `forbidden`) | Still 403. The failure is logged and alerted |
| Audit write fails during login | Wrong password still 401; right password still required |
| Log output throws | Ignored; the request proceeds with the decision already made |
| Invalid session while logging throws | Still no user (`getAuthUser` → `null`) |
| Audit write fails after a data change | Request fails (500): the change is never reported as done unrecorded. Logged and alerted |
| Audit write fails for an export | Export refused (fail closed, unchanged) |
| Monitor or email fails | Logged (`monitor.evaluate_failed`, `alert.email_failed`); the request is unaffected |

Tested in `tests/test_security_monitor.py` (moved from the website's `security-events.integration.test.ts` in reads handover R7a) and `tests/test_logging.py`.

**Known limit, closed:** `auditedPrisma` wrote the audit row after the change, not in the same transaction. Every write is FastAPI's since the write migration, in one transaction with its row (§3), and `auditedPrisma` was removed in reads handover R7a.

## 8. Verification

| Check | Where | Result |
|---|---|---|
| Redaction, log shape, request IDs, proxy | `src/lib/logging.test.ts` | 11 pass |
| Events, tracing, alerts, failure behavior, G21 | `src/lib/security-events.integration.test.ts` (real Postgres) | 15 pass |
| Full Next.js suite | `npx vitest run` | see PR |
| Backend logging and request IDs | `tests/test_logging.py` | 11 pass |
| Audit grants (`vertex_api` can't read; triggers can't be disabled or replaced) | `tests/test_db_roles.py` | pass |
| Live stack: ID echo, trace (response → log → audit row), JSON logs, no credentials in logs, log rotation, grants, Mailpit | `deploy/verify-stack.sh` | per deploy |
