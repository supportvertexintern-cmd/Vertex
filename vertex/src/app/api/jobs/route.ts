import { NextRequest, NextResponse } from "next/server";
import type { Role } from "@prisma/client";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { callBackend, legacyErrorResponse } from "@/lib/backend";
import { getPublicJobsList } from "@/server/services/publicJobs";
export const dynamic = "force-dynamic";

// Job postings are Marketing's sole responsibility — a role deliberately
// kept outside the three-tier operational hierarchy (Regional Supervisory
// Operational Workflow). Admin keeps override access.
// Must match JOB_MANAGERS in vertex_be/app/api/v1/jobs.py (tests check it).
const JOB_MANAGER_ROLES = ["marketing", "admin"] as const;

// Same role set already authorized to submit a candidate on a partner's
// behalf (POST /api/partner/candidates) — a partner-only Job becomes
// visible in exactly the contexts a partner submission is already
// legitimately made in. regional_recruiter is deliberately excluded: the
// self-apply/recruiter-walk-in ApplicationForm never sends ?audience=
// partner at all, so this list only matters for callers that do.
const PARTNER_JOB_VISIBILITY_ROLES: Role[] = ["partner", "hr", "operations_team", "operations_director", "admin"];

// GET /api/jobs — public paginated listing. Also called directly
// (in-process, not over HTTP) by the homepage and /jobs listing Server
// Components — see server/services/publicJobs.ts for why. `status`/
// `sortBy` (2026-08-18) are only ever honored for an authenticated
// Marketing/Admin caller (their own /marketing/jobs management list,
// which previously reused this same endpoint but could never see a
// draft/closed posting — status was hardcoded to "active" unconditionally)
// — a public request never gets to see anything off the active list.
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const user = await getAuthUser(req);
  const isJobManager = user ? !requireRole(user, [...JOB_MANAGER_ROLES]) : false;
  const status = isJobManager ? (searchParams.get("status") as "draft" | "active" | "closed" | "all" | null) ?? undefined : undefined;
  const sortBy = isJobManager ? (searchParams.get("sortBy") as "created_at" | "title" | "applications" | null) ?? undefined : undefined;
  const sortDir = isJobManager && searchParams.get("sortDir") === "asc" ? "asc" : "desc";
  const wantsPartnerAudience = searchParams.get("audience") === "partner";
  // Marketing/Admin's own management list (isJobManager) always sees
  // partner-only jobs regardless of ?audience= — they're the ones who
  // create and maintain every Job, Credit Service or not, so hiding a
  // partner-only posting from their own list made it permanently
  // unreachable to edit/manage or add sectors & positions to (2026-09-07).
  // The audience=partner mechanism below is a separate, narrower gate for
  // the actual application-form/partner-portal contexts.
  const includePartnerOnly = isJobManager || (wantsPartnerAudience && !!user && PARTNER_JOB_VISIBILITY_ROLES.includes(user.role));

  const result = await getPublicJobsList({
    page: Number(searchParams.get("page") || 1),
    limit: Number(searchParams.get("limit") || 10),
    country: searchParams.get("country") || undefined,
    category: searchParams.get("category") || undefined,
    q: searchParams.get("q") || undefined,
    status,
    sortBy,
    sortDir,
    includePartnerOnly,
  });

  return NextResponse.json(result);
}

// POST /api/jobs — Marketing (admin retains override). FastAPI owns job
// writes since backend plan step 3.2 (vertex_be/app/api/v1/jobs.py): it
// validates the job and its payment stages, creates each stage's receipt
// document type and syncs Stripe pricing after it answers. This handler
// checks the role early, passes the request on and answers in this route's
// older shapes (the plain job; { error, details }), which the job forms read.
export async function POST(req: NextRequest) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, [...JOB_MANAGER_ROLES]);
  if (guardRes) return guardRes;

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const result = await callBackend("/api/v1/jobs", { method: "POST", body });
  return result.ok ? NextResponse.json(result.body.data, { status: 201 }) : legacyErrorResponse(result);
}
