import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auditedPrisma } from "@/lib/audit";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { updatePartnerCandidateDetailsSchema } from "@/lib/validations";

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
      job: { select: { title: true, country: true, city: true } },
      current_location_country: { select: { name: true } },
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

  let currentLocationCountryId: string | undefined;
  if (parsed.data.current_location_country_name) {
    const match = await prisma.country.findFirst({ where: { name: { equals: parsed.data.current_location_country_name, mode: "insensitive" } } });
    currentLocationCountryId = match?.id;
  }

  const db = auditedPrisma(user!.userId);

  const updated = await db.partnerCandidate.update({
    where: { id },
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
