import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auditedPrisma } from "@/lib/audit";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { reportContentSchema } from "@/lib/validations";

const STAFF_ROLES = ["regional_recruiter", "country_supervisor", "inhouse_supervisor", "admin"] as const;

// PATCH /api/reports/:id/resubmit — only the original submitter can
// correct and resubmit a returned report (SRS FR-3.5).
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, [...STAFF_ROLES]);
  if (guardRes) return guardRes;

  const { id } = await params;

  const report = await prisma.report.findUnique({ where: { id } });
  if (!report) {
    return NextResponse.json({ error: { code: "not_found", message: "Report not found." } }, { status: 404 });
  }

  if (report.submitted_by !== user!.userId && user!.role !== "admin") {
    return NextResponse.json({ error: { code: "forbidden", message: "Only the original submitter can resubmit this report." } }, { status: 403 });
  }

  if (report.status !== "returned") {
    return NextResponse.json({ error: { code: "invalid_transition", message: "Only a returned report can be resubmitted." } }, { status: 422 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: { code: "invalid_json", message: "Invalid JSON" } }, { status: 400 });
  }

  const parsedContent = reportContentSchema.safeParse((body as { content?: unknown })?.content);
  if (!parsedContent.success) {
    return NextResponse.json(
      { error: { code: "validation_error", message: "Validation failed", details: parsedContent.error.flatten().fieldErrors } },
      { status: 422 }
    );
  }

  // CRM Submission Ref. is always the report's own id (never user-entered
  // — see POST /api/reports), so resubmitting re-asserts it regardless of
  // whatever the corrected content happened to carry.
  const updated = await auditedPrisma(user!.userId).report.update({
    where: { id },
    data: {
      status: "submitted",
      return_reason: null,
      content: { ...parsedContent.data, crm_reference: id },
    },
    select: { id: true, status: true },
  });

  return NextResponse.json({ data: updated });
}
