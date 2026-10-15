import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auditedPrisma } from "@/lib/audit";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { savePartnerCandidateDraftSchema } from "@/lib/validations";

// POST /api/partner/candidates/draft — save an in-progress Agency
// Application Form submission (2026-09-09), so a partner doesn't have to
// finish everything in one sitting to avoid losing their work. Every field
// is optional (savePartnerCandidateDraftSchema) — no job-active check, no
// position-belongs-to-job check, no document-completeness gate, since none
// of that applies until the partner actually finishes and submits via
// POST /api/partner/candidates/:id/submit. Same role guard as the fresh-
// submission POST /api/partner/candidates, for the same reason (staff
// entering a partner's paper-form backlog on their behalf may also want to
// save partial progress).
export async function POST(req: NextRequest) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, ["partner", "hr", "operations_team", "operations_director", "admin"]);
  if (guardRes) return guardRes;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: { code: "invalid_json", message: "Invalid JSON" } }, { status: 400 });
  }

  const parsed = savePartnerCandidateDraftSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "validation_error", message: "Validation failed", details: parsed.error.flatten().fieldErrors } },
      { status: 422 }
    );
  }

  const partner =
    user!.role === "partner"
      ? await prisma.partner.findUnique({ where: { user_id: user!.userId } })
      : parsed.data.partner_id
      ? await prisma.partner.findUnique({ where: { id: parsed.data.partner_id } })
      : null;
  if (!partner) {
    return NextResponse.json(
      {
        error: {
          code: "not_found",
          message: user!.role === "partner" ? "Partner record not found." : "partner_id is required and must reference a real partner.",
        },
      },
      { status: user!.role === "partner" ? 404 : 422 }
    );
  }

  const currentLocationCountry = parsed.data.current_location_country_name
    ? await prisma.country.findFirst({ where: { name: { equals: parsed.data.current_location_country_name, mode: "insensitive" } } })
    : null;

  const db = auditedPrisma(user!.userId);
  const draft = await db.partnerCandidate.create({
    data: {
      partner_id: partner.id,
      status: "draft",
      drafted_at: new Date(),
      drafted_by: user!.userId,
      full_name: parsed.data.full_name,
      nationality: parsed.data.nationality,
      date_of_birth: parsed.data.date_of_birth ? new Date(parsed.data.date_of_birth) : undefined,
      passport_number: parsed.data.passport_number,
      passport_expiry: parsed.data.passport_expiry ? new Date(parsed.data.passport_expiry) : undefined,
      email: parsed.data.email,
      second_nationality: parsed.data.second_nationality,
      gender: parsed.data.gender,
      current_occupation: parsed.data.current_occupation,
      highest_education: parsed.data.highest_education,
      home_address: parsed.data.home_address,
      whatsapp_number: parsed.data.whatsapp_number,
      marital_status: parsed.data.marital_status,
      job_id: parsed.data.job_id,
      job_position_id: parsed.data.job_position_id,
      earliest_travel_date: parsed.data.earliest_travel_date ? new Date(parsed.data.earliest_travel_date) : undefined,
      prior_eu_visa_applied: parsed.data.prior_eu_visa_applied,
      prior_eu_visa_applied_details: parsed.data.prior_eu_visa_applied_details,
      documents_available: parsed.data.documents_available ?? [],
      payment_plan_acknowledged: parsed.data.payment_plan_acknowledged ?? false,
      current_location_country_name: parsed.data.current_location_country_name,
      current_location_country_id: currentLocationCountry?.id,
      holds_schengen_visa: parsed.data.holds_schengen_visa,
      holds_schengen_visa_details: parsed.data.holds_schengen_visa_details,
      prior_visa_refusals: parsed.data.prior_visa_refusals,
      prior_visa_refusals_details: parsed.data.prior_visa_refusals_details,
      available_for_embassy_appointment: parsed.data.available_for_embassy_appointment ?? false,
      willing_to_start_within_30_days: parsed.data.willing_to_start_within_30_days ?? false,
      preferred_contact_channel: parsed.data.preferred_contact_channel,
    },
  });

  return NextResponse.json({ data: draft }, { status: 201 });
}
