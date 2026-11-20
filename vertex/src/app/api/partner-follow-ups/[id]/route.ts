import { NextRequest } from "next/server";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { passOn, readJson, seg } from "@/lib/pipeline";

// PATCH /api/partner-follow-ups/:id: done or reopened, or its action or due
// date changed. FastAPI writes it and keeps a VA to its own partners; the
// roles must match TRACKERS in partner_tracking.py.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, ["virtual_assistant", "inhouse_supervisor", "director", "admin"]);
  if (guardRes) return guardRes;
  const { id } = await params;
  const read = await readJson(req);
  if (read.invalid) return read.invalid;
  return passOn(`/api/v1/partner-follow-ups/${seg(id)}`, { method: "PATCH", body: read.body });
}
