import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { auditedPrisma } from "@/lib/audit";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { HR_ROLES } from "@/lib/rbac";
import { evaluateDocumentCompletenessForCandidateId, getRequiredDocumentTypesForCountryId } from "@/server/services/documentCompleteness";

const DELETE_ROLES = [...HR_ROLES, "operations_team", "operations_director"] as const;

// GET /api/partner-candidates/:id — full submission detail for HR's review
// page (SRS FR-5.1, 2026-07-31). Operations also gets read visibility here
// (confirmed) so it can see what's coming before HR approves anything.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, [...HR_ROLES, "operations_team", "operations_director"]);
  if (guardRes) return guardRes;

  const { id } = await params;

  const partnerCandidate = await prisma.partnerCandidate.findUnique({
    where: { id, status: { not: "draft" } },
    include: {
      partner: { select: { id: true, name: true, contact_email: true, contact_name: true, contact_phone: true } },
      job: { select: { id: true, title: true, country: true, city: true, service_fee_gbp: true, is_credit_service: true, financing_percent: true, installment_count: true } },
      job_position: { select: { title: true, city: true, job_sector: { select: { sector: true } } } },
      current_location_country: { select: { name: true } },
      reviewer: { select: { full_name: true } },
      bridged_candidate: {
        select: {
          id: true,
          documents: { select: { id: true, type: true, label: true, verification_status: true, uploaded_at: true } },
        },
      },
    },
  });
  if (!partnerCandidate) {
    return NextResponse.json({ error: { code: "not_found", message: "Partner candidate submission not found." } }, { status: 404 });
  }

  const document_completeness = partnerCandidate.bridged_candidate_id
    ? await evaluateDocumentCompletenessForCandidateId(partnerCandidate.bridged_candidate_id)
    : null;

  // Same-shape addition as GET /api/candidates/:id's required_document_types
  // — lets the review page (HR and, 2026-08-04, Operations) render an
  // upload control for every required type, not just whichever ones are
  // already missing.
  const jobCountry = partnerCandidate.job
    ? await prisma.country.findFirst({ where: { name: { equals: partnerCandidate.job.country, mode: "insensitive" } } })
    : null;
  const required_document_types = await getRequiredDocumentTypesForCountryId(jobCountry?.id ?? null);

  return NextResponse.json({ data: { ...partnerCandidate, document_completeness, required_document_types } });
}

// DELETE /api/partner-candidates/:id — remove an erroneous/duplicate/spam
// partner submission (CRM Comments follow-up, 2026-08-12). HR + Operations
// (matching canEditAndUpload's role set on the review page), not just
// HR-exclusive like Create Case/Reject, since this is closer to
// housekeeping than a review decision. Blocked once a Case exists
// (status "job_assigned") — that's a live operational record at that
// point, managed through the Case itself, not deleted outright. Removes
// the bridged Candidate too (cascades its Application, Documents, and
// CandidateMessage thread) — a partial delete that orphaned one or the
// other would be worse than not deleting at all.
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, [...DELETE_ROLES]);
  if (guardRes) return guardRes;

  const { id } = await params;

  const partnerCandidate = await prisma.partnerCandidate.findUnique({ where: { id, status: { not: "draft" } } });
  if (!partnerCandidate) {
    return NextResponse.json({ error: { code: "not_found", message: "Partner candidate submission not found." } }, { status: 404 });
  }
  if (partnerCandidate.status === "job_assigned") {
    return NextResponse.json(
      { error: { code: "case_exists", message: "A case has already been created for this submission — manage or close it from the Case instead of deleting." } },
      { status: 409 }
    );
  }

  const db = auditedPrisma(user!.userId);
  await db.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.partnerCandidate.delete({ where: { id } });
    if (partnerCandidate.bridged_candidate_id) {
      await tx.candidate.delete({ where: { id: partnerCandidate.bridged_candidate_id } });
    }
  });

  return NextResponse.json({ data: { id } });
}
