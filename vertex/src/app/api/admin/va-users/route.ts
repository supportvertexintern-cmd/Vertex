import { NextRequest } from "next/server";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { backendResponse, callBackend } from "@/lib/backend";

// GET /api/admin/va-users: the virtual assistants and how many partners each
// holds, for the managers who assign partners (Phase 6). FastAPI answers
// (vertex_be/app/api/v1/partner_tracking.py); the roles must match MANAGERS there.
export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, ["inhouse_supervisor", "director", "admin"]);
  if (guardRes) return guardRes;
  return backendResponse(await callBackend("/api/v1/va-users"));
}
