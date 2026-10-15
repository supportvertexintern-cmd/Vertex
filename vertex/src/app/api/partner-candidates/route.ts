import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { HR_ROLES } from "@/lib/rbac";
import { evaluateDocumentCompletenessForCandidateId } from "@/server/services/documentCompleteness";
import { getCandidateAttentionSignals } from "@/server/services/candidateSignals";

const MAX_PAGE_SIZE = 100;

// "Belgium — Warehouse Programme (Credit Service)" → "Warehouse Programme".
// Job has no separate programme field — the title is "<Country> — <Programme>
// (<variant>)" across every seeded opportunity, so the programme is derived
// from it for the Programme filter rather than adding a schema column.
function programmeFromJobTitle(title: string): string {
  const sep = title.indexOf(" — ");
  const rest = sep >= 0 ? title.slice(sep + 3) : title;
  return rest.replace(/\s*\([^)]*\)\s*$/, "").trim() || title;
}

async function candidateSignals(candidateId: string) {
  const { awaiting_reply, ...rest } = await getCandidateAttentionSignals(candidateId, "partner");
  return { ...rest, awaiting_hr_reply: awaiting_reply };
}

// GET /api/partner-candidates — HR's review queue for partner-submitted
// candidates (SRS FR-5.1, 2026-07-31 per the Operational Workflow SOP). A
// partner has already screened/verified these candidates themselves, so
// there's no recruiter/supervisor step here — this is the one place a real
// Case gets created for them (PATCH .../create-case). Operations also gets
// read visibility here (confirmed) so they can see what's coming before HR
// approves it — write actions (create-case, reject) stay HR-exclusive.
// Paginated/searchable/filterable by status, opportunity country, and
// programme — all applied in the DB query so totals/pagination stay exact.
export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, [...HR_ROLES, "operations_team", "operations_director"]);
  if (guardRes) return guardRes;

  const q = req.nextUrl.searchParams.get("q")?.trim();
  const status = req.nextUrl.searchParams.get("status")?.trim();
  const country = req.nextUrl.searchParams.get("country")?.trim();
  const programme = req.nextUrl.searchParams.get("programme")?.trim();
  const page = Math.max(1, Number(req.nextUrl.searchParams.get("page")) || 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(req.nextUrl.searchParams.get("pageSize")) || 15));

  // Sortable columns (CRM Comments item 8, 2026-08-10) — allow-listed
  // rather than passing the raw param straight into orderBy.
  const sortDir: "asc" | "desc" = req.nextUrl.searchParams.get("sortDir") === "asc" ? "asc" : "desc";
  const sortBy = req.nextUrl.searchParams.get("sortBy");
  const orderBy: Prisma.PartnerCandidateOrderByWithRelationInput =
    sortBy === "full_name"
      ? { full_name: sortDir }
      : sortBy === "partner"
      ? { partner: { name: sortDir } }
      : sortBy === "status"
      ? { status: sortDir }
      : sortBy === "submitted_at"
      ? { submitted_at: sortDir }
      : { updated_at: sortDir };

  // Country/Programme filter options come from the opportunities actually
  // attached to non-draft submissions (not the whole Job catalog), so
  // every option yields at least one row under the default status filter.
  const submittedJobs = await prisma.job.findMany({
    where: { partner_candidates: { some: { status: { not: "draft" } } } },
    select: { id: true, title: true, country: true },
  });
  const sortedUnique = (values: string[]) =>
    Array.from(new Set(values.filter(Boolean))).sort((a, b) => a.localeCompare(b));
  const filterOptions = {
    countries: sortedUnique(submittedJobs.map((j: (typeof submittedJobs)[number]) => j.country)),
    programmes: sortedUnique(submittedJobs.map((j: (typeof submittedJobs)[number]) => programmeFromJobTitle(j.title))),
  };
  // Resolved to exact job ids rather than a title substring match, so a
  // programme name that happens to be contained in another one (e.g.
  // "Unskilled Worker") can't pull in unrelated programmes.
  const programmeJobIds = programme
    ? submittedJobs
        .filter((j: (typeof submittedJobs)[number]) => programmeFromJobTitle(j.title) === programme)
        .map((j: (typeof submittedJobs)[number]) => j.id)
    : null;

  const where: Prisma.PartnerCandidateWhereInput = {
    // Drafts (unsubmitted, possibly half-empty) aren't part of this app's
    // review flow; ?status=draft can't bring them back.
    AND: [{ status: { not: "draft" } }],
    ...(status ? { status: status as never } : {}),
    ...(q
      ? {
          OR: [
            { full_name: { contains: q, mode: "insensitive" } },
            { email: { contains: q, mode: "insensitive" } },
            { partner: { name: { contains: q, mode: "insensitive" } } },
            // Programme name lives inside Job.title (see programmeFromJobTitle),
            // so a title match covers searching by programme.
            { job: { title: { contains: q, mode: "insensitive" } } },
          ],
        }
      : {}),
    // A draft is never reachable from HR/Operations' queue (2026-09-09) —
    // unconditional, not just the no-filter default, so an explicit
    // ?status=draft can't surface one either.
    AND: [
      { status: { not: "draft" } },
      ...(country ? [{ job: { country } }] : []),
      ...(programmeJobIds ? [{ job_id: { in: programmeJobIds } }] : []),
    ],
  };

  const [rows, total] = await Promise.all([
    prisma.partnerCandidate.findMany({
      where,
      include: {
        partner: { select: { id: true, name: true, contact_email: true } },
        job: { select: { title: true, country: true, city: true } },
      },
      // id tie-breaker: many rows share a submitted_at/updated_at (e.g.
      // seeded/bulk-entered batches), and without a unique final key
      // Postgres orders ties arbitrarily per query — rows repeat or vanish
      // across pages.
      orderBy: [orderBy, { id: sortDir }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.partnerCandidate.count({ where }),
  ]);

  // Bounded by page size (max 100), same reasoning as every other per-row
  // completeness check in this codebase (candidates/[id], the screening
  // gate) — not worth a bulk-batched variant at this scale. pending_documents/
  // message signals turn this list into HR's actual dashboard (2026-07-31):
  // "what's pending" (documents nobody has reviewed yet, whether first-time
  // or a resubmission after rejection — both reset to "pending" the same
  // way) and "is the ball in our court" (last message on the thread came
  // from the partner, not HR/Operations).
  const withSignals = await Promise.all(
    rows.map(async (row: (typeof rows)[number]) => {
      if (!row.bridged_candidate_id) {
        return { ...row, document_completeness: null, pending_documents_count: 0, message_count: 0, awaiting_hr_reply: false };
      }
      const [document_completeness, signals] = await Promise.all([
        evaluateDocumentCompletenessForCandidateId(row.bridged_candidate_id),
        candidateSignals(row.bridged_candidate_id),
      ]);
      return { ...row, document_completeness, ...signals };
    })
  );

  // Dashboard summary counts across every submission matching the current
  // filter, not just this page — a partner queue easily spans more than
  // one page of 15, and "how many need me right now" has to be a real
  // total, not a per-page approximation. Same "not worth a bulk-batched
  // variant at this scale" reasoning as above; a full re-scan per request
  // is fine for the realistic volume of partner submissions this business
  // has.
  const allMatching = await prisma.partnerCandidate.findMany({ where, select: { bridged_candidate_id: true } });
  const allSignals = await Promise.all(
    allMatching
      .filter((r: (typeof allMatching)[number]) => r.bridged_candidate_id)
      .map((r: (typeof allMatching)[number]) => candidateSignals(r.bridged_candidate_id!))
  );
  const summary = {
    pending_review_count: allSignals.filter((s) => s.pending_documents_count > 0).length,
    awaiting_reply_count: allSignals.filter((s) => s.awaiting_hr_reply).length,
  };

  return NextResponse.json({ data: withSignals, total, page, pageSize, summary, filter_options: filterOptions });
}
