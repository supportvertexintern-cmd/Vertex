import { NextRequest } from "next/server";
import { getAuthUser, requireAdmin } from "@/lib/api-auth";
import { backendResponse, callBackend } from "@/lib/backend";

// Role management (2026-11-21; vertex_be/app/api/v1/roles.py): this handler
// checks the role early, passes the request on and answers with FastAPI's
// response. FastAPI re-checks the session and the role itself.

// GET /api/admin/roles: every permission, and what each internal role holds. Admin only.
export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
  const guardRes = requireAdmin(user);
  if (guardRes) return guardRes;

  return backendResponse(await callBackend("/api/v1/admin/roles"));
}
