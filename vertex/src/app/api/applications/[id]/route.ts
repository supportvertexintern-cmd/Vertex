import { NextRequest, NextResponse } from "next/server";
import { passOn, readJson, seg } from "@/lib/pipeline";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { callBackend, legacyErrorResponse } from "@/lib/backend";

// "Approved by In-House" is the framework's controlling position for this
// decision (Regional Supervisory Operational Workflow p.5) — admin
// retains override access, not primary ownership.
const APPLICATION_REVIEWER_ROLES = ["inhouse_supervisor", "director", "admin"] as const;

// GET /api/applications/[id] — the application with its candidate and job,
// for the candidate it belongs to, director, admin, or an In-House
// Supervisor whose countries include the candidate's (policy Q3, owner's
// decision 2026-11-02). The plain application, or { error }.
// Read from FastAPI since reads handover R4
// (vertex_be/app/api/v1/pipeline_reads.py).
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getAuthUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const result = await callBackend(`/api/v1/applications/${seg(id)}`);
  return result.ok ? NextResponse.json(result.body.data) : legacyErrorResponse(result);
}

// PUT /api/applications/[id] — In-House, the director or admin changing the
// legacy hiring status or the internal notes (edited from a case). Written
// by FastAPI since the pipeline switch (step 6.7;
// vertex_be/app/api/v1/applications.py, review), which lists the
// candidate's email for a status change; answered in this route's older
// shape.
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, [...APPLICATION_REVIEWER_ROLES]);
  if (guardRes) return guardRes;
  const read = await readJson(req, true);
  if (read.invalid) return read.invalid;
  return passOn(`/api/v1/applications/${seg(id)}`, { method: "PUT", body: read.body }, { unwrap: true, legacyErrors: true });
}
