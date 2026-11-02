import { NextRequest, NextResponse } from "next/server";
import { passOn, readJson, seg } from "@/lib/pipeline";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { callBackend, legacyErrorResponse } from "@/lib/backend";
import { OPERATIONS_ROLES } from "@/lib/rbac";

// GET /api/cases/:id/contract — the case's contract, for anyone who may
// see the case; { data }, or { error }. Read from FastAPI since reads
// handover R5 (vertex_be/app/api/v1/case_reads.py).
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getAuthUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const result = await callBackend(`/api/v1/cases/${seg(id)}/contract`);
  return result.ok ? NextResponse.json(result.body) : legacyErrorResponse(result);
}

// POST /api/cases/:id/contract — Operations issue the contract (SRS FR-4.3),
// sent for the candidate to sign. Written by FastAPI since the pipeline
// switch (step 6.7; vertex_be/app/api/v1/cases.py, issue_contract).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, OPERATIONS_ROLES);
  if (guardRes) return guardRes;
  const read = await readJson(req, true);
  if (read.invalid) return read.invalid;
  return passOn(`/api/v1/cases/${seg(id)}/contract`, { method: "POST", body: read.body }, { legacyErrors: true });
}
