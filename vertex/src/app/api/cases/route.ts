import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { scopeCasesToRequester } from "@/server/scope";
import type { CaseStage } from "@prisma/client";

const CASE_ACCESS_ROLES = ["candidate", "regional_recruiter", "country_supervisor", "inhouse_supervisor", "director", "admin", "partner", "hr", "operations_team", "operations_director", "finance"] as const;
const MAX_PAGE_SIZE = 200;

// GET /api/cases — the mobility-lifecycle case list (SRS FR-4.1/4.2),
// scoped exactly like the candidate list (recruiter sees their own
// candidates' cases, supervisor their country's, management/admin all, a
// candidate sees only their own). Paginated, defaulting to page 1 / 50
// rows even without params, since a candidate's own case count stays
// tiny but a supervisor/management view scales with country/platform
// volume the same way the candidate and application lists do.
export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, [...CASE_ACCESS_ROLES]);
  if (guardRes) return guardRes;

  const scope = await scopeCasesToRequester(user!);
  const stageParam = req.nextUrl.searchParams.get("stage") as CaseStage | null;
  const countryId = req.nextUrl.searchParams.get("country_id");
  const candidateId = req.nextUrl.searchParams.get("candidate_id");
  const q = req.nextUrl.searchParams.get("q");
  // Partner + Application type filters (2026-08-18) — the case-management
  // dashboards' own "Partner" column needed a way to actually filter by
  // it, not just display it; source is the same field that already backs
  // "Self-submitted"/partner/recruiter labeling elsewhere.
  const partnerId = req.nextUrl.searchParams.get("partner_id");
  const source = req.nextUrl.searchParams.get("source");

  // Rejected cases (2026-08-16) drop out of the default view — staff
  // shouldn't have to scroll past closed cases on their day-to-day list.
  // ?status=all or ?status=rejected opts back in (used by the partner's
  // own case list, which does need to show a rejection happened).
  const statusParam = req.nextUrl.searchParams.get("status");
  const statusFilter = statusParam === "all" ? {} : statusParam === "rejected" ? { status: "rejected" as const } : { status: "active" as const };
  const page = Math.max(1, Number(req.nextUrl.searchParams.get("page")) || 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(req.nextUrl.searchParams.get("pageSize")) || 50));

  // Sortable columns (CRM Comments item 8, 2026-08-10) — optional,
  // defaults to the existing updated_at-desc behavior.
  const sortDir: "asc" | "desc" = req.nextUrl.searchParams.get("sortDir") === "asc" ? "asc" : "desc";
  const sortBy = req.nextUrl.searchParams.get("sortBy");
  const orderBy =
    sortBy === "created_at" ? { created_at: sortDir } : sortBy === "current_stage" ? { current_stage: sortDir } : { updated_at: sortDir as "asc" | "desc" };

  const where = {
    AND: [
      scope,
      statusFilter,
      stageParam ? { current_stage: stageParam } : {},
      countryId ? { application: { candidate: { country_id: countryId } } } : {},
      candidateId ? { application: { candidate_id: candidateId } } : {},
      partnerId ? { application: { candidate: { partner_id: partnerId } } } : {},
      source ? { application: { candidate: { source: source as never } } } : {},
      q
        ? {
            application: {
              candidate: {
                OR: [
                  { full_name: { contains: q, mode: "insensitive" as const } },
                  { user: { full_name: { contains: q, mode: "insensitive" as const } } },
                  { user: { email: { contains: q, mode: "insensitive" as const } } },
                  { partner: { name: { contains: q, mode: "insensitive" as const } } },
                ],
              },
            },
          }
        : {},
    ],
  };

  const [cases, total] = await Promise.all([
    prisma.case.findMany({
      where,
      include: {
        application: {
          include: {
            candidate: {
              include: {
                user: { select: { full_name: true, email: true } },
                country: true,
                recruiter: { select: { full_name: true } },
                partner: { select: { name: true } },
              },
            },
            job: { select: { title: true, country: true, city: true } },
            preferred_country_1: { select: { name: true } },
            preferred_sector: { select: { name: true } },
          },
        },
        contract: { select: { status: true } },
        retention_follow_up: { select: { due_at: true, completed_at: true } },
        // CRM Comments item 9/13 (2026-08-10) — Finance's Created Cases
        // list derives a Status column from these, no schema change needed.
        payments: { select: { type: true, status: true, sent_to_email: true } },
      },
      orderBy,
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.case.count({ where }),
  ]);

  return NextResponse.json({ data: cases, total, page, pageSize });
}
