import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
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
export async function GET(req: Request) {
  const limited = await limitByIp(req, "apply-options", { max: 60 });
  if (limited) return limited;
  const [countries, locationCountries, documentTypes, documentRequirements, intakeModeSetting] = await Promise.all([
    prisma.country.findMany({
      where: { region: { name: "Europe" } },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.country.findMany({
      where: { region: { name: { not: "Europe" } } },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.documentRequirementType.findMany({
      orderBy: [{ sort_order: "asc" }, { created_at: "asc" }],
    }),
    prisma.countryDocumentRequirement.findMany({
      select: { country_id: true, document_type: true },
    }),
    // Defaults "email" (not "crm") when unset — the site is meant to be
    // deployable to the main domain before the CRM's staff workflows are
    // signed off, so an unconfigured deployment must fail safe toward not
    // touching the CRM, not the other way around.
    prisma.systemSetting.findUnique({ where: { key: "intake_mode" } }),
  ]);

  const intakeMode = intakeModeSetting?.value === "crm" ? "crm" : "email";

  return NextResponse.json({ countries, locationCountries, documentTypes, documentRequirements, intakeMode });
}
