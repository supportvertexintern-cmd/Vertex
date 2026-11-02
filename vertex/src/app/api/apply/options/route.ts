import { NextResponse } from "next/server";
import { callBackend, legacyErrorResponse } from "@/lib/backend";
import { limitByIp } from "@/lib/rate-limit";
export const dynamic = "force-dynamic";

// GET /api/apply/options — public reference data for the Candidate
// Information Form and the Agency form (PartnerCandidateForm), also reused
// by the partner portal's own document upload picker: destination
// countries, current-location countries, and document requirement types,
// all admin-managed. Destination countries are scoped to the "Europe"
// region — every programme Vertex currently places into is European.
// locationCountries are the source-market regions (Africa, Middle East &
// Gulf) — kept for backward reference, but neither ApplicationForm nor
// PartnerCandidateForm restricts current-location to this list anymore
// (2026-07-31 for the latter) — both offer the full world-country list
// (lib/worldCountries.ts) so a candidate/partner from anywhere can
// complete the form. documentTypes + documentRequirements let a form or
// upload picker render its checklist (and "Required for" hints) entirely
// from admin-managed data — a type/requirement admin adds shows up here
// immediately, no code change needed. Section 1 of both forms is a Job
// picker now (2026-07-31), not a country/sector cluster, so this no
// longer returns sectors or recruiterCountryNames — the latter's only
// purpose (deciding whether a self-submission has a recruiter to fall
// back to) went away along with recruiter assignment for self-registered
// candidates entirely; see /api/jobs for the opportunity list itself.
// Read from FastAPI since reads handover R1 (vertex_be/app/api/v1/public.py),
// which keeps intakeMode "email" unless the admin chose "crm": an
// unconfigured deployment fails safe toward not touching the CRM.
export async function GET(req: Request) {
  const limited = await limitByIp(req, "apply-options", { max: 60 });
  if (limited) return limited;
  const result = await callBackend("/api/v1/apply/options", { asUser: "if-signed-in" });
  return result.ok ? NextResponse.json(result.body.data) : legacyErrorResponse(result);
}
