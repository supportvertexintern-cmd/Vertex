import { NextRequest } from "next/server";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { passOn, readJson, seg } from "@/lib/pipeline";
import { HR_ROLES } from "@/lib/rbac";
import type { Role } from "@prisma/client";

const OVERTURN_REJECTION_ROLES: Role[] = [...HR_ROLES];

// PATCH /api/partner-candidates/:id/overturn — HR undoing a rejection: the
// submission back to "submitted", the candidate keeping its status. Written
// by FastAPI since the pipeline switch (step 6.7;
// vertex_be/app/api/v1/partner_submissions.py).
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, OVERTURN_REJECTION_ROLES);
  if (guardRes) return guardRes;
  const { id } = await params;
  const read = await readJson(req);
  if (read.invalid) return read.invalid;
  return passOn(`/api/v1/partner-candidates/${seg(id)}/overturn`, { method: "PATCH", body: read.body });
}
