import { NextRequest } from "next/server";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { passOn, readJson, seg } from "@/lib/pipeline";
import { OPERATIONS_ROLES } from "@/lib/rbac";

// PATCH /api/cases/:id/retention — the 90-day retention follow-up is done
// (SRS FR-4.7). Written by FastAPI since the pipeline switch (step 6.7;
// vertex_be/app/api/v1/cases.py, complete_retention).
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, OPERATIONS_ROLES);
  if (guardRes) return guardRes;
  const read = await readJson(req, true);
  if (read.invalid) return read.invalid;
  return passOn(`/api/v1/cases/${seg(id)}/retention`, { method: "PATCH", body: read.body }, { legacyErrors: true });
}
