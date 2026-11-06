import { NextRequest, NextResponse } from "next/server";
import { submitApplicationSchema } from "@/lib/validations";
import { rateLimit, retryAfter } from "@/lib/rate-limit";
import { clientKey } from "@/lib/client-ip";
import { callBackend } from "@/lib/backend";

const FAILED = "We couldn't submit your application right now. Please try again shortly or contact us directly.";

// POST /api/public-intake/application — the temporary bridge for the
// public Candidate Information Form while the site is live on the main
// domain ahead of the CRM's staff workflows being signed off (Admin
// Settings → Public Form Intake Mode). Deliberately writes nothing to the
// CRM (no Candidate/Application, no recruiter assignment) — it just emails
// PUBLIC_FORMS_NOTIFY_EMAIL the same information the CIF collects, plus a
// short confirmation to the applicant. Once staff flip the setting to
// "crm", ApplicationForm posts to /api/applications instead and this route
// stops being used by the public form (though it stays reachable).
//
// FastAPI checks the job and sends both emails since reads handover R7b
// (vertex_be/app/api/v1/public_forms.py); this route keeps the rate limit
// and the form's messages.
export async function POST(req: NextRequest) {
  const ip = clientKey(req.headers);
  const rl = await rateLimit(`public-intake:${ip}`, { max: 5, windowMs: 60_000 });
  if (!rl.success) {
    return NextResponse.json({ error: "Too many submissions. Please try again later." }, { status: 429, headers: { "Retry-After": retryAfter(rl) } });
  }

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const parsed = submitApplicationSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten().fieldErrors }, { status: 422 });
  }

  // Section 2 always comes from the request body, the fields a brand-new
  // CIF collects: this route never sends a candidate_id, so
  // submitApplicationSchema's superRefine required them above.
  const f = parsed.data;
  const sent = await callBackend("/api/v1/public-forms/intake", {
    method: "POST",
    // As the user if signed in: a partner may see a partner-only job.
    asUser: "if-signed-in",
    body: {
      job_id: f.job_id, full_name: f.full_name, email: f.email, phone: f.phone, nationality: f.nationality, passport_number: f.passport_number,
      earliest_travel_date: f.earliest_travel_date, prior_eu_visa_applied: f.prior_eu_visa_applied,
      prior_eu_visa_applied_details: f.prior_eu_visa_applied_details, documents_available: f.documents_available,
      current_location_country_name: f.current_location_country_name, holds_schengen_visa: f.holds_schengen_visa,
      holds_schengen_visa_details: f.holds_schengen_visa_details, prior_visa_refusals: f.prior_visa_refusals,
      prior_visa_refusals_details: f.prior_visa_refusals_details, available_for_embassy_appointment: f.available_for_embassy_appointment,
      willing_to_start_within_30_days: f.willing_to_start_within_30_days, preferred_contact_channel: f.preferred_contact_channel,
      cover_letter: f.cover_letter,
    },
  });
  // A job that isn't found or is closed: its own message (2026-09-15).
  if (!sent.ok) return NextResponse.json({ error: sent.status === 404 ? sent.error.message : FAILED }, { status: sent.status === 404 ? 404 : 502 });

  return NextResponse.json({ success: true }, { status: 201 });
}
