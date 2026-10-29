import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { passOn, seg } from "@/lib/pipeline";
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
      job: {
        select: {
          id: true, title: true, country: true, city: true, service_fee_gbp: true, is_credit_service: true,
          payment_stages: { orderBy: { order: "asc" } },
        },
      },
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

// DELETE /api/partner-candidates/:id — an erroneous or duplicate submission,
// with its candidate; refused once a case exists. Written by FastAPI since
// the pipeline switch (step 6.7; vertex_be/app/api/v1/partner_submissions.py).
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, [...DELETE_ROLES]);
  if (guardRes) return guardRes;
  const { id } = await params;
  return passOn(`/api/v1/partner-candidates/${seg(id)}`, { method: "DELETE" });
}
