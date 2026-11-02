import { NextRequest } from "next/server";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { backendResponse, callBackend } from "@/lib/backend";
import { REFERRAL_AGENT_MANAGER_ROLES } from "@/lib/rbac";

// Read from FastAPI since reads handover R2 (vertex_be/app/api/v1/referral_reads.py).
export async function GET(req: NextRequest, { params }: { params: Promise<{ countryId: string }> }) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, REFERRAL_AGENT_MANAGER_ROLES);
  if (guardRes) return guardRes;

  const { countryId } = await params;
  return backendResponse(await callBackend(`/api/v1/referral-agents/countries/${encodeURIComponent(countryId)}/summary`));
}
