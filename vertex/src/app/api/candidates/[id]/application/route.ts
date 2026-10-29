import { NextRequest } from "next/server";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { passOn, readJson, seg } from "@/lib/pipeline";

// PATCH /api/candidates/:id/application — staff correcting the programme,
// travel and visa answers on a candidate's latest application, and on a
// partner submission's own copy of them. Written by FastAPI since the
// pipeline switch (step 6.7; vertex_be/app/api/v1/applications.py, correct).
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, [
    "regional_recruiter", "country_supervisor", "admin", "hr", "operations_team", "operations_director", "director",
  ]);
  if (guardRes) return guardRes;
  const { id } = await params;
  const read = await readJson(req);
  if (read.invalid) return read.invalid;
  return passOn(`/api/v1/candidates/${seg(id)}/application`, { method: "PATCH", body: read.body });
}
