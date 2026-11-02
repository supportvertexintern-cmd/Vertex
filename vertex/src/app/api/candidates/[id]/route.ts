import { NextRequest } from "next/server";
import { passOn, readJson, seg } from "@/lib/pipeline";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { backendResponse, callBackend } from "@/lib/backend";

const STAFF_ROLES = ["regional_recruiter", "country_supervisor", "inhouse_supervisor", "director", "admin", "hr"] as const;

// PATCH and DELETE are written by FastAPI since the pipeline switch (step
// 6.7; vertex_be/app/api/v1/candidates.py): staff corrections and consent
// (SRS FR-2.5, FR-2.8), kept in step with a partner submission's copy; and
// removing an erroneous submission, refused once a case exists.

// GET /api/candidates/:id — one candidate the caller may see, with each
// application's required document types, their union, and why the
// screening gate failed (for a candidate it failed).
// Read from FastAPI since reads handover R4
// (vertex_be/app/api/v1/pipeline_reads.py).
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, [...STAFF_ROLES]);
  if (guardRes) return guardRes;

  const { id } = await params;
  return backendResponse(await callBackend(`/api/v1/candidates/${seg(id)}`));
}

// PATCH /api/candidates/:id — HR, operations and the director may make the
// same minor corrections the recruiter and supervisor can.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, [
    "regional_recruiter", "country_supervisor", "admin", "hr", "operations_team", "operations_director", "director",
  ]);
  if (guardRes) return guardRes;
  const { id } = await params;
  const read = await readJson(req);
  if (read.invalid) return read.invalid;
  return passOn(`/api/v1/candidates/${seg(id)}`, { method: "PATCH", body: read.body });
}

// DELETE /api/candidates/:id — HR's and operations' counterpart to deleting
// a partner submission.
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, ["hr", "operations_team", "operations_director", "director", "admin"]);
  if (guardRes) return guardRes;
  const { id } = await params;
  return passOn(`/api/v1/candidates/${seg(id)}`, { method: "DELETE" });
}
