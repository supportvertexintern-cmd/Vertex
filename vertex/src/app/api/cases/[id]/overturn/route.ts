import { NextRequest } from "next/server";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { passOn, readJson, seg } from "@/lib/pipeline";
import type { Role } from "@prisma/client";

const OVERTURN_REJECTION_ROLES: Role[] = ["hr", "director", "admin"];

// PATCH /api/cases/:id/overturn — HR, the director or admin undoing a
// rejection. Written by FastAPI since the pipeline switch (step 6.7;
// vertex_be/app/api/v1/cases.py, overturn).
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, OVERTURN_REJECTION_ROLES);
  if (guardRes) return guardRes;
  const read = await readJson(req);
  if (read.invalid) return read.invalid;
  return passOn(`/api/v1/cases/${seg(id)}/overturn`, { method: "PATCH", body: read.body });
}
