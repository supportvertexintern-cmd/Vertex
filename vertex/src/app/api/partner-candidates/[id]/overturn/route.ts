import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auditedPrisma } from "@/lib/audit";
import { z } from "zod";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { HR_ROLES } from "@/lib/rbac";
import type { Role } from "@prisma/client";

// Overturn rejection schema for partner candidates — only "submitted" is valid
const overturnPartnerRejectionSchema = z.object({
  status: z.enum(["submitted"]),
});

// PATCH /api/partner-candidates/:id/overturn — HR-only endpoint to overturn a rejection
// and restore the partner submission (2026-09-28). Clears the rejection fields and
// sets the status back to "submitted". Also restores the bridged candidate's lifecycle
// status if one exists.
const OVERTURN_REJECTION_ROLES: Role[] = [...HR_ROLES];

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, OVERTURN_REJECTION_ROLES);
  if (guardRes) return guardRes;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: { code: "invalid_json", message: "Invalid JSON" } }, { status: 400 });
  }

  const parsed = overturnPartnerRejectionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "validation_error", message: "Validation failed", details: parsed.error.flatten().fieldErrors } },
      { status: 422 }
    );
  }

  const partnerCandidate = await prisma.partnerCandidate.findUnique({
    where: { id },
    include: {
      bridged_candidate: true,
    },
  });
  if (!partnerCandidate) return NextResponse.json({ error: { code: "not_found", message: "Partner candidate submission not found." } }, { status: 404 });

  if (partnerCandidate.status !== "rejected") {
    return NextResponse.json({ error: { code: "not_rejected", message: "This submission is not rejected." } }, { status: 400 });
  }

  if (partnerCandidate.status === "job_assigned") {
    return NextResponse.json(
      { error: { code: "case_exists", message: "A case has already been created for this submission — manage it from the Case instead." } },
      { status: 409 }
    );
  }

  const db = auditedPrisma(user!.userId);
  const updated = await db.partnerCandidate.update({
    where: { id },
    data: {
      status: "submitted",
      rejection_reason: null,
      reviewed_by: null,
    },
    select: {
      id: true,
      status: true,
      rejection_reason: true,
    },
  });

  // Restore the bridged candidate's lifecycle status if one exists
  // (2026-09-28) — if we overturned the rejection, the candidate should
  // be restored to "approved" so they can proceed through the pipeline.
  if (partnerCandidate.bridged_candidate_id) {
    await db.candidate.update({
      where: { id: partnerCandidate.bridged_candidate_id },
      data: { lifecycle_status: "approved" },
    });
  }

  return NextResponse.json({ data: updated });
}
