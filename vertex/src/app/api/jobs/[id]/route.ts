import { NextRequest, NextResponse } from "next/server";
import type { Role } from "@prisma/client";
import { limitByIp } from "@/lib/rate-limit";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { callBackend, legacyErrorResponse } from "@/lib/backend";
import { getPublicJobById } from "@/server/services/publicJobs";
export const dynamic = "force-dynamic";

// Must match JOB_MANAGERS in vertex_be/app/api/v1/jobs.py (tests check it).
const JOB_MANAGER_ROLES = ["marketing", "admin"] as const;

// Same role set as src/app/api/jobs/route.ts's PARTNER_JOB_VISIBILITY_ROLES
// — see that file for the full rationale.
const PARTNER_JOB_VISIBILITY_ROLES: Role[] = ["partner", "hr", "operations_team", "operations_director", "admin"];

// GET /api/jobs/[id] — public. Also called directly (in-process, not over
// HTTP) by /jobs/[id]'s Server Component — see server/services/publicJobs.ts.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const limited = limitByIp(req, "job-detail", { max: 120 });
  if (limited) return limited;
  const { id } = await params;
  const { searchParams } = req.nextUrl;
  const wantsPartnerAudience = searchParams.get("audience") === "partner";
  const user = await getAuthUser(req);
  const isJobManager = user ? !requireRole(user, [...JOB_MANAGER_ROLES]) : false;
  // Marketing/Admin's own edit page (isJobManager) always sees a
  // partner-only job's detail regardless of ?audience= — same fix as
  // GET /api/jobs's list endpoint (2026-09-07): without this, opening a
  // Credit Service job's edit page 404'd ("Failed to load job details"),
  // since the edit page never sends audience=partner and "marketing"
  // was never in PARTNER_JOB_VISIBILITY_ROLES to begin with.
  const includePartnerOnly = isJobManager || (wantsPartnerAudience && !!user && PARTNER_JOB_VISIBILITY_ROLES.includes(user.role));

  const job = await getPublicJobById(id, includePartnerOnly);
  if (!job) return NextResponse.json({ error: "Job not found." }, { status: 404 });
  return NextResponse.json(job);
}

// FastAPI owns job writes since backend plan step 3.2
// (vertex_be/app/api/v1/jobs.py). These handlers check the role early,
// pass the request on and answer in this route's older shapes (the plain
// job; { error, details }; { message }), which the job pages read. FastAPI
// keeps the edit rules that lived here: only fields sent are changed, an
// unchanged field isn't held to a length minimum it predates, a stage plan
// may total at most 100%, an empty plan only with the fee removed. It
// updates stages in place (keeping their Stripe prices and receipt types)
// and re-syncs Stripe pricing when a fee-relevant field changes.

// PUT /api/jobs/[id] — Marketing (admin retains override)
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, [...JOB_MANAGER_ROLES]);
  if (guardRes) return guardRes;

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const result = await callBackend(`/api/v1/jobs/${encodeURIComponent(id)}`, { method: "PUT", body });
  return result.ok ? NextResponse.json(result.body.data) : legacyErrorResponse(result);
}

// DELETE /api/jobs/[id] — Marketing (admin retains override)
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, [...JOB_MANAGER_ROLES]);
  if (guardRes) return guardRes;

  const result = await callBackend(`/api/v1/jobs/${encodeURIComponent(id)}`, { method: "DELETE" });
  return result.ok ? NextResponse.json({ message: "Job deleted." }) : legacyErrorResponse(result);
}
