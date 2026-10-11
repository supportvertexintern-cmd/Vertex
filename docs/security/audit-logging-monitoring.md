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
| `vertex_web` (Next.js) | ✅ case history viewer, security monitor | ✅ | ❌ revoked, plus triggers |
| `vertex_api` (FastAPI) | ❌ **revoked in Phase 10** (it has no reader) | ✅ | ❌ |
| `vertex_readonly` (pgAdmin) | ❌ no `AuditLog` columns granted | ❌ | ❌ |
| `vertex_migrator` (owner) | ✅ | ✅ | ❌ triggers refuse even the owner |
| Runtime roles: disable or drop the triggers | n/a | n/a | ❌ not the owner (tested) |

- **In the app:** the only reader is `GET /api/cases/:id/audit-log`. It applies the case's own access check and returns summaries only (actor name, action, time), never snapshots.
- **Where it's enforced:** `deploy/db-roles.sql`.
- **How it's tested:** `tests/test_db_roles.py` and live `verify-stack.sh` rows.

## 6. Monitoring and alerts

Rules agreed with the owner on 2026-10-11 (`lib/security-monitor.ts`):

| Rule | Fires when | Severity | Repeats at most |
|---|---|---|---|
| `brute_force_account` | ≥ 10 failed sign-ins for one address (by fingerprint) in 15 min | high | once / 15 min |
| `brute_force_ip` | ≥ 20 failed sign-ins from one IP in 15 min | high | once / 15 min |
| `authorization_probing` | ≥ 20 denials for one user in 10 min | high | once / 10 min |
| `malware_detected` | an upload is rejected as infected, or a stored file is blocked | critical | once / file / hour |
| `privilege_granted` | a user becomes `admin` (promotion or creation) | critical | every time |
| `audit_write_failed` | an audit row can't be written | critical | once / 15 min |
| `malware_scanner_unavailable` | clamd unreachable, so uploads are accepted unscanned | high | once / hour |

The last two were added at the owner's invitation to "raise any concern": one means the audit trail is silently failing, the other that the fail-open malware policy is in effect.

**An alert produces:**

1. A log line at level `alert` (`event: alert.raised`).
2. An `alert_raised` audit row, keyed by rule and subject, which gives deduplication across processes.
3. A plain-text email to `SECURITY_ALERT_EMAILS` (comma-separated). If that's unset, it goes to every admin user.

The email has the rule, environment, time, counts and the request ID, and never credentials.

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

Tested in `security-events.integration.test.ts` ("logging failures cannot grant access") and `tests/test_logging.py`.

**Known limit:** `auditedPrisma` writes the audit row after the change, not in the same transaction. If that write fails, the change stays but the request fails and an `audit_write_failed` alert goes out. Making it one transaction is a candidate for Phase 7 item 6 (transactions).

## 8. Verification

| Check | Where | Result |
|---|---|---|
| Redaction, log shape, request IDs, proxy | `src/lib/logging.test.ts` | 11 pass |
| Events, tracing, alerts, failure behavior, G21 | `src/lib/security-events.integration.test.ts` (real Postgres) | 15 pass |
| Full Next.js suite | `npx vitest run` | see PR |
| Backend logging and request IDs | `tests/test_logging.py` | 11 pass |
| Audit grants (`vertex_api` can't read; triggers can't be disabled or replaced) | `tests/test_db_roles.py` | pass |
| Live stack: ID echo, trace (response → log → audit row), JSON logs, no credentials in logs, log rotation, grants, Mailpit | `deploy/verify-stack.sh` | per deploy |
