import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { log } from "./log";
import { redact, REDACTED } from "./redact";
import { currentRequest } from "./request-context";
import { onAuditWriteFailed, onPrivilegeGranted, onSecurityEvent } from "./security-monitor";

/**
 * Audit-logging Prisma extension (SRS NFR-6). Wraps create/update/delete for
 * the audited models so a write can't silently skip logging — callers just
 * use auditedPrisma(actorId) instead of the raw prisma import for these
 * models, rather than remembering to make a separate logging call.
 */
const AUDITED_MODELS = new Set([
  "Candidate",
  "Application",
  "Document",
  "User",
  "Report",
  "Campaign",
  "Case",
  "CaseStageEvent",
  "Contract",
  "CasePayment",
  "FeePolicy",
  "RetentionFollowUp",
  "Partner",
  "EmployerClient",
  "PartnerCandidate",
  "DocumentRequirementType",
  "RecruiterTarget",
  "RecruiterNote",
  "CandidateMessage",
  "InhouseCountryAssignment",
  "StaffKpiTarget",
  "ReferralAgent",
  "ReferralCommission",
  "ReferralCommissionRule",
  "ReferralAgentTarget",
  // Written by FastAPI since backend plan steps 2.1-5.1, which audits them.
  "Region",
  "Country",
  "Sector",
  "CountryDocumentRequirement",
  "SystemSetting",
  "KnowledgeArticle",
  "EmailTemplate",
  "Job",
  "JobPaymentStage",
  "JobSector",
  "JobPosition",
  "CampaignTarget",
]);
const AUDITED_OPERATIONS = new Set(["create", "update", "delete"]);

// Fields that must never be duplicated into AuditLog.before/after, even
// though the model itself is audited — bcrypt is one-way, but there's no
// reason to needlessly widen where a credential hash can be read from
// (a compromised AuditLog table shouldn't also mean compromised
// password hashes). The audit trail doesn't need the old/new hash to be
// useful — "password was changed" is captured by the row existing at
// all, not by the hash value itself.
const REDACTED_FIELDS: Record<string, string[]> = {
  User: ["password_hash"],
};

// Phase 10: beyond the named fields, every snapshot and detail goes
// through redact() (lib/redact.ts), so no password, token, secret or
// connection string reaches the trail whatever the model or caller.
export function redactSnapshot(model: string, snapshot: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!snapshot) return snapshot;
  const copy = redact(snapshot) as Record<string, unknown>;
  for (const field of REDACTED_FIELDS[model] ?? []) {
    if (field in copy) copy[field] = REDACTED;
  }
  return copy;
}

function modelDelegateName(model: string): string {
  return model.charAt(0).toLowerCase() + model.slice(1);
}

export function auditedPrisma(actorId: string | null) {
  return prisma.$extends({
    name: "audit-log",
    query: {
      $allModels: {
        async $allOperations({
          model,
          operation,
          args,
          query,
        }: {
          model: string;
          operation: string;
          args: unknown;
          query: (args: unknown) => Promise<unknown>;
        }) {
          if (!AUDITED_MODELS.has(model) || !AUDITED_OPERATIONS.has(operation)) {
            return query(args);
          }

          let before: unknown = null;
          const whereArg = (args as { where?: unknown }).where;
          if ((operation === "update" || operation === "delete") && whereArg) {
            before = await (prisma as unknown as Record<string, { findUnique: (a: unknown) => Promise<unknown> }>)[
              modelDelegateName(model)
            ]
              .findUnique({ where: whereArg })
              .catch(() => null);
          }

          const result = await query(args);

          const entityId =
            (result as { id?: string } | null)?.id ?? (before as { id?: string } | null)?.id ?? "unknown";
          const { requestId } = await currentRequest();

          try {
            await prisma.auditLog.create({
              data: {
                entity_type: model,
                entity_id: entityId,
                action: operation,
                actor_id: actorId,
                request_id: requestId,
                // JSON round-tripped above, so these are valid JSON values.
                before: before ? ((redactSnapshot(model, JSON.parse(JSON.stringify(before))) ?? undefined) as Prisma.InputJsonValue | undefined) : undefined,
                after: operation !== "delete" ? ((redactSnapshot(model, JSON.parse(JSON.stringify(result))) ?? undefined) as Prisma.InputJsonValue | undefined) : undefined,
              },
            });
          } catch (err) {
            // The change is made but unrecorded: say so loudly, then fail
            // the request rather than report success.
            log.error("audit.write_failed", { model, operation, entity_id: entityId, actor_id: actorId, request_id: requestId, err });
            onAuditWriteFailed(`${model}.${operation}`, err);
            throw err;
          }

          if (model === "User" && operation !== "delete") {
            const was = (before as { role?: string } | null)?.role ?? null;
            const now = (result as { role?: string } | null)?.role ?? null;
            if (now === "admin" && was !== "admin") onPrivilegeGranted(actorId, entityId, was, now);
          }

          return result;
        },
      },
    },
  });
}

