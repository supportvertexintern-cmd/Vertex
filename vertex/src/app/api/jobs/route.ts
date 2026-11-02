import { NextRequest, NextResponse } from "next/server";
import type { Role } from "@prisma/client";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { callBackend, legacyErrorResponse } from "@/lib/backend";
import { limitByIp } from "@/lib/rate-limit";
export const dynamic = "force-dynamic";

// Job postings are Marketing's sole responsibility — a role deliberately
// kept outside the three-tier operational hierarchy (Regional Supervisory
// Operational Workflow). Admin keeps override access.
// Must match JOB_MANAGERS in vertex_be/app/api/v1/jobs.py (tests check it).
const JOB_MANAGER_ROLES = ["marketing", "admin"] as const;

// Who sees a partner-only job when asking for the partner audience: the
// roles already allowed to submit a candidate for a partner. Must match
// PARTNER_JOB_VIEWERS in vertex_be/app/api/v1/jobs.py (tests check it).
const PARTNER_JOB_VISIBILITY_ROLES: Role[] = ["partner", "hr", "operations_team", "operations_director", "admin"];

// GET /api/jobs — the public paginated listing, read from FastAPI since
// reads handover R1 (server/services/publicJobs.ts). FastAPI decides from
// the session what the caller may see: drafts, other statuses and sorting
// only for Marketing/Admin's own list, partner-only jobs for them or with
// ?audience=partner for PARTNER_JOB_VISIBILITY_ROLES. Answers in this
// route's older shapes ({ jobs, total, page, pages }; { error }).
export async function GET(req: NextRequest) {
  const limited = await limitByIp(req, "job-list", { max: 120 });
  if (limited) return limited;
  const query = Object.fromEntries(
    ["page", "limit", "country", "category", "q", "status", "sortBy", "sortDir", "audience"].map((key) => [key, req.nextUrl.searchParams.get(key) || undefined])
  );
  const result = await callBackend("/api/v1/jobs", { query, asUser: "if-signed-in" });
  return result.ok ? NextResponse.json(result.body.data) : legacyErrorResponse(result);
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
