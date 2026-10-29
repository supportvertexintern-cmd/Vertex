import { NextRequest } from "next/server";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { passOn, seg } from "@/lib/pipeline";
import { REFERRAL_AGENT_MANAGER_ROLES } from "@/lib/rbac";

// POST /api/admin/referral-commissions/:id/approve — pending -> approved.
// Written by FastAPI since the pipeline switch (step 6.7;
// vertex_be/app/api/v1/referral_commissions.py), which lists the agent's
// email for this app to send.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, REFERRAL_AGENT_MANAGER_ROLES);
  if (guardRes) return guardRes;
  const { id } = await params;
  return passOn(`/api/v1/referral-commissions/${seg(id)}/approve`, { method: "POST" });
}
