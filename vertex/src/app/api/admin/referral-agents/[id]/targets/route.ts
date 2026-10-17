import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auditedPrisma } from "@/lib/audit";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { REFERRAL_AGENT_MANAGER_ROLES } from "@/lib/rbac";
import { createReferralAgentTargetSchema } from "@/lib/validations";
import { computeReferralAgentTargetsVsActuals } from "@/server/services/kpi";

// GET /api/admin/referral-agents/:id/targets — target-vs-actual for every
// period this agent has a target set for.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, REFERRAL_AGENT_MANAGER_ROLES);
  if (guardRes) return guardRes;

  const { id } = await params;
  const data = await computeReferralAgentTargetsVsActuals(id);
  return NextResponse.json({ data });
}

// POST /api/admin/referral-agents/:id/targets — Director/Admin sets a new
// referral target for a period.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, REFERRAL_AGENT_MANAGER_ROLES);
  if (guardRes) return guardRes;

  const { id } = await params;
  const agent = await prisma.referralAgent.findUnique({ where: { id } });
  if (!agent) {
    return NextResponse.json({ error: { code: "not_found", message: "Referral agent not found." } }, { status: 404 });
  }

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: { code: "invalid_json", message: "Invalid JSON" } }, { status: 400 }); }

  const parsed = createReferralAgentTargetSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "validation_error", message: "Validation failed", details: parsed.error.flatten().fieldErrors } },
      { status: 422 }
    );
  }

  const target = await auditedPrisma(user!.userId).referralAgentTarget.create({
    data: {
      referral_agent_id: id,
      period_start: new Date(parsed.data.period_start),
      period_end: new Date(parsed.data.period_end),
      target_referrals: parsed.data.target_referrals,
      set_by: user!.userId,
    },
  });

  return NextResponse.json({ data: target }, { status: 201 });
}
