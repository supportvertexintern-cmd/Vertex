import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auditedPrisma } from "@/lib/audit";
import { getAuthUser, requireRole, forbidden } from "@/lib/api-auth";
import { canAccessCandidate } from "@/server/scope";
import { updateCandidateDetailsSchema } from "@/lib/validations";
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
          job: { select: { title: true, country: true, city: true } },
          job_position: { select: { title: true, city: true } },
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

// PATCH /api/candidates/:id — progressive detail edits + consent capture
// (SRS FR-2.5, FR-2.8). Lifecycle status transitions go through
// /status instead, which has its own role-gating and screening checks.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  // hr/operations_team/operations_director (2026-08-04) — same "minor
  // corrections without a full reject/resend cycle" capability the
  // recruiter already had, extended to whoever else now reviews
  // submissions pre-Case (HR: self-applications + partner submissions;
  // Operations: partner submissions, read-only until now). director
  // added (CRM Comments item 5, 2026-08-10) — already had document-upload
  // access on partner applications via the broader isStaffRole check on
  // /api/upload, but was missing from this field-edit guard specifically.
  const guardRes = requireRole(user, [
    "regional_recruiter", "country_supervisor", "admin", "hr", "operations_team", "operations_director", "director",
  ]);
  if (guardRes) return guardRes;

  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: { code: "invalid_json", message: "Invalid JSON" } }, { status: 400 });
  }

  const parsed = updateCandidateDetailsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "validation_error", message: "Validation failed", details: parsed.error.flatten().fieldErrors } },
      { status: 422 }
    );
  }

  const candidate = await prisma.candidate.findUnique({
    where: { id },
    select: { user_id: true, recruiter_id: true, country_id: true },
  });
  if (!candidate) {
    return NextResponse.json({ error: { code: "not_found", message: "Candidate not found." } }, { status: 404 });
  }

  const allowed = await canAccessCandidate(user!, candidate);
  if (!allowed) {
    return forbidden({ error: { code: "forbidden", message: "Forbidden." } });
  }

  const { date_of_birth, passport_expiry, consent_given, ...rest } = parsed.data;

  const updated = await auditedPrisma(user!.userId).candidate.update({
    where: { id },
    data: {
      ...rest,
      ...(date_of_birth ? { date_of_birth: new Date(date_of_birth) } : {}),
      ...(passport_expiry ? { passport_expiry: new Date(passport_expiry) } : {}),
      ...(consent_given !== undefined
        ? { consent_given, consent_at: consent_given ? new Date() : null }
        : {}),
    },
    select: {
      id: true,
      full_name: true,
      nationality: true,
      date_of_birth: true,
      passport_number: true,
      phone: true,
      email: true,
      desired_role: true,
      consent_given: true,
      consent_at: true,
      second_nationality: true,
      gender: true,
      passport_expiry: true,
      current_occupation: true,
      highest_education: true,
      home_address: true,
      whatsapp_number: true,
      marital_status: true,
    },
  });

  return NextResponse.json({ data: updated });
}

// DELETE /api/candidates/:id — remove an erroneous/duplicate/spam
// self-submitted (or recruiter-sourced) application (CRM Comments
// follow-up, 2026-08-12) — HR's/Operations' counterpart to
// DELETE /api/partner-candidates/:id for the partner pipeline. Blocked
// once a Case exists (lifecycle_status "approved") — a live operational
// record at that point, managed through the Case itself. Cascades the
// candidate's Application(s), Documents, and CandidateMessage thread
// (all Cascade-on-delete from Candidate).
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, ["hr", "operations_team", "operations_director", "director", "admin"]);
  if (guardRes) return guardRes;

  const { id } = await params;

  const candidate = await prisma.candidate.findUnique({
    where: { id },
    select: { user_id: true, recruiter_id: true, country_id: true, lifecycle_status: true },
  });
  if (!candidate) {
    return NextResponse.json({ error: { code: "not_found", message: "Candidate not found." } }, { status: 404 });
  }

  const allowed = await canAccessCandidate(user!, candidate);
  if (!allowed) {
    return forbidden({ error: { code: "forbidden", message: "Forbidden." } });
  }

  // A real Case (2026-08-16: checked directly, not inferred from
  // lifecycle_status === "approved" — that assumption broke once Reject
  // Case started moving a rejected candidate's lifecycle_status to
  // "rejected" too, which would otherwise have made a closed-but-real
  // Case's whole history (stage events, payments, contract, the
  // rejection record itself) deletable via Candidate's onDelete: Cascade
  // chain). Blocks deletion regardless of the Case's own status —
  // rejected is a permanent record, not an invitation to erase it.
  const existingCase = await prisma.case.findFirst({ where: { application: { candidate_id: id } }, select: { id: true } });
  if (existingCase) {
    return NextResponse.json(
      { error: { code: "case_exists", message: "A case has already been created for this candidate — manage or close it from the Case instead of deleting." } },
      { status: 409 }
    );
  }

  await auditedPrisma(user!.userId).candidate.delete({ where: { id } });

  return NextResponse.json({ data: { id } });
}
