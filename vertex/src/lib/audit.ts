import { callBackend } from "./backend";
import { log } from "./log";
import { REDACTED } from "./redact";
import { currentRequest } from "./request-context";

// The audit rows this app still decides on: FastAPI records them since reads
// handover R7a (POST /api/v1/audit-events, vertex_be/app/api/v1/audit_events.py,
// D3 A), with this app's service credential and the signed-in user's
// session, so the actor is the session's user. FastAPI writes every data
// change itself, redacts what it records and raises the security alerts
// (vertex_be/app/services/security_monitor.py). This app needs no write on
// AuditLog.

/**
 * Records a sensitive *read* such as a bulk export (zero-trust policy §9).
 * Stores who, what and how much, never the data itself. Awaited before the
 * response is sent, and throws if FastAPI couldn't record it, so the export
 * fails too (fail closed).
 */
export async function auditAccess(
  _actorId: string,
  entityType: string,
  action: "export",
  detail: Record<string, unknown>,
): Promise<void> {
  const result = await callBackend("/api/v1/audit-events", { method: "POST", body: { action, entity_type: entityType, entity_id: "bulk", detail } });
  if (!result.ok) throw new Error(`The export couldn't be recorded (${result.error.code}).`);
}

// Filter parameters whose values are safe to keep in the (immutable) audit
// log. Anything else a caller sends, such as a free-text search that could
// hold a name or email address, is recorded by name with its value redacted.
const AUDITABLE_FILTER_KEYS = new Set([
  "start", "end", "from", "to", "status", "stage", "source",
  "country", "country_id", "region_id", "partner_id", "recruiter_id", "page", "limit",
]);

export function auditFilters(params: URLSearchParams): Record<string, string> {
  const out: Record<string, string> = {};
  params.forEach((value, key) => {
    out[key] = AUDITABLE_FILTER_KEYS.has(key) ? value.slice(0, 100) : REDACTED;
  });
  return out;
}

// Security events (Phase 10) this app decides itself: a sign-in refused by
// its own rate limit, a denial by its early role check, a download link
// that didn't verify, a file served for one. FastAPI records every other.
// reset_rate_limited: a forgot-password request refused by this site's
// per-address limit (Reset Email Activity, login protection 4.4).
export type SecurityAction = "login_rate_limited" | "access_denied" | "document_link_rejected" | "document_downloaded" | "reset_rate_limited";

export interface SecurityEvent {
  // Who, for the log line; FastAPI records the session's user.
  actorId: string | null;
  entityType: string;
  entityId: string;
  // Never credentials or file contents; FastAPI redacts regardless.
  detail?: Record<string, unknown>;
}

/**
 * Records a security event, with the browser's address and the path.
 * Never throws and never changes the outcome the caller already decided:
 * a denial stays a denial if it can't be recorded (that's logged).
 */
export async function recordSecurityEvent(action: SecurityAction, event: SecurityEvent): Promise<void> {
  try {
    const ctx = await currentRequest();
    const entityId = (event.entityId || ctx.path || "unknown").slice(0, 200);
    const result = await callBackend("/api/v1/audit-events", {
      method: "POST",
      body: { action, entity_type: event.entityType, entity_id: entityId, detail: { ...event.detail, ip: ctx.ip, path: ctx.path } },
      asUser: "if-signed-in",
    });
    if (!result.ok) log.error("audit.write_failed", { action, actor_id: event.actorId, status: result.status, code: result.error.code });
  } catch (err) {
    log.error("security.record_failed", { action, err });
  }
}

/** Fire-and-forget form for sync callers (guards that return a response immediately). */
export function recordSecurityEventLater(action: SecurityAction, event: SecurityEvent): void {
  recordSecurityEvent(action, event).catch(() => undefined);
}
