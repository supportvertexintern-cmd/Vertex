import { NextRequest } from "next/server";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { REFERRAL_AGENT_MANAGER_ROLES } from "@/lib/rbac";
import { passOn, seg } from "@/lib/pipeline";

// POST /api/admin/referral-agents/:id/approve — Director/Admin only
// (deliberately excludes inhouse_supervisor, unlike PARTNER_MANAGER_ROLES —
// confirmed with the business that this is director-tier, not the
// operational in-house tier). Mirrors provision-account/route.ts: creates
// the agent's own login and sends the same account-setup invite, plus a
// referral-agent-specific approval email with their code/link.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, REFERRAL_AGENT_MANAGER_ROLES);
  if (guardRes) return guardRes;

  const { id } = await params;

  // FastAPI approves since users step 8.4 (vertex_be/app/api/v1/referral_agents.py),
  // with the agent's row locked so two approvals can't both create a login.
  let sent: unknown;
  try { sent = await req.json(); } catch { sent = {}; }
  return passOn(`/api/v1/referral-agents/${seg(id)}/approve`, { method: "POST", body: sent });
}
