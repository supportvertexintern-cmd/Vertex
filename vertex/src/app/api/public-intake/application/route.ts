import { NextRequest, NextResponse, after } from "next/server";
import { prisma } from "@/lib/prisma";
import { submitApplicationSchema } from "@/lib/validations";
import { rateLimit } from "@/lib/rate-limit";
import { sendPublicIntakeEmail, sendPublicIntakeConfirmationEmail } from "@/lib/email";

import { log } from "@/lib/log";
// POST /api/public-intake/application — the temporary bridge for the
// public Candidate Information Form while the site is live on the main
// domain ahead of the CRM's staff workflows being signed off (Admin
// Settings → Public Form Intake Mode). Deliberately writes nothing to the
// CRM (no Candidate/Application, no recruiter assignment) — it just emails
// PUBLIC_FORMS_NOTIFY_EMAIL the same information the CIF collects, plus a
// short confirmation to the applicant. Once staff flip the setting to
// "crm", ApplicationForm posts to /api/applications instead and this route
// stops being used by the public form (though it stays reachable).
export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for") ?? "unknown";
  const rl = rateLimit(`public-intake:${ip}`, { max: 5, windowMs: 60_000 });
  if (!rl.success) {
    return NextResponse.json({ error: "Too many submissions. Please try again later." }, { status: 429 });
  }

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const parsed = submitApplicationSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten().fieldErrors }, { status: 422 });
  }

  // Section 2 always comes from the request body — the same fields a
  // brand-new CIF submission collects — whether or not the submitter is
  // signed in. This route never sends a candidate_id, so
  // submitApplicationSchema's own superRefine already required these
  // fields above; the non-null assertions below just reflect that.
  const fullName = parsed.data.full_name!;
  const email = parsed.data.email!;
  const phone = parsed.data.phone!;
  const nationality = parsed.data.nationality!;
  const passportNumber = parsed.data.passport_number!;

  // Distinct "closed" vs "doesn't exist" message (2026-09-15) — see
  // /api/applications's identical split for the full rationale.
  const job = await prisma.job.findUnique({ where: { id: parsed.data.job_id } });
  if (!job) {
    return NextResponse.json({ error: "Opportunity not found." }, { status: 404 });
  }
  if (job.status !== "active") {
    return NextResponse.json({ error: "Applications for this programme are closed." }, { status: 404 });
  }

  // The email itself is the entire point of this endpoint — unlike other
  // notification emails in lib/email.ts, this one is not swallowed on
  // failure, so the applicant is told their submission didn't go through.
  try {
    await sendPublicIntakeEmail({
      fullName,
      email,
      phone,
      nationality,
      passportNumber,
      jobTitle: job.title,
      jobCountry: job.country,
      jobCity: job.city,
      earliestTravelDate: parsed.data.earliest_travel_date,
      priorEuVisaApplied: parsed.data.prior_eu_visa_applied,
      priorEuVisaAppliedDetails: parsed.data.prior_eu_visa_applied_details,
      documentsAvailable: parsed.data.documents_available,
      currentLocationCountry: parsed.data.current_location_country_name,
      holdsSchengenVisa: parsed.data.holds_schengen_visa,
      holdsSchengenVisaDetails: parsed.data.holds_schengen_visa_details,
      priorVisaRefusals: parsed.data.prior_visa_refusals,
      priorVisaRefusalsDetails: parsed.data.prior_visa_refusals_details,
      availableForEmbassyAppointment: parsed.data.available_for_embassy_appointment,
      willingToStartWithin30Days: parsed.data.willing_to_start_within_30_days,
      preferredContactChannel: parsed.data.preferred_contact_channel,
      coverLetter: parsed.data.cover_letter,
    });
  } catch (error) {
    log.error("api.failed_to_send_public_intake_notification_email", { err: error });
    return NextResponse.json({ error: "We couldn't submit your application right now. Please try again shortly or contact us directly." }, { status: 502 });
  }

  // Deferred via after() (2026-08-06) — the primary notification above
  // already succeeded (that's the real record this endpoint exists to
  // create), so this second, applicant-facing confirmation shouldn't hold
  // up the response. See lib/pipeline.ts (sendNotices) for why after(),
  // not a bare un-awaited promise.
  after(async () => {
    try {
      await sendPublicIntakeConfirmationEmail(email, fullName);
    } catch (error) {
      log.error("api.failed_to_send_public_intake_confirmation_email", { err: error });
    }
  });

  return NextResponse.json({ success: true }, { status: 201 });
}
