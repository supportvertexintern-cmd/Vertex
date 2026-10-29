import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { passOn, readJson, seg } from "@/lib/pipeline";
import { getAuthUser, requireRole, forbidden } from "@/lib/api-auth";
import { canAccessCandidate } from "@/server/scope";
import { getRequiredDocumentTypesForCountryIds } from "@/server/services/documentCompleteness";
import { evaluateScreeningGate } from "@/server/services/screening";

const STAFF_ROLES = ["regional_recruiter", "country_supervisor", "inhouse_supervisor", "director", "admin", "hr"] as const;

// GET /api/candidates/:id — single candidate detail, RBAC-scoped.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, [...STAFF_ROLES]);
  if (guardRes) return guardRes;

  const { id } = await params;

  const candidate = await prisma.candidate.findUnique({
    where: { id },
    select: {
      id: true,
      source: true,
      lifecycle_status: true,
      nationality: true,
      date_of_birth: true,
      passport_number: true,
      full_name: true,
      phone: true,
      email: true,
      desired_role: true,
      consent_given: true,
      consent_at: true,
      return_reason: true,
      screening_result: true,
      screening_evaluated_at: true,
      created_at: true,
      user_id: true,
      recruiter_id: true,
      country_id: true,
      country_name: true,
      second_nationality: true,
      gender: true,
      passport_expiry: true,
      current_occupation: true,
      highest_education: true,
      home_address: true,
      whatsapp_number: true,
      marital_status: true,
      user: { select: { full_name: true, email: true, phone: true } },
      recruiter: { select: { id: true, full_name: true } },
      country: { select: { id: true, name: true } },
      referral_agent: { select: { id: true, full_name: true, referral_code: true } },
      referral_duplicate_flag: true,
      documents: { select: { id: true, type: true, verification_status: true, uploaded_at: true, label: true } },
      applications: {
        orderBy: { submitted_at: "desc" },
        select: {
          id: true,
          application_status: true,
          submitted_at: true,
          job_id: true,
          job_position_id: true,
          job: { select: { title: true, country: true, city: true } },
          job_position: { select: { title: true, city: true, job_sector: { select: { sector: true } } } },
          preferred_country_1_id: true,
          preferred_country_1: { select: { id: true, name: true } },
          preferred_country_2: { select: { id: true, name: true } },
          preferred_country_3: { select: { id: true, name: true } },
          preferred_sector_id: true,
          preferred_sector: { select: { id: true, name: true } },
          earliest_travel_date: true,
          prior_eu_visa_applied: true,
          prior_eu_visa_applied_details: true,
          documents_available: true,
          current_location_country: { select: { id: true, name: true } },
          current_location_country_name: true,
          holds_schengen_visa: true,
          holds_schengen_visa_details: true,
          prior_visa_refusals: true,
          prior_visa_refusals_details: true,
          available_for_embassy_appointment: true,
          willing_to_start_within_30_days: true,
          preferred_contact_channel: true,
          payment_plan_acknowledged: true,
          // Whether a real Case exists (2026-08-16) — the UI's own
          // delete-guard used to infer this from lifecycle_status ===
          // "approved", which broke once Reject Case started moving a
          // rejected candidate's lifecycle_status to "rejected" too.
          case: { select: { id: true } },
        },
      },
    },
  });
  if (!candidate) {
    return NextResponse.json({ error: { code: "not_found", message: "Candidate not found." } }, { status: 404 });
  }

  const allowed = await canAccessCandidate(user!, candidate);
  if (!allowed) {
    return forbidden({ error: { code: "forbidden", message: "Forbidden." } });
  }

  // Which document types each application needs (universal set + that
  // application's own destination country's extras), plus the union
  // across all of them for a single "still missing overall" list — see
  // documentCompleteness.ts for why this can't just be the first
  // application's country. Batched into one lookup regardless of
  // application count, rather than a query pair per application. A
  // job-linked application (the only kind created going forward,
  // 2026-07-31) has no preferred_country_1 at all — resolve its
  // destination via Job.country by name instead, same pattern as
  // documentCompleteness.ts's own job-linked resolution.
  const jobCountryNames = [
    ...new Set(
      candidate.applications
        .filter((app: (typeof candidate.applications)[number]) => !app.preferred_country_1 && app.job)
        .map((app: (typeof candidate.applications)[number]) => app.job!.country)
    ),
  ];
  const jobCountries = jobCountryNames.length
    ? await prisma.country.findMany({ where: { name: { in: jobCountryNames, mode: "insensitive" } }, select: { id: true, name: true } })
    : [];
  const jobCountryIdByName = new Map(jobCountries.map((c: (typeof jobCountries)[number]) => [c.name.toLowerCase(), c.id]));
  const countryIdFor = (app: (typeof candidate.applications)[number]) =>
    app.preferred_country_1?.id ?? (app.job ? (jobCountryIdByName.get(app.job.country.toLowerCase()) ?? null) : null);

  const requiredByCountry = await getRequiredDocumentTypesForCountryIds(candidate.applications.map(countryIdFor));
  const applicationsWithRequirements = candidate.applications.map((app: (typeof candidate.applications)[number]) => ({
    ...app,
    required_document_types: requiredByCountry.get(countryIdFor(app)) ?? requiredByCountry.get(null) ?? [],
  }));
  const requiredDocumentTypes = [...new Set([...requiredByCountry.values()].flat())];

  // Recomputed read-only for display (2026-08-06) — the actual failure
  // reasons aren't persisted anywhere, only the pass/fail boolean
  // (screening_result), so HR's "why did this fail" view re-derives them
  // from the same CIF data on every load rather than needing a new
  // schema field to store a snapshot that could drift from the real data
  // anyway (e.g. after HR edits the candidate's details).
  const screeningFailures =
    candidate.lifecycle_status === "identified" && candidate.screening_result === false
      ? evaluateScreeningGate(candidate).failures
      : undefined;

  return NextResponse.json({
    data: {
      ...candidate,
      applications: applicationsWithRequirements,
      required_document_types: requiredDocumentTypes,
      screening_failures: screeningFailures,
    },
  });
}

// PATCH and DELETE are written by FastAPI since the pipeline switch (step
// 6.7; vertex_be/app/api/v1/candidates.py): staff corrections and consent
// (SRS FR-2.5, FR-2.8), kept in step with a partner submission's copy; and
// removing an erroneous submission, refused once a case exists.

// PATCH /api/candidates/:id — HR, operations and the director may make the
// same minor corrections the recruiter and supervisor can.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, [
    "regional_recruiter", "country_supervisor", "admin", "hr", "operations_team", "operations_director", "director",
  ]);
  if (guardRes) return guardRes;
  const { id } = await params;
  const read = await readJson(req);
  if (read.invalid) return read.invalid;
  return passOn(`/api/v1/candidates/${seg(id)}`, { method: "PATCH", body: read.body });
}

// DELETE /api/candidates/:id — HR's and operations' counterpart to deleting
// a partner submission.
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, ["hr", "operations_team", "operations_director", "director", "admin"]);
  if (guardRes) return guardRes;
  const { id } = await params;
  return passOn(`/api/v1/candidates/${seg(id)}`, { method: "DELETE" });
}
