import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auditedPrisma } from "@/lib/audit";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { REFERRAL_AGENT_MANAGER_ROLES } from "@/lib/rbac";
import { updateReferralAgentStatusSchema } from "@/lib/validations";
import { sendReferralAgentRejectedEmail, sendReferralAgentSuspendedEmail } from "@/lib/email";
import { log } from "@/lib/log";

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
  const existing = await prisma.referralAgent.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: { code: "not_found", message: "Referral agent not found." } }, { status: 404 });
  }

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: { code: "invalid_json", message: "Invalid JSON" } }, { status: 400 }); }

  const parsed = updateReferralAgentStatusSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "validation_error", message: "Validation failed", details: parsed.error.flatten().fieldErrors } },
      { status: 422 }
    );
  }
  const { status: target, reason } = parsed.data;

  if (target === "rejected") {
    if (existing.status !== "pending_approval") {
      return NextResponse.json({ error: { code: "invalid_transition", message: "Only a pending application can be rejected." } }, { status: 422 });
    }
    if (!reason) {
      return NextResponse.json({ error: { code: "reason_required", message: "A reason is required to reject an application." } }, { status: 422 });
    }
  } else if (target === "suspended") {
    if (existing.status !== "active") {
      return NextResponse.json({ error: { code: "invalid_transition", message: "Only an active agent can be suspended." } }, { status: 422 });
    }
    if (!reason) {
      return NextResponse.json({ error: { code: "reason_required", message: "A reason is required to suspend an agent." } }, { status: 422 });
    }
  } else if (target === "active") {
    if (existing.status !== "suspended") {
      return NextResponse.json({ error: { code: "invalid_transition", message: "Only a suspended agent can be reactivated." } }, { status: 422 });
    }
  }

  const db = auditedPrisma(user!.userId);
  const updated = await db.referralAgent.update({
    where: { id },
    data: {
      status: target,
      rejection_reason: target === "rejected" ? reason : existing.rejection_reason,
      suspended_reason: target === "suspended" ? reason : target === "active" ? null : existing.suspended_reason,
    },
  });

  if (target === "rejected") {
    await sendReferralAgentRejectedEmail(existing.email, existing.full_name, reason!).catch((err) => log.error("email.send_failed", { err }));
  } else if (target === "suspended") {
    await sendReferralAgentSuspendedEmail(existing.email, existing.full_name, reason!).catch((err) => log.error("email.send_failed", { err }));
  }

  return NextResponse.json({ data: updated });
}
