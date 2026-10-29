import { NextRequest } from "next/server";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { passOn, seg } from "@/lib/pipeline";
import { REFERRAL_AGENT_MANAGER_ROLES } from "@/lib/rbac";

// POST /api/admin/referral-commissions/:id/mark-paid — approved -> paid, the
// reference and method optional. Written by FastAPI since the pipeline
// switch (step 6.7; vertex_be/app/api/v1/referral_commissions.py).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, REFERRAL_AGENT_MANAGER_ROLES);
  if (guardRes) return guardRes;
  const { id } = await params;
  // No body at all is fine: both fields are optional.
  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  return passOn(`/api/v1/referral-commissions/${seg(id)}/mark-paid`, { method: "POST", body });
}
