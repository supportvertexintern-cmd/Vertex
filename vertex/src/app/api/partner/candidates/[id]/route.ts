import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auditedPrisma } from "@/lib/audit";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { updatePartnerCandidateDetailsSchema } from "@/lib/validations";
import { deleteUploadedFile } from "@/lib/upload";

// GET /api/partner/candidates/:id — a partner's own detail view of one
// submission (SRS FR-5.1, 2026-07-31) — scoped to the caller's own
// Partner.id, same as the list endpoint; no visibility into any other
// agency's candidates.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, ["partner"]);
  if (guardRes) return guardRes;

  const partner = await prisma.partner.findUnique({ where: { user_id: user!.userId } });
  if (!partner) return NextResponse.json({ error: { code: "not_found", message: "Partner record not found." } }, { status: 404 });

  const { id } = await params;

  const candidate = await prisma.partnerCandidate.findUnique({
    where: { id, status: { not: "draft" } },
    include: {
      job: { select: { id: true, title: true, country: true, city: true, service_fee_gbp: true, is_credit_service: true, financing_percent: true, installment_count: true } },
      job_position: { select: { title: true, city: true, job_sector: { select: { sector: true } } } },
      current_location_country: { select: { name: true } },
      // Documents uploaded while this row was still a draft (2026-09-09) —
      // reparented onto bridged_candidate's own documents once submitted,
      // so this array is only ever populated pre-submission.
      documents: { select: { id: true, type: true, label: true, uploaded_at: true } },
      bridged_candidate: {
        select: {
          id: true,
          documents: { select: { id: true, type: true, verification_status: true, uploaded_at: true, label: true } },
        },
      },
    },
  });
  if (!candidate || candidate.partner_id !== partner.id) {
    return NextResponse.json({ error: { code: "not_found", message: "Submission not found." } }, { status: 404 });
  }

  return NextResponse.json({ data: candidate });
}

