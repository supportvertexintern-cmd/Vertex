import { NextRequest } from "next/server";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { passOn, seg } from "@/lib/pipeline";
import { HR_ROLES } from "@/lib/rbac";

// PATCH /api/partner-candidates/:id/create-case — HR approves a partner's
// submission and opens its case (SRS FR-5.1); the candidate goes straight
// to "approved" and the partner is told. Written by FastAPI since the
// pipeline switch (step 6.7; vertex_be/app/api/v1/partner_submissions.py).
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, HR_ROLES);
  if (guardRes) return guardRes;
  const { id } = await params;
  return passOn(`/api/v1/partner-candidates/${seg(id)}/create-case`, { method: "PATCH" });
}
