import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { scopeCandidatesToRequester } from "@/server/scope";
import { getCandidateAttentionSignals } from "@/server/services/candidateSignals";

const STAFF_ROLES = ["regional_recruiter", "country_supervisor", "inhouse_supervisor", "director", "admin", "hr"] as const;
const MAX_PAGE_SIZE = 100;

const CANDIDATE_SELECT = {
  id: true,
  source: true,
  lifecycle_status: true,
  nationality: true,
  date_of_birth: true,
  passport_number: true,
  full_name: true,
  phone: true,
  email: true,
  desired_role: true,
  consent_given: true,
  return_reason: true,
  screening_result: true,
  created_at: true,
  second_nationality: true,
  gender: true,
  passport_expiry: true,
  current_occupation: true,
  highest_education: true,
  home_address: true,
  whatsapp_number: true,
  marital_status: true,
  user: { select: { full_name: true, email: true } },
  recruiter: { select: { id: true, full_name: true } },
  country: { select: { id: true, name: true, region: { select: { id: true, name: true } } } },
  country_name: true,
  partner: { select: { id: true, name: true } },
  referral_agent: { select: { id: true, full_name: true, referral_code: true } },
  referral_duplicate_flag: true,
  documents: { select: { id: true, type: true, verification_status: true } },
  // Programme + Preferred Country columns (2026-07-27, replaces the old
  // free-text "Role"/desired_role column) — a candidate has at most one
  // active application at a time, so "the most recent" is unambiguous.
  applications: {
    orderBy: { submitted_at: "desc" },
    take: 1,
    select: {
      job: { select: { title: true } },
      preferred_sector: { select: { name: true } },
      preferred_country_1: { select: { name: true } },
    },
  },
} satisfies Prisma.CandidateSelect;

