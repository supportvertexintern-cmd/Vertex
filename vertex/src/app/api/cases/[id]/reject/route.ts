import { NextRequest } from "next/server";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { passOn, readJson, seg } from "@/lib/pipeline";
import { OPERATIONS_ROLES } from "@/lib/rbac";
import type { Role } from "@prisma/client";

const CASE_REJECT_ROLES: Role[] = [...OPERATIONS_ROLES, "hr"];

// PATCH /api/cases/:id/reject — a terminal case rejection, closing the
// candidate and application with it; HR and the partner are told. HR may
// reject too (undoing a case opened by mistake). Written by FastAPI since
// the pipeline switch (step 6.7; vertex_be/app/api/v1/cases.py, reject).
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, CASE_REJECT_ROLES);
  if (guardRes) return guardRes;
  const read = await readJson(req);
  if (read.invalid) return read.invalid;
  return passOn(`/api/v1/cases/${seg(id)}/reject`, { method: "PATCH", body: read.body });
}
