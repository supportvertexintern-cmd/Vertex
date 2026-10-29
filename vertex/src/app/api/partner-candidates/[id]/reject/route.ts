import { NextRequest } from "next/server";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { passOn, readJson, seg } from "@/lib/pipeline";
import { HR_ROLES } from "@/lib/rbac";

// PATCH /api/partner-candidates/:id/reject — HR sends a submission back to
// the partner to correct; not a dead end. Written by FastAPI since the
// pipeline switch (step 6.7; vertex_be/app/api/v1/partner_submissions.py).
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, HR_ROLES);
  if (guardRes) return guardRes;
  const { id } = await params;
  const read = await readJson(req);
  if (read.invalid) return read.invalid;
  return passOn(`/api/v1/partner-candidates/${seg(id)}/reject`, { method: "PATCH", body: read.body });
}
