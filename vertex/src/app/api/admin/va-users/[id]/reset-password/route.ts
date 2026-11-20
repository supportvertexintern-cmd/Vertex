import { NextRequest } from "next/server";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { passOn, seg } from "@/lib/pipeline";

// POST /api/admin/va-users/:id/reset-password: clears a VA's password and
// sends the setup email (FastAPI; a VA's account only). The roles must match
// MANAGERS in vertex_be/app/api/v1/partner_tracking.py.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, ["inhouse_supervisor", "director", "admin"]);
  if (guardRes) return guardRes;
  const { id } = await params;
  return passOn(`/api/v1/va-users/${seg(id)}/reset-password`, { method: "POST" });
}