// GET /api/candidates — role-scoped candidate list (SRS FR-1.2, FR-2.3).
// A regional_recruiter sees only candidates they sourced; a
// country_supervisor sees their assigned country; in-house/director/admin
// see everything. Powers the /recruiter, /supervisor, and /management
// portal landing pages.
//
// Two distinct callers, two distinct shapes:
//  - The recruiter reporting flow auto-populates a report's candidate list
//    from period_start/period_end (both required together) — that window
//    is naturally small (a single day/week for one recruiter), so it gets
//    the full matching set, unpaginated, same as before.
//  - Everything else (the staff candidate list UI) is real server-side
//    search + pagination now: at 40-country/800-recruiter scale, a
//    country's candidate list runs into the thousands, and both "return
//    every row unbounded" and the previous hard take:100-with-no-offset
//    cap made anything past the newest ~100 permanently unreachable and
//    unsearchable.
export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, [...STAFF_ROLES]);
  if (guardRes) return guardRes;

  const scope = await scopeCandidatesToRequester(user!);
  const periodStart = req.nextUrl.searchParams.get("period_start");
  const periodEnd = req.nextUrl.searchParams.get("period_end");

  if (periodStart && periodEnd) {
    const candidates = await prisma.candidate.findMany({
      where: { ...scope, created_at: { gte: new Date(periodStart), lte: new Date(periodEnd) } },
      select: CANDIDATE_SELECT,
      orderBy: { created_at: "desc" },
    });
    return NextResponse.json({ data: candidates });
  }

  const q = req.nextUrl.searchParams.get("q")?.trim();
  const status = req.nextUrl.searchParams.get("status")?.trim();
  // HR's own "Self Applications" queue filters to source=self_registered
  // (2026-07-31) — the only staff role that needs this, since every other
  // consumer of this list is already scoped by scopeCandidatesToRequester
  // to just its own recruiter/country/territory.
  const source = req.nextUrl.searchParams.get("source")?.trim();
  // Country filter (Portal Improvement Requirements item 3, 2026-08-18) —
  // the list already shows a Country column, this just makes it filterable.
  const countryId = req.nextUrl.searchParams.get("country_id")?.trim();
  const page = Math.max(1, Number(req.nextUrl.searchParams.get("page")) || 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(req.nextUrl.searchParams.get("pageSize")) || 15));

  // Sortable columns (CRM Comments item 8, 2026-08-10) — optional, allow-
  // listed; defaults to the existing created_at-desc behavior every other
  // consumer of this shared endpoint (recruiter/supervisor/inhouse/
  // management lists) already relies on.
  const sortDir: "asc" | "desc" = req.nextUrl.searchParams.get("sortDir") === "asc" ? "asc" : "desc";
  const sortBy = req.nextUrl.searchParams.get("sortBy");
  const orderBy: Prisma.CandidateOrderByWithRelationInput =
    sortBy === "full_name" ? { full_name: sortDir } : sortBy === "lifecycle_status" ? { lifecycle_status: sortDir } : { created_at: sortDir };

  const where: Prisma.CandidateWhereInput = {
    ...scope,
    ...(status ? { lifecycle_status: status as never } : {}),
    // Comma-separated (2026-08-29) — HR's Self Applications queue now
    // widens this to "self_registered,referral_sourced" so a referral-
    // sourced candidate lands in the same HR review queue, per the
    // Referral Agent System's "no new parallel pipeline" decision.
    ...(source ? { source: { in: source.split(",") } as never } : {}),
    ...(countryId ? { country_id: countryId } : {}),
    ...(q
      ? {
          OR: [
            { full_name: { contains: q, mode: "insensitive" } },
            { email: { contains: q, mode: "insensitive" } },
            { phone: { contains: q, mode: "insensitive" } },
            { user: { full_name: { contains: q, mode: "insensitive" } } },
            { user: { email: { contains: q, mode: "insensitive" } } },
          ],
        }
      : {}),
  };

  const [candidates, total] = await Promise.all([
    prisma.candidate.findMany({
      where,
      select: CANDIDATE_SELECT,
      orderBy,
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.candidate.count({ where }),
  ]);

  // Opt-in ("signals=true") message/document attention signals, same
  // shape as the Partner Submissions queue's dashboard — added for HR's
  // Self Applications queue specifically (2026-07-31): before this, HR
  // had no way to tell that a self-submitted candidate had come back
  // from screening (created an account, uploaded documents, auto-advanced
  // to "submitted") without manually reopening every candidate to check.
  // Not computed by default — every other consumer of this endpoint
  // (recruiter/supervisor/inhouse/management lists) has no use for it and
  // shouldn't pay for the extra per-row queries.
  if (req.nextUrl.searchParams.get("signals") === "true") {
    const withSignals = await Promise.all(
      candidates.map(async (c: (typeof candidates)[number]) => {
        const { awaiting_reply, ...rest } = await getCandidateAttentionSignals(c.id, "candidate");
        return { ...c, ...rest, awaiting_hr_reply: awaiting_reply };
      })
    );

    // Dashboard summary across every candidate matching the current
    // filter, not just this page — "how many need me right now" has to
    // be a real total. Bounded the same way the Partner Submissions
    // summary is (a full re-scan is fine at this scale); "ready for
    // review" is the candidate's own lifecycle_status, so it's a cheap
    // count with no per-row queries at all.
    const [readyForApprovalCount, allMatching] = await Promise.all([
      prisma.candidate.count({ where: { ...where, lifecycle_status: "submitted" } }),
      prisma.candidate.findMany({ where, select: { id: true } }),
    ]);
    const allSignals = await Promise.all(
      allMatching.map((c: (typeof allMatching)[number]) => getCandidateAttentionSignals(c.id, "candidate"))
    );
    const summary = {
      ready_for_approval_count: readyForApprovalCount,
      awaiting_reply_count: allSignals.filter((s) => s.awaiting_reply).length,
    };

    return NextResponse.json({ data: withSignals, total, page, pageSize, summary });
  }

  return NextResponse.json({ data: candidates, total, page, pageSize });
}

// POST /api/candidates has been retired — a candidate (recruiter-sourced
// or self-service) is now created by submitting the Candidate Information
// Form itself (POST /api/applications), which is the first thing anyone
// fills in. See docs/PLATFORM_ARCHITECTURE.md.
