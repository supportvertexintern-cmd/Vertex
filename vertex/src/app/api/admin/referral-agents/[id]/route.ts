import { NextRequest } from "next/server";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { backendResponse, callBackend } from "@/lib/backend";
import { REFERRAL_AGENT_MANAGER_ROLES } from "@/lib/rbac";
import { passOn, readJson, seg } from "@/lib/pipeline";

// Read from FastAPI since reads handover R2 (vertex_be/app/api/v1/referral_reads.py).
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, REFERRAL_AGENT_MANAGER_ROLES);
  if (guardRes) return guardRes;

  const { id } = await params;
  return backendResponse(await callBackend(`/api/v1/referral-agents/${seg(id)}`));
}

// PATCH /api/admin/referral-agents/:id — reject (pending_approval ->
// rejected), suspend (active -> suspended), or reactivate (suspended ->
// active). Approval itself is a separate route (POST .../approve) since it
// also provisions a login, mirroring Partner's own
// provision-account/status-PATCH split. Suspending never deletes history —
// already-earned commissions stay payable/auditable.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, REFERRAL_AGENT_MANAGER_ROLES);
  if (guardRes) return guardRes;

  const { id } = await params;

  // FastAPI decides since users step 8.4 (vertex_be/app/api/v1/referral_agents.py).
  const read = await readJson(req);
  if (read.invalid) return read.invalid;
  return passOn(`/api/v1/referral-agents/${seg(id)}`, { method: "PATCH", body: read.body });
}
