import { NextRequest } from "next/server";
import { passOn, seg } from "@/lib/pipeline";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { HR_ROLES } from "@/lib/rbac";
import { backendResponse, callBackend } from "@/lib/backend";

const DELETE_ROLES = [...HR_ROLES, "operations_team", "operations_director"] as const;

// GET /api/partner-candidates/:id — one submitted partner submission, with
// its document completeness and every document type its destination
// needs.
// Read from FastAPI since reads handover R4
// (vertex_be/app/api/v1/pipeline_reads.py).
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, [...HR_ROLES, "operations_team", "operations_director"]);
  if (guardRes) return guardRes;

  const { id } = await params;
  return backendResponse(await callBackend(`/api/v1/partner-candidates/${seg(id)}`));
}

// DELETE /api/partner-candidates/:id — an erroneous or duplicate submission,
// with its candidate; refused once a case exists. Written by FastAPI since
// the pipeline switch (step 6.7; vertex_be/app/api/v1/partner_submissions.py).
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, [...DELETE_ROLES]);
  if (guardRes) return guardRes;
  const { id } = await params;
  return passOn(`/api/v1/partner-candidates/${seg(id)}`, { method: "DELETE" });
}
