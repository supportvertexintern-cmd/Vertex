import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { canAccessCase } from "@/server/scope";

const CASE_ACCESS_ROLES = [
  "candidate",
  "regional_recruiter",
  "country_supervisor",
  "inhouse_supervisor",
  "director",
  "admin",
  "partner",
  "hr",
  "operations_team",
  "operations_director",
  "finance",
] as const;

// Human-readable summary per entity_type/action pair — the audit trail
// has been fully populated since Phase 1's auditedPrisma() but never
// surfaced anywhere (2026-07-31): this is the first viewer for it.
const ENTITY_ACTION_LABELS: Record<string, string> = {
  "Case:create": "Case opened",
  "Case:update": "Case updated",
  "CaseStageEvent:create": "Stage advanced",
  "CaseStageEvent:update": "Stage event updated",
  "Contract:create": "Contract issued",
  "Contract:update": "Contract updated",
  "CasePayment:create": "Payment recorded",
  "CasePayment:update": "Payment updated",
  "RetentionFollowUp:create": "Retention follow-up started",
  "RetentionFollowUp:update": "Retention follow-up updated",
};

// GET /api/cases/:id/audit-log — the "clear log of actions" requirement
// (2026-07-31, per the Operational Workflow SOP) is really a viewer for
// data auditedPrisma() has already been recording since Phase 1. Same
// read access as the case detail route itself — anyone who can read the
// case can read its trail.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, [...CASE_ACCESS_ROLES]);
  if (guardRes) return guardRes;

  const { id } = await params;

  const caseRecord = await prisma.case.findUnique({
    where: { id },
    include: {
      application: { include: { candidate: true } },
      stage_events: { select: { id: true } },
      contract: { select: { id: true } },
      payments: { select: { id: true } },
      retention_follow_up: { select: { id: true } },
      reminders: {
        select: { id: true, channel: true, recipient: true, message: true, sent_at: true, sender: { select: { full_name: true, role: true } } },
      },
    },
  });
  if (!caseRecord) return NextResponse.json({ error: { code: "not_found", message: "Case not found." } }, { status: 404 });

  const allowed = await canAccessCase(user!, {
    user_id: caseRecord.application.candidate.user_id,
    recruiter_id: caseRecord.application.candidate.recruiter_id,
    country_id: caseRecord.application.candidate.country_id,
    partner_id: caseRecord.application.candidate.partner_id,
  });
  if (!allowed) return NextResponse.json({ error: { code: "forbidden", message: "Forbidden." } }, { status: 403 });

  const entityFilters: { entity_type: string; entity_id: string }[] = [
    { entity_type: "Case", entity_id: caseRecord.id },
    ...caseRecord.stage_events.map((e: (typeof caseRecord.stage_events)[number]) => ({ entity_type: "CaseStageEvent", entity_id: e.id })),
    ...(caseRecord.contract ? [{ entity_type: "Contract", entity_id: caseRecord.contract.id }] : []),
    ...caseRecord.payments.map((p: (typeof caseRecord.payments)[number]) => ({ entity_type: "CasePayment", entity_id: p.id })),
    ...(caseRecord.retention_follow_up ? [{ entity_type: "RetentionFollowUp", entity_id: caseRecord.retention_follow_up.id }] : []),
  ];

  const auditEntries = await prisma.auditLog.findMany({
    where: { OR: entityFilters },
    orderBy: { created_at: "asc" },
  });

  const actorIds = [
    ...new Set(auditEntries.map((a: (typeof auditEntries)[number]) => a.actor_id).filter((v: string | null): v is string => !!v)),
  ];
  const actors = actorIds.length
    ? await prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, full_name: true, role: true } })
    : [];
  const actorById = new Map<string, (typeof actors)[number]>(actors.map((a: (typeof actors)[number]) => [a.id, a]));

  const entries = [
    ...auditEntries.map((a: (typeof auditEntries)[number]) => {
      const actor = a.actor_id ? actorById.get(a.actor_id) : undefined;
      return {
        id: a.id,
        kind: "audit" as const,
        summary: ENTITY_ACTION_LABELS[`${a.entity_type}:${a.action}`] ?? `${a.entity_type} ${a.action}`,
        actorName: actor?.full_name ?? "System",
        actorRole: actor?.role ?? null,
        timestamp: a.created_at,
      };
    }),
    ...caseRecord.reminders.map((r: (typeof caseRecord.reminders)[number]) => ({
      id: r.id,
      kind: "reminder" as const,
      summary: `Reminder sent (${r.channel}) to ${r.recipient}${r.message ? `: "${r.message}"` : ""}`,
      actorName: r.sender.full_name,
      actorRole: r.sender.role,
      timestamp: r.sent_at,
    })),
  ].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  return NextResponse.json({ data: entries });
}
