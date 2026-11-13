import { NextRequest } from "next/server";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { backendResponse, callBackend } from "@/lib/backend";

// GET /api/va/overview: the virtual assistant's dashboard.
// FastAPI answers (vertex_be/app/api/v1/va.py) and scopes a virtual
// assistant to its own partners; the roles must match VA_OVERVIEW_ROLES there
// (tests check it).
export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, ["virtual_assistant", "director", "admin"]);
  if (guardRes) return guardRes;
  return backendResponse(await callBackend("/api/v1/va/overview"));
}
