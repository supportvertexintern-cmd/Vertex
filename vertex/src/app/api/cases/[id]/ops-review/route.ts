import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auditedPrisma } from "@/lib/audit";
import { caseOpsReviewSchema } from "@/lib/validations";
import { getAuthUser, requireRole, forbidden } from "@/lib/api-auth";
import { canAccessCase } from "@/server/scope";
import { OPERATIONS_ROLES } from "@/lib/rbac";

// PATCH /api/cases/:id/ops-review — Operations/Director's documentation
// confirmation gate (CRM Comments item 3, 2026-08-10). A lightweight
// second-look ("is the paperwork actually right before the full
// operational process begins"), distinct from HR's own approve/reject
// that opens the Case in the first place — this never creates or rejects
// a Case, it only confirms/flags the documentation on one that already
// exists. The decision can be changed later (e.g. Confirm after a Reject
// once the issue is fixed) — no separate reset action needed. Applies
// uniformly to both the self-submitted and partner-sourced pipelines.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, OPERATIONS_ROLES);
  if (guardRes) return guardRes;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: { code: "invalid_json", message: "Invalid JSON" } }, { status: 400 });
  }

  const parsed = caseOpsReviewSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "validation_error", message: "Validation failed", details: parsed.error.flatten().fieldErrors } },
      { status: 422 }
    );
  }

  const caseRecord = await prisma.case.findUnique({
    where: { id },
    include: { application: { include: { candidate: true } } },
  });
  if (!caseRecord) return NextResponse.json({ error: { code: "not_found", message: "Case not found." } }, { status: 404 });

  const allowed = await canAccessCase(user!, {
    user_id: caseRecord.application.candidate.user_id,
    recruiter_id: caseRecord.application.candidate.recruiter_id,
    country_id: caseRecord.application.candidate.country_id,
    partner_id: caseRecord.application.candidate.partner_id,
  });
  if (!allowed) return forbidden({ error: { code: "forbidden", message: "Forbidden." } });

  if (caseRecord.status === "rejected") {
    return NextResponse.json({ error: { code: "case_rejected", message: "This case has been rejected and is closed." } }, { status: 422 });
  }

  const db = auditedPrisma(user!.userId);
  const updated = await db.case.update({
    where: { id },
    data: {
      ops_review_status: parsed.data.decision,
      ops_reviewed_by_id: user!.userId,
      ops_reviewed_at: new Date(),
      ops_review_notes: parsed.data.notes ?? null,
    },
    select: {
      id: true,
      ops_review_status: true,
      ops_reviewed_at: true,
      ops_review_notes: true,
      ops_reviewed_by: { select: { full_name: true } },
    },
  });

  return NextResponse.json({ data: updated });
}
