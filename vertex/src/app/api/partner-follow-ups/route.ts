import { NextRequest } from "next/server";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { passOn, readJson } from "@/lib/pipeline";

// POST /api/partner-follow-ups: an action to take for a partner (Phase 6).
// FastAPI writes it (vertex_be/app/api/v1/partner_tracking.py) and keeps a
// VA to its own partners; the roles must match TRACKERS there.
export async function POST(req: NextRequest) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, ["virtual_assistant", "inhouse_supervisor", "director", "admin"]);
  if (guardRes) return guardRes;
  const read = await readJson(req);
  if (read.invalid) return read.invalid;
  return passOn("/api/v1/partner-follow-ups", { method: "POST", body: read.body });
}
