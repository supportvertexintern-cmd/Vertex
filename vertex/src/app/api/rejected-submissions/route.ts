import { NextResponse } from "next/server";
import type { Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { HR_ROLES } from "@/lib/rbac";
import { scopeCasesToRequester } from "@/server/scope";

const REJECTED_SUBMISSION_ROLES: Role[] = [
  "regional_recruiter",
  "country_supervisor",
  "inhouse_supervisor",
  "director",
  "admin",
  "hr",
  "operations_team",
  "operations_director",
  "finance",
];

const PARTNER_SUBMISSION_ROLES: Role[] = [...HR_ROLES, "operations_team", "operations_director"];

function getRejectionDates(
  events: { entity_id: string; before: unknown; after: unknown; created_at: Date }[],
  field: "status" | "lifecycle_status"
) {
  const dates = new Map<string, Date>();
  for (const event of events) {
    const before = event.before && typeof event.before === "object" && !Array.isArray(event.before)
      ? event.before as Record<string, unknown>
      : {};
    const after = event.after && typeof event.after === "object" && !Array.isArray(event.after)
      ? event.after as Record<string, unknown>
      : {};
    if (after[field] === "rejected" && before[field] !== "rejected") dates.set(event.entity_id, event.created_at);
  }
  return dates;
}

export async function GET() {
  const user = await getAuthUser();
  const guardRes = requireRole(user, REJECTED_SUBMISSION_ROLES);
  if (guardRes) return guardRes;

  const canReadPartnerSubmissions = PARTNER_SUBMISSION_ROLES.includes(user!.role);
  const canReadSelfSubmissions = HR_ROLES.includes(user!.role);
  const caseScope = await scopeCasesToRequester(user!);

  const [cases, partnerSubmissions, selfSubmissions] = await Promise.all([
    prisma.case.findMany({
      where: { AND: [caseScope, { status: "rejected" }] },
      select: {
        id: true,
        status: true,
        current_stage: true,
        updated_at: true,
        rejected_at: true,
        rejection_reason: true,
        application: {
          select: {
            candidate: {
              select: {
                id: true,
                full_name: true,
                source: true,
                user: { select: { full_name: true, email: true } },
                partner: { select: { name: true } },
              },
            },
            job: { select: { title: true, country: true } },
            job_position: { select: { title: true } },
            preferred_country_1: { select: { name: true } },
            preferred_sector: { select: { name: true } },
          },
        },
      },
    }),
    canReadPartnerSubmissions
      ? prisma.partnerCandidate.findMany({
          where: { status: "rejected" },
          select: {
            id: true,
            full_name: true,
            status: true,
            updated_at: true,
            rejection_reason: true,
            partner: { select: { name: true } },
            job: { select: { title: true, country: true } },
          },
        })
      : Promise.resolve([]),
    canReadSelfSubmissions
      ? prisma.candidate.findMany({
          where: {
            lifecycle_status: "rejected",
            source: { in: ["self_registered", "referral_sourced"] },
          },
          select: {
            id: true,
            full_name: true,
            email: true,
            return_reason: true,
            lifecycle_status: true,
            updated_at: true,
            user: { select: { full_name: true, email: true } },
            applications: {
              orderBy: { submitted_at: "desc" },
              take: 1,
              select: {
                job: { select: { title: true, country: true } },
                job_position: { select: { title: true } },
                preferred_country_1: { select: { name: true } },
                preferred_sector: { select: { name: true } },
              },
            },
          },
        })
      : Promise.resolve([]),
  ]);

  const [partnerRejectionEvents, selfRejectionEvents] = await Promise.all([
    partnerSubmissions.length
      ? prisma.auditLog.findMany({
          where: {
            entity_type: "PartnerCandidate",
            entity_id: { in: partnerSubmissions.map((row: (typeof partnerSubmissions)[number]) => row.id) },
            action: "update",
          },
          select: { entity_id: true, before: true, after: true, created_at: true },
          orderBy: { created_at: "asc" },
        })
      : Promise.resolve([]),
    selfSubmissions.length
      ? prisma.auditLog.findMany({
          where: {
            entity_type: "Candidate",
            entity_id: { in: selfSubmissions.map((row: (typeof selfSubmissions)[number]) => row.id) },
            action: "update",
          },
          select: { entity_id: true, before: true, after: true, created_at: true },
          orderBy: { created_at: "asc" },
        })
      : Promise.resolve([]),
  ]);
  const partnerRejectionDates = getRejectionDates(partnerRejectionEvents, "status");
  const selfRejectionDates = getRejectionDates(selfRejectionEvents, "lifecycle_status");

  const candidatesWithRejectedCases = new Set(
    cases.map((record: (typeof cases)[number]) => record.application.candidate.id)
  );
  const data = [
    ...partnerSubmissions.map((record: (typeof partnerSubmissions)[number]) => ({
      id: record.id,
      type: "Partner submission" as const,
      name: record.full_name ?? "Unnamed candidate",
      partner: record.partner.name,
      opportunity: record.job ? `${record.job.title} (${record.job.country})` : null,
      rejected_at: partnerRejectionDates.get(record.id) ?? record.updated_at,
      reason: record.rejection_reason,
      status: record.status,
    })),
    ...selfSubmissions
      .filter((record: (typeof selfSubmissions)[number]) => !candidatesWithRejectedCases.has(record.id))
      .map((record: (typeof selfSubmissions)[number]) => {
        const application = record.applications[0];
        const opportunity = application?.job
          ? `${application.job.title} (${application.job.country})`
          : [application?.preferred_sector?.name, application?.preferred_country_1?.name].filter(Boolean).join(" / ") || null;
        return {
          id: record.id,
          type: "Self submission" as const,
          name: record.user?.full_name ?? record.full_name ?? "Unnamed candidate",
          partner: null,
          opportunity,
          rejected_at: selfRejectionDates.get(record.id) ?? record.updated_at,
          reason: record.return_reason,
          status: record.lifecycle_status,
        };
      }),
    ...cases.map((record: (typeof cases)[number]) => ({
      id: record.id,
      type: "Case" as const,
      name: record.application.candidate.user?.full_name ?? record.application.candidate.full_name ?? "Unnamed candidate",
      partner: record.application.candidate.partner?.name ?? null,
      opportunity: record.application.job
        ? `${record.application.job_position?.title ?? record.application.job.title} (${record.application.job.country})`
        : [record.application.preferred_sector?.name, record.application.preferred_country_1?.name].filter(Boolean).join(" / ") || null,
      rejected_at: record.rejected_at ?? record.updated_at,
      reason: record.rejection_reason,
      status: record.status,
    })),
  ].sort((a, b) => new Date(b.rejected_at).getTime() - new Date(a.rejected_at).getTime());

  return NextResponse.json({ data });
}