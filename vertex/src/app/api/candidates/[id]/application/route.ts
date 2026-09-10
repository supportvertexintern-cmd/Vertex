import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auditedPrisma } from "@/lib/audit";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { canAccessCandidate } from "@/server/scope";
import { updateApplicationDetailsSchema } from "@/lib/validations";

// PATCH /api/candidates/:id/application — staff correcting the programme/
// travel/visa-readiness fields captured on a candidate's most recent
// Application (CRM Comments follow-up, 2026-08-10). These were previously
// frozen forever after submission for every pipeline — only the Candidate
// model's own personal-info fields were staff-editable (PATCH
// /api/candidates/:id), never earliest_travel_date, the visa questions,
// current location, or contact-channel preference. Same role tier as that
// route. For a partner-sourced candidate, the bridged PartnerCandidate
// row keeps its own duplicate snapshot of these fields (see POST
// /api/partner/candidates) — updated here too so the two stay in sync,
// same precedent as the 2026-08-04 HR/Operations editing batch.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, [
    "regional_recruiter", "country_supervisor", "admin", "hr", "operations_team", "operations_director", "director",
  ]);
  if (guardRes) return guardRes;

  const { id } = await params;

  const candidate = await prisma.candidate.findUnique({
    where: { id },
    select: { user_id: true, recruiter_id: true, country_id: true, partner_id: true },
  });
  if (!candidate) return NextResponse.json({ error: { code: "not_found", message: "Candidate not found." } }, { status: 404 });

  const allowed = await canAccessCandidate(user!, candidate);
  if (!allowed) return NextResponse.json({ error: { code: "forbidden", message: "Forbidden." } }, { status: 403 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: { code: "invalid_json", message: "Invalid JSON" } }, { status: 400 });
  }

  const parsed = updateApplicationDetailsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "validation_error", message: "Validation failed", details: parsed.error.flatten().fieldErrors } },
      { status: 422 }
    );
  }

  const application = await prisma.application.findFirst({
    where: { candidate_id: id },
    orderBy: { submitted_at: "desc" },
  });
  if (!application) {
    return NextResponse.json({ error: { code: "not_found", message: "No application on file for this candidate." } }, { status: 404 });
  }

  if (parsed.data.job_id) {
    const job = await prisma.job.findUnique({ where: { id: parsed.data.job_id } });
    if (!job) {
      return NextResponse.json({ error: { code: "not_found", message: "Selected opportunity not found." } }, { status: 404 });
    }
  }

  let currentLocationCountryId: string | undefined;
  if (parsed.data.current_location_country_name) {
    const match = await prisma.country.findFirst({ where: { name: { equals: parsed.data.current_location_country_name, mode: "insensitive" } } });
    currentLocationCountryId = match?.id;
  }

  const db = auditedPrisma(user!.userId);

  const updated = await db.application.update({
    where: { id: application.id },
    data: {
      job_id: parsed.data.job_id,
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

  const partnerCandidate = await prisma.partnerCandidate.findUnique({ where: { bridged_candidate_id: id } });
  if (partnerCandidate) {
    await db.partnerCandidate.update({
      where: { id: partnerCandidate.id },
      data: {
        job_id: parsed.data.job_id,
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

  return NextResponse.json({ data: updated });
}
