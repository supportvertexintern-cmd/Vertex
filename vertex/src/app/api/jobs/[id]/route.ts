import { NextRequest, NextResponse } from "next/server";
import { limitByIp } from "@/lib/rate-limit";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { callBackend, legacyErrorResponse } from "@/lib/backend";
export const dynamic = "force-dynamic";

// Must match JOB_MANAGERS in vertex_be/app/api/v1/jobs.py (tests check it).
const JOB_MANAGER_ROLES = ["marketing", "admin"] as const;

// GET /api/jobs/[id] — public, read from FastAPI since reads handover R1.
// Active or closed jobs, never drafts; partner-only ones as for the listing
// (GET /api/jobs). Answers with the plain job, or { error } and 404.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const limited = await limitByIp(req, "job-detail", { max: 120 });
  if (limited) return limited;
  const { id } = await params;
  const result = await callBackend(`/api/v1/jobs/${encodeURIComponent(id)}`, {
    query: { audience: req.nextUrl.searchParams.get("audience") || undefined },
    asUser: "if-signed-in",
  });
  return result.ok ? NextResponse.json(result.body.data) : legacyErrorResponse(result);
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
