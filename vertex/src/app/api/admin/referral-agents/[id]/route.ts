import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { REFERRAL_AGENT_MANAGER_ROLES } from "@/lib/rbac";
import { passOn, readJson, seg } from "@/lib/pipeline";

// GET /api/admin/referral-agents/:id — detail, including referred
// candidates and the commission ledger, Director/Admin only.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, REFERRAL_AGENT_MANAGER_ROLES);
  if (guardRes) return guardRes;

  const { id } = await params;
  const agent = await prisma.referralAgent.findUnique({
    where: { id },
    include: {
      countryRef: { select: { id: true, name: true } },
      candidates: {
        select: { id: true, full_name: true, lifecycle_status: true, referral_duplicate_flag: true, created_at: true },
        orderBy: { created_at: "desc" },
      },
      commissions: {
        orderBy: { created_at: "desc" },
        select: {
          id: true,
          milestone: true,
          amount: true,
          currency: true,
          status: true,
          created_at: true,
          candidate: { select: { id: true, full_name: true } },
        },
      },
    },
  });
  if (!agent) {
    return NextResponse.json({ error: { code: "not_found", message: "Referral agent not found." } }, { status: 404 });
  }

  return NextResponse.json({ data: agent });
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
