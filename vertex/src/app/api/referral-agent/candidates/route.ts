import { NextRequest } from "next/server";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { backendResponse, callBackend } from "@/lib/backend";

// Read from FastAPI since reads handover R2: the agent's own referred
// candidates, found by their session (vertex_be/app/api/v1/referral_reads.py).
export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, ["referral_agent"]);
  if (guardRes) return guardRes;

  return backendResponse(await callBackend("/api/v1/referral-agent/candidates"));
}
