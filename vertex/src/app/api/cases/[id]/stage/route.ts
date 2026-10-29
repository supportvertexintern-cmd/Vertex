import { NextRequest } from "next/server";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { passOn, readJson, seg } from "@/lib/pipeline";
import { OPERATIONS_ROLES } from "@/lib/rbac";

// PATCH /api/cases/:id/stage — advance or return a case's stage (SRS
// FR-4.2): Operations-owned, director and admin keep override. Written by
// FastAPI since the pipeline switch (step 6.7; vertex_be/app/api/v1/
// cases.py, set_stage), with the referral commissions, the 90-day retention
// follow-up at the last stage and the stage emails it lists.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, OPERATIONS_ROLES);
  if (guardRes) return guardRes;
  const read = await readJson(req, true);
  if (read.invalid) return read.invalid;
  return passOn(`/api/v1/cases/${seg(id)}/stage`, { method: "PATCH", body: read.body }, { legacyErrors: true });
}
