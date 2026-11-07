import { NextRequest } from "next/server";
import { getAuthUser, requireAdmin } from "@/lib/api-auth";
import { backendResponse, callBackend } from "@/lib/backend";

// POST /api/admin/monitoring/checks/run: the scheduled account checks (stale
// partner logins, inactive logins) now. An account already raised this month
// isn't raised again.
export async function POST(req: NextRequest) {
  const user = await getAuthUser(req);
  const guardRes = requireAdmin(user);
  if (guardRes) return guardRes;
  return backendResponse(await callBackend("/api/v1/monitoring/checks/run", { method: "POST" }));
}
