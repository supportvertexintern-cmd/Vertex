import { NextRequest, NextResponse } from "next/server";
import { passOn, readJson } from "@/lib/pipeline";
import { getAuthUser, requireAuth } from "@/lib/api-auth";
import { callBackend, legacyErrorResponse } from "@/lib/backend";

// GET /api/candidates/profile — the signed-in candidate's own record, their
// documents and application count; the plain profile, or { error } 404.
// Read from FastAPI since reads handover R4
// (vertex_be/app/api/v1/pipeline_reads.py).
export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
  const guardRes = requireAuth(user);
  if (guardRes) return guardRes;

  const result = await callBackend("/api/v1/candidates/profile");
  return result.ok ? NextResponse.json(result.body.data) : legacyErrorResponse(result);
}

// PUT /api/candidates/profile — the candidate's own Section 2. Written by
// FastAPI since the pipeline switch (step 6.7; vertex_be/app/api/v1/
// candidates.py, update_own_profile); answered in this route's older shape.
export async function PUT(req: NextRequest) {
  const user = await getAuthUser(req);
  const guardRes = requireAuth(user);
  if (guardRes) return guardRes;
  const read = await readJson(req, true);
  if (read.invalid) return read.invalid;
  return passOn("/api/v1/candidates/profile", { method: "PUT", body: read.body }, { unwrap: true, legacyErrors: true });
}
