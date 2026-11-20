import { NextRequest } from "next/server";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { passOn, readJson, seg } from "@/lib/pipeline";

// PATCH /api/admin/va-users/:id: deactivate a VA (its partners move to the
// chosen replacement or are left unassigned; its sessions end) or reactivate
// it. FastAPI writes it (vertex_be/app/api/v1/partner_tracking.py); the roles
// must match MANAGERS there (tests check it).
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, ["inhouse_supervisor", "director", "admin"]);
  if (guardRes) return guardRes;
  const { id } = await params;
  const read = await readJson(req);
  if (read.invalid) return read.invalid;
  return passOn(`/api/v1/va-users/${seg(id)}`, { method: "PATCH", body: read.body });
}
