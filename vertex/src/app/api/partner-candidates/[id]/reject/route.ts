import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auditedPrisma } from "@/lib/audit";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { HR_ROLES } from "@/lib/rbac";
import { sendPartnerCandidateRejectedEmail } from "@/lib/email";

import { log } from "@/lib/log";
const rejectSchema = z.object({
  rejection_reason: z.string().min(1).max(2000),
});

// PATCH /api/partner-candidates/:id/reject — HR sends a partner submission
// back for correction (SRS FR-5.1, 2026-07-31 per the Operational Workflow
// SOP) — schema already declared reviewed_by/rejection_reason/status:
// "rejected" but no route ever set them until now. A rejected submission
// isn't a dead end — the partner can still be messaged (Phase 11's shared
// thread) about what to fix; nothing here deletes or blocks a future
// resubmission-by-conversation.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, HR_ROLES);
  if (guardRes) return guardRes;

  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: { code: "invalid_json", message: "Invalid JSON" } }, { status: 400 });
  }

  const parsed = rejectSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "validation_error", message: "Validation failed", details: parsed.error.flatten().fieldErrors } },
      { status: 422 }
    );
  }

  const partnerCandidate = await prisma.partnerCandidate.findUnique({
    where: { id, status: { not: "draft" } },
    include: { partner: { select: { name: true, contact_email: true } } },
  });
  if (!partnerCandidate) {
    return NextResponse.json({ error: { code: "not_found", message: "Partner candidate submission not found." } }, { status: 404 });
  }
  if (partnerCandidate.status === "job_assigned") {
    return NextResponse.json(
      { error: { code: "already_bridged", message: "A case has already been created for this submission — it can no longer be rejected." } },
      { status: 409 }
    );
  }
  // Defensive (2026-09-09) — the UI never offers a reject action on a
  // draft (it isn't in HR's queue at all, see GET /api/partner-candidates),
  // but guard the direct API too: a draft was never actually submitted, so
  // "rejecting" one is meaningless.
  if (partnerCandidate.status === "draft") {
    return NextResponse.json(
      { error: { code: "invalid_state", message: "This submission is still a draft and has not been submitted." } },
      { status: 409 }
    );
  }

  const updated = await auditedPrisma(user!.userId).partnerCandidate.update({
    where: { id },
    data: { status: "rejected", rejection_reason: parsed.data.rejection_reason, reviewed_by: user!.userId },
  });

  // Awaited, not fire-and-forget — on serverless (Vercel) the function
  // instance can freeze right after the response is sent, silently
  // killing an un-awaited async send before it completes.
  await sendPartnerCandidateRejectedEmail(partnerCandidate.partner.contact_email, partnerCandidate.partner.name, partnerCandidate.full_name ?? "the candidate", parsed.data.rejection_reason).catch((err) => log.error("email.send_failed", { err }));

  return NextResponse.json({ data: updated });
}