// PATCH /api/partner/candidates/:id — a partner correcting their own
// submitted candidate's personal-info fields post-submission (CRM
// Comments item 6, 2026-08-10) — previously they could only upload/
// replace documents, not fix a typo'd name or passport number without
// messaging staff. Writes both the PartnerCandidate row and, where
// already bridged, the overlapping fields on the real Candidate record
// too, so the correction actually flows through to the CRM/Case — same
// precedent as the 2026-08-04 HR/Operations editing batch.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, ["partner"]);
  if (guardRes) return guardRes;

  const partner = await prisma.partner.findUnique({ where: { user_id: user!.userId } });
  if (!partner) return NextResponse.json({ error: { code: "not_found", message: "Partner record not found." } }, { status: 404 });

  const { id } = await params;

  const existing = await prisma.partnerCandidate.findUnique({ where: { id, status: { not: "draft" } } });
  if (!existing || existing.partner_id !== partner.id) {
    return NextResponse.json({ error: { code: "not_found", message: "Submission not found." } }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: { code: "invalid_json", message: "Invalid JSON" } }, { status: 400 });
  }

  const parsed = updatePartnerCandidateDetailsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "validation_error", message: "Validation failed", details: parsed.error.flatten().fieldErrors } },
      { status: 422 }
    );
  }

  // Programme Information (2026-09-03) — a partner correcting their own
  // submission's Country/Sector/Position choice post-submission, same
  // capability staff already have via ApplicationEditDetails. Validated
  // the same way POST /api/partner/candidates does at submission time:
  // job_id must exist, and job_position_id (if given) must actually
  // belong to the EFFECTIVE job_id — never trusted from the client's own
  // pairing. If job_id changes without an explicit job_position_id, the
  // old position almost certainly no longer belongs to the new job, so
  // it's cleared rather than left silently mismatched.
  if (parsed.data.job_id) {
    const job = await prisma.job.findUnique({ where: { id: parsed.data.job_id } });
    if (!job) {
      return NextResponse.json({ error: { code: "not_found", message: "Selected opportunity not found." } }, { status: 404 });
    }
  }
  let jobPositionId = parsed.data.job_position_id;
  if (jobPositionId) {
    const jobPosition = await prisma.jobPosition.findUnique({ where: { id: jobPositionId }, include: { job_sector: true } });
    const effectiveJobId = parsed.data.job_id ?? existing.job_id;
    if (!jobPosition || jobPosition.job_sector.job_id !== effectiveJobId) {
      return NextResponse.json(
        { error: { code: "validation_error", message: "Selected position does not belong to this opportunity." } },
        { status: 422 }
      );
    }
  } else if (jobPositionId === undefined && parsed.data.job_id && parsed.data.job_id !== existing.job_id) {
    jobPositionId = null;
  }

  let currentLocationCountryId: string | undefined;
  if (parsed.data.current_location_country_name) {
    const match = await prisma.country.findFirst({ where: { name: { equals: parsed.data.current_location_country_name, mode: "insensitive" } } });
    currentLocationCountryId = match?.id;
  }

  const db = auditedPrisma(user!.userId);

  const updated = await db.partnerCandidate.update({
    where: { id },
    data: {
      job_id: parsed.data.job_id,
      job_position_id: jobPositionId,
      full_name: parsed.data.full_name,
      email: parsed.data.email,
      nationality: parsed.data.nationality,
      second_nationality: parsed.data.second_nationality,
      gender: parsed.data.gender,
      passport_number: parsed.data.passport_number,
      date_of_birth: parsed.data.date_of_birth ? new Date(parsed.data.date_of_birth) : undefined,
      passport_expiry: parsed.data.passport_expiry ? new Date(parsed.data.passport_expiry) : undefined,
      current_occupation: parsed.data.current_occupation,
      highest_education: parsed.data.highest_education,
      home_address: parsed.data.home_address,
      whatsapp_number: parsed.data.whatsapp_number,
      marital_status: parsed.data.marital_status,
      earliest_travel_date: parsed.data.earliest_travel_date ? new Date(parsed.data.earliest_travel_date) : undefined,
      prior_eu_visa_applied: parsed.data.prior_eu_visa_applied,
      prior_eu_visa_applied_details: parsed.data.prior_eu_visa_applied_details,
      current_location_country_name: parsed.data.current_location_country_name,
      current_location_country_id: currentLocationCountryId,
      holds_schengen_visa: parsed.data.holds_schengen_visa,
      holds_schengen_visa_details: parsed.data.holds_schengen_visa_details,
      prior_visa_refusals: parsed.data.prior_visa_refusals,
      prior_visa_refusals_details: parsed.data.prior_visa_refusals_details,
      available_for_embassy_appointment: parsed.data.available_for_embassy_appointment,
      willing_to_start_within_30_days: parsed.data.willing_to_start_within_30_days,
      preferred_contact_channel: parsed.data.preferred_contact_channel,
      documents_available: parsed.data.documents_available,
      payment_plan_acknowledged: parsed.data.payment_plan_acknowledged,
    },
  });

  // Keep the bridged Candidate/Application records in sync too, so the
  // correction actually flows through to the CRM/Case — same precedent as
  // the 2026-08-04 HR/Operations editing batch and the staff-facing
  // PATCH /api/candidates/:id/application route.
  if (existing.bridged_candidate_id) {
    await db.candidate.update({
      where: { id: existing.bridged_candidate_id },
      data: {
        full_name: parsed.data.full_name,
        email: parsed.data.email,
        nationality: parsed.data.nationality,
        second_nationality: parsed.data.second_nationality,
        gender: parsed.data.gender,
        passport_number: parsed.data.passport_number,
        date_of_birth: parsed.data.date_of_birth ? new Date(parsed.data.date_of_birth) : undefined,
        passport_expiry: parsed.data.passport_expiry ? new Date(parsed.data.passport_expiry) : undefined,
        current_occupation: parsed.data.current_occupation,
        highest_education: parsed.data.highest_education,
        home_address: parsed.data.home_address,
        whatsapp_number: parsed.data.whatsapp_number,
        marital_status: parsed.data.marital_status,
      },
    });

    const application = await prisma.application.findFirst({
      where: { candidate_id: existing.bridged_candidate_id },
      orderBy: { submitted_at: "desc" },
    });
    if (application) {
      await db.application.update({
        where: { id: application.id },
        data: {
          job_id: parsed.data.job_id,
          job_position_id: jobPositionId,
          earliest_travel_date: parsed.data.earliest_travel_date ? new Date(parsed.data.earliest_travel_date) : undefined,
          prior_eu_visa_applied: parsed.data.prior_eu_visa_applied,
          prior_eu_visa_applied_details: parsed.data.prior_eu_visa_applied_details,
          current_location_country_name: parsed.data.current_location_country_name,
          current_location_country_id: currentLocationCountryId,
          holds_schengen_visa: parsed.data.holds_schengen_visa,
          holds_schengen_visa_details: parsed.data.holds_schengen_visa_details,
          prior_visa_refusals: parsed.data.prior_visa_refusals,
          prior_visa_refusals_details: parsed.data.prior_visa_refusals_details,
          available_for_embassy_appointment: parsed.data.available_for_embassy_appointment,
          willing_to_start_within_30_days: parsed.data.willing_to_start_within_30_days,
          preferred_contact_channel: parsed.data.preferred_contact_channel,
        },
      });
    }
  }

  return NextResponse.json({ data: updated });
}

// DELETE /api/partner/candidates/:id — a partner abandoning their own
// unfinished draft (2026-09-09). Restricted to status "draft" — a real
// submission can never be self-deleted by the partner, only rejected by
// HR. The new Document.partner_candidate_id FK's onDelete: Cascade only
// cleans up the DB rows once the PartnerCandidate itself is deleted; the
// underlying R2 objects need an explicit deleteUploadedFile call first, or
// an abandoned draft's files leak in the bucket forever.
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, ["partner"]);
  if (guardRes) return guardRes;

  const partner = await prisma.partner.findUnique({ where: { user_id: user!.userId } });
  if (!partner) return NextResponse.json({ error: { code: "not_found", message: "Partner record not found." } }, { status: 404 });

  const { id } = await params;

  const existing = await prisma.partnerCandidate.findUnique({
    where: { id },
    include: { documents: { select: { storage_path: true } } },
  });
  if (!existing || existing.partner_id !== partner.id) {
    return NextResponse.json({ error: { code: "not_found", message: "Submission not found." } }, { status: 404 });
  }
  if (existing.status !== "draft") {
    return NextResponse.json({ error: { code: "invalid_state", message: "Only an unsubmitted draft can be deleted." } }, { status: 409 });
  }

  for (const doc of existing.documents) {
    await deleteUploadedFile(doc.storage_path);
  }

  const db = auditedPrisma(user!.userId);
  await db.partnerCandidate.delete({ where: { id } });

  return NextResponse.json({ message: "Draft deleted." });
}