/**
 * Records a sensitive *read* such as a bulk export (zero-trust policy §9):
 * the write extension above only sees changes. Stores who, what and how
 * much, never the data itself. Awaited before the response is sent, so if
 * the audit write fails the export fails too (fail closed).
 */
export async function auditAccess(
  actorId: string,
  entityType: string,
  action: "export",
  detail: Record<string, unknown>,
): Promise<void> {
  const { requestId } = await currentRequest();
  await prisma.auditLog.create({
    data: { entity_type: entityType, entity_id: "bulk", action, actor_id: actorId, request_id: requestId, after: redact(detail) as object },
  });
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

// Security events (Phase 10): decisions and sign-in activity that aren't
// data changes. Recorded in the audit trail, logged, and passed to the
// security monitor (lib/security-monitor.ts), which raises alerts.
export type SecurityAction =
  | "login_succeeded"
  | "login_failed"
  | "login_rate_limited"
  | "logout"
  | "access_denied"
  | "password_reset_requested"
  | "password_reset_completed"
  | "malware_rejected"
  | "malware_blocked_download"
  // Sensitive reads (G21): who opened which candidate document, and when.
  | "document_link_issued"
  | "document_downloaded"
  | "document_link_rejected"
  // Sessions (G19): ended by the user, an admin or the kill switch, and a
  // spent refresh token presented again (likely theft; raises an alert).
  | "sessions_revoked"
  | "refresh_token_reused";

// Routine, expected events log at info; everything else at warn.
const INFO_ACTIONS = new Set<SecurityAction>(["login_succeeded", "logout", "document_link_issued", "document_downloaded", "sessions_revoked"]);

export interface SecurityEvent {
  actorId: string | null;
  entityType: string;
  entityId: string;
  // Never credentials or file contents; redact() is applied regardless.
  detail?: Record<string, unknown>;
}

// For correlating failed sign-ins on one address without storing whatever
// was typed into the email field (which is sometimes a password).
export function emailFingerprint(email: string): string {
  return createHash("sha256").update(email.trim().toLowerCase()).digest("hex").slice(0, 16);
}

/**
 * Records a security event. Never throws and never changes the outcome
 * the caller already decided: a denial stays a denial if the audit write
 * fails (that failure is logged and alerted instead).
 */
export async function recordSecurityEvent(action: SecurityAction, event: SecurityEvent): Promise<void> {
  try {
    const ctx = await currentRequest();
    const entityId = (event.entityId || ctx.path || "unknown").slice(0, 200);
    const detail = redact({ ...event.detail, ip: ctx.ip, path: ctx.path }) as Record<string, unknown>;
    log[INFO_ACTIONS.has(action) ? "info" : "warn"](`security.${action}`, {
      actor_id: event.actorId,
      entity_type: event.entityType,
      entity_id: entityId,
      request_id: ctx.requestId,
      ...detail,
    });
    try {
      await prisma.auditLog.create({
        data: {
          entity_type: event.entityType,
          entity_id: entityId,
          action,
          actor_id: event.actorId,
          request_id: ctx.requestId,
          after: detail as object,
        },
      });
    } catch (err) {
      log.error("audit.write_failed", { action, request_id: ctx.requestId, err });
      onAuditWriteFailed(action, err);
      return;
    }
    await onSecurityEvent(action, event.actorId, entityId, detail);
  } catch (err) {
    log.error("security.record_failed", { action, err });
  }
}

/** Fire-and-forget form for sync callers (guards that return a response immediately). */
export function recordSecurityEventLater(action: SecurityAction, event: SecurityEvent): void {
  recordSecurityEvent(action, event).catch(() => undefined);
}

// Kept for the Phase 9 call sites.
export async function auditSecurityEvent(
  actorId: string | null,
  entityType: string,
  entityId: string,
  action: "malware_rejected" | "malware_blocked_download",
  detail: Record<string, unknown>,
): Promise<void> {
  await recordSecurityEvent(action, { actorId, entityType, entityId, detail });
}
