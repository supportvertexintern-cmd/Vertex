import { prisma } from "./prisma";

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

function redactSnapshot(model: string, snapshot: Record<string, unknown> | null): Record<string, unknown> | null {
  const fields = REDACTED_FIELDS[model];
  if (!snapshot || !fields) return snapshot;
  const copy = { ...snapshot };
  for (const field of fields) {
    if (field in copy) copy[field] = "[redacted]";
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

          await prisma.auditLog.create({
            data: {
              entity_type: model,
              entity_id: entityId,
              action: operation,
              actor_id: actorId,
              before: before ? redactSnapshot(model, JSON.parse(JSON.stringify(before))) : undefined,
              after: operation !== "delete" ? redactSnapshot(model, JSON.parse(JSON.stringify(result))) : undefined,
            },
          });

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
  await prisma.auditLog.create({
    data: { entity_type: entityType, entity_id: "bulk", action, actor_id: actorId, after: detail as object },
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
    out[key] = AUDITABLE_FILTER_KEYS.has(key) ? value.slice(0, 100) : "[redacted]";
  });
  return out;
}

// Security decisions that aren't data changes (e.g. a file the malware
// scanner refused). Never put file contents or credentials in `detail`.
export async function auditSecurityEvent(
  actorId: string | null,
  entityType: string,
  entityId: string,
  action: "malware_rejected" | "malware_blocked_download",
  detail: Record<string, unknown>,
): Promise<void> {
  await prisma.auditLog.create({
    data: { entity_type: entityType, entity_id: entityId, action, actor_id: actorId, after: detail as object },
  });
}
