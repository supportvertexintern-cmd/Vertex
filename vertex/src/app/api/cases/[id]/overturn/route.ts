import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auditedPrisma } from "@/lib/audit";
import { overturnRejectionSchema } from "@/lib/validations";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { canAccessCase } from "@/server/scope";
import type { Role } from "@prisma/client";

// PATCH /api/cases/:id/overturn — HR-only endpoint to overturn a rejection
// and change the case status (2026-09-25). Clears the rejection fields and
// sets the new status. Also cascades the status change to the candidate
// and application records for consistency.
const OVERTURN_REJECTION_ROLES: Role[] = ["hr", "director", "admin"];

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

  const parsed = overturnRejectionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "validation_error", message: "Validation failed", details: parsed.error.flatten().fieldErrors } },
      { status: 422 }
    );
  }

  const caseRecord = await prisma.case.findUnique({
    where: { id },
    include: {
      application: {
        include: {
          candidate: true,
        },
      },
    },
  });
  if (!caseRecord) return NextResponse.json({ error: { code: "not_found", message: "Case not found." } }, { status: 404 });

  const allowed = await canAccessCase(user!, {
    user_id: caseRecord.application.candidate.user_id,
    recruiter_id: caseRecord.application.candidate.recruiter_id,
    country_id: caseRecord.application.candidate.country_id,
    partner_id: caseRecord.application.candidate.partner_id,
  });
  if (!allowed) return NextResponse.json({ error: { code: "forbidden", message: "Forbidden." } }, { status: 403 });

  if (caseRecord.status !== "rejected") {
    return NextResponse.json({ error: { code: "not_rejected", message: "This case is not rejected." } }, { status: 400 });
  }

  const db = auditedPrisma(user!.userId);
  const updated = await db.case.update({
    where: { id },
    data: {
      status: parsed.data.status,
      rejected_at: null,
      rejected_by_id: null,
      rejection_reason: null,
    },
    select: {
      id: true,
      status: true,
      rejected_at: true,
      rejection_reason: true,
      rejected_by: { select: { full_name: true } },
    },
  });

  // Cascade the status change onto the candidate/application (2026-09-25)
  // — if overturning to "active", restore them from "rejected" to their
  // previous state. For now, we set them to "approved" as a safe default
  // since that's the state they were in when the case was created.
  if (parsed.data.status === "active") {
    await db.candidate.update({
      where: { id: caseRecord.application.candidate.id },
      data: { lifecycle_status: "approved" },
    });
    await db.application.update({
      where: { id: caseRecord.application.id },
      data: { application_status: "approved" },
    });
  }

  return NextResponse.json({ data: updated });
}
