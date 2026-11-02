import { NextRequest } from "next/server";
import { backendResponse, callBackend } from "@/lib/backend";
import { readJson } from "@/lib/pipeline";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { REFERRAL_AGENT_MANAGER_ROLES } from "@/lib/rbac";

// Read from FastAPI since reads handover R2 (vertex_be/app/api/v1/referral_reads.py).
export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, REFERRAL_AGENT_MANAGER_ROLES);
  if (guardRes) return guardRes;

  const countryId = req.nextUrl.searchParams.get("countryId") || undefined;
  return backendResponse(await callBackend("/api/v1/referral-commission-rules", { query: { countryId } }));
}

// POST /api/admin/referral-commission-rules — set the amount for a (country,
// milestone); the existing rule is updated. Written by FastAPI since
// payments step 7.1 (vertex_be/app/api/v1/referral_commissions.py,
// upsert_rule).
export async function POST(req: NextRequest) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, REFERRAL_AGENT_MANAGER_ROLES);
  if (guardRes) return guardRes;
  const read = await readJson(req);
  if (read.invalid) return read.invalid;
  const result = await callBackend("/api/v1/referral-commission-rules", { method: "POST", body: read.body });
  return backendResponse(result);
}
