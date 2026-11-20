import { NextRequest } from "next/server";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { passOn, readJson, seg } from "@/lib/pipeline";

// PATCH /api/partner-reports/:id: a recorded report's status, notes or date.
// FastAPI writes it and keeps a VA to its own partners' reports (upstream's
// DEF-013); the roles must match TRACKERS in partner_tracking.py.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, ["virtual_assistant", "inhouse_supervisor", "director", "admin"]);
  if (guardRes) return guardRes;
  const { id } = await params;
  const read = await readJson(req);
  if (read.invalid) return read.invalid;
  return passOn(`/api/v1/partner-reports/${seg(id)}`, { method: "PATCH", body: read.body });
}
