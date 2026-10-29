import { NextRequest } from "next/server";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { passOn, readJson, seg } from "@/lib/pipeline";

// PATCH /api/candidates/:id/status — a role-gated lifecycle move (SRS
// FR-2.4), the screening gate and its invite on "screened" (FR-2.5), the
// supervisor's return (FR-2.7), and approval opening the case (FR-4.1).
// Written by FastAPI since the pipeline switch (step 6.7;
// vertex_be/app/api/v1/candidates.py, set_status), which lists the invite,
// approval and commission emails for this app to send.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, [
    "regional_recruiter",
    "country_supervisor",
    "inhouse_supervisor",
    "director",
    "admin",
    "hr",
  ]);
  if (guardRes) return guardRes;
  const { id } = await params;
  const read = await readJson(req);
  if (read.invalid) return read.invalid;
  return passOn(`/api/v1/candidates/${seg(id)}/status`, { method: "PATCH", body: read.body });
}
