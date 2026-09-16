import { NextRequest, NextResponse, after } from "next/server";
import type { Prisma, CandidateSource } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { auditedPrisma } from "@/lib/audit";
import { submitApplicationSchema } from "@/lib/validations";
import { getAuthUser, requireAuth, forbidden } from "@/lib/api-auth";
import { isStaffRole } from "@/lib/rbac";
import { canAccessCandidate, scopeCandidatesToRequester } from "@/server/scope";
import { getRequiredDocumentTypesForCountryIds } from "@/server/services/documentCompleteness";
import { rateLimit } from "@/lib/rate-limit";
import { screenAndInvite } from "@/server/services/screening";
import { signCifUploadToken } from "@/lib/jwt";
import { checkReferralDuplicate, generateReferralCommissionIfDue } from "@/lib/referralMilestones";

import { log } from "@/lib/log";
const MAX_PAGE_SIZE = 200;

// GET /api/applications — a candidate sees their own; every staff role
// sees applications scoped exactly like the candidate list itself (SRS
// FR-2.1 "guide and track applications" — a recruiter needs this for
// their own sourced candidates, not just admin). Reuses
// scopeCandidatesToRequester so the two views can never drift apart.
//
// The staff branch is paginated (page/pageSize, defaulting to page 1 /
// 50 rows even if the caller doesn't ask) — at 40-country/800-recruiter
// scale this was a fully unbounded findMany, returning every application
// a country/recruiter has ever had in one response. The candidate branch
// stays unbounded — a single candidate's own application count is small
// by construction, not something that grows with platform-wide volume.
export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
  const guardRes = requireAuth(user);
  if (guardRes) return guardRes;

  if (isStaffRole(user!.role)) {
    const candidateScope = await scopeCandidatesToRequester(user!);
    const page = Math.max(1, Number(req.nextUrl.searchParams.get("page")) || 1);
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(req.nextUrl.searchParams.get("pageSize")) || 50));
    const where = { candidate: candidateScope };

    const [applications, total] = await Promise.all([
      prisma.application.findMany({
        where,
        include: {
          candidate: {
            select: {
              full_name: true,
              documents: { select: { id: true, type: true, verification_status: true } },
              user: { select: { full_name: true, email: true } },
              recruiter: { select: { id: true, full_name: true } },
              country: { select: { id: true, name: true } },
            },
          },
          job: { select: { title: true, country: true, city: true } },
          preferred_country_1: { select: { name: true } },
          preferred_sector: { select: { name: true } },
        },
        orderBy: { submitted_at: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.application.count({ where }),
    ]);
    return NextResponse.json({ data: applications, total, page, pageSize });
  }

  // Candidate: find their own
  const candidate = await prisma.candidate.findUnique({ where: { user_id: user!.userId } });
  if (!candidate) return NextResponse.json({ applications: [] });

  const applications = await prisma.application.findMany({
    where: { candidate_id: candidate.id },
    include: {
      job: { select: { id: true, title: true, country: true, city: true, salary_range: true } },
      preferred_country_1: { select: { name: true } },
      preferred_sector: { select: { name: true } },
    },
    orderBy: { submitted_at: "desc" },
  });

  // Which document types this specific application needs (universal set
  // + its own destination country's extras) — lets the candidate's
  // dashboard show a per-application checklist instead of one flattened,
  // first-application-only list. Batched into one lookup regardless of
  // application count, rather than a query pair per application.
  // A job-linked application (the only kind created going forward,
  // 2026-07-31) has no preferred_country_1_id at all — resolve its
  // destination via Job.country against Vertex's admin-managed Country
  // rows by name (case-insensitive), same pattern as
  // documentCompleteness.ts's own job-linked resolution. Falls back to
  // preferred_country_1_id for historical applications that still have it.
  const jobCountryNames = [
    ...new Set(
      applications
        .filter((a: (typeof applications)[number]) => !a.preferred_country_1_id && a.job)
        .map((a: (typeof applications)[number]) => a.job!.country)
    ),
  ];
  const jobCountries = jobCountryNames.length
    ? await prisma.country.findMany({ where: { name: { in: jobCountryNames, mode: "insensitive" } }, select: { id: true, name: true } })
    : [];
  const jobCountryIdByName = new Map(jobCountries.map((c: (typeof jobCountries)[number]) => [c.name.toLowerCase(), c.id]));
  const countryIdFor = (app: (typeof applications)[number]) =>
    app.preferred_country_1_id ?? (app.job ? (jobCountryIdByName.get(app.job.country.toLowerCase()) ?? null) : null);

  const requiredByCountry = await getRequiredDocumentTypesForCountryIds(applications.map(countryIdFor));
  const withRequirements = applications.map((app: (typeof applications)[number]) => ({
    ...app,
    required_document_types: requiredByCountry.get(countryIdFor(app)) ?? requiredByCountry.get(null) ?? [],
  }));

  return NextResponse.json(withRequirements);
}

// POST /api/applications — the Candidate Information Form. The first
// thing anyone fills in: a candidate submitting anonymously (no account
// yet — the whole point is that screening happens before an account
// exists), a recruiter entering a walk-in lead who has none either, or
// (less commonly now) an existing candidate/lead completing or
// resubmitting theirs. Creating a brand-new Candidate this way sets
// lifecycle_status "identified". A self-service (self_registered)
// candidate is never assigned a recruiter (2026-07-31) — it goes to HR
// for review instead, via the new hr branch on
// /api/candidates/:id/status; only an authenticated regional_recruiter
// submitting their own walk-in lead ever sets recruiter_id, to themself.
export async function POST(req: NextRequest) {
  const user = await getAuthUser(req);

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const parsed = submitApplicationSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten().fieldErrors }, { status: 422 });
  }

  type ExistingCandidate = Prisma.CandidateGetPayload<{
    include: { user: true; documents: { select: { type: true } } };
  }>;

  let candidate: ExistingCandidate | null = null;
  let isNewCandidate = false;

  if (parsed.data.candidate_id) {
    if (!user || !isStaffRole(user.role)) {
      return forbidden({ error: "Only staff can submit an application on behalf of a candidate." });
    }
    candidate = await prisma.candidate.findUnique({
      where: { id: parsed.data.candidate_id },
      include: { user: true, documents: { select: { type: true } } },
    });
    if (!candidate) return NextResponse.json({ error: "Candidate not found." }, { status: 404 });
    if (!(await canAccessCandidate(user, candidate))) {
      return forbidden({ error: "Forbidden." });
    }
  } else if (user && user.role === "candidate") {
    candidate = await prisma.candidate.findUnique({
      where: { user_id: user.userId },
      include: { user: true, documents: { select: { type: true } } },
    });
    if (!candidate) return NextResponse.json({ error: "Candidate profile not found." }, { status: 404 });
  } else if (user && !isStaffRole(user.role)) {
    // An authenticated, non-staff, non-candidate role (shouldn't really
    // exist, but fail closed rather than silently treating them as a new
    // anonymous submitter).
    return forbidden({ error: "Forbidden." });
  } else {
    // Anonymous self-service, or staff entering a brand-new walk-in lead.
    isNewCandidate = true;
  }

  // The CIF collects Section 2 (personal info) every time it's a genuine
  // public self-service submission — not just for a brand-new Candidate,
  // but also a signed-in candidate completing/reviewing their own form.
  // Treated as fresh submitted data folded into this one POST, not a
  // separate PUT against an existing row beforehand (which is fragile
  // exactly when there's nothing on file yet — the common case right
  // after registering). submitApplicationSchema's own superRefine already
  // required these fields above whenever candidate_id was absent — which
  // is exactly the isNewCandidate/signed-in-candidate case here (an
  // anonymous or non-staff-on-behalf request never reaches this point with
  // candidate_id set), so no second parse is needed.
  if (!user) {
    const ip = req.headers.get("x-forwarded-for") ?? "unknown";
    const rl = rateLimit(`applications-new:${ip}`, { max: 5, windowMs: 60_000 });
    if (!rl.success) {
      return NextResponse.json({ error: "Too many submissions. Please try again later." }, { status: 429 });
    }
  }

  // A candidate already mid-pipeline shouldn't be able to submit a second,
  // conflicting Candidate Information Form — resubmission belongs to
  // whichever staff role owns that stage (e.g. a supervisor Return). Not
  // relevant for a brand-new candidate, who by definition has none yet.
  if (candidate) {
    const existing = await prisma.application.findFirst({
      where: { candidate_id: candidate.id, application_status: { not: "rejected" } },
    });
    if (existing) {
      return NextResponse.json({ error: "This candidate already has an active application on file." }, { status: 409 });
    }
  }

  // Section 1 is a single required Job pick (2026-07-31, replacing the old
  // 3-country-alternates + sector cluster). A closed programme is already
  // excluded from every job picker, but a client with a stale/pre-loaded
  // job list (open before it was closed) or a direct ?job= link could
  // still attempt this — distinct message from "doesn't exist at all"
  // (2026-09-15), matching the wording shown elsewhere on the site
  // (/jobs/[id]'s own "No longer accepting applications" state).
  const job = await prisma.job.findUnique({ where: { id: parsed.data.job_id } });
  if (!job) {
    return NextResponse.json({ error: "Opportunity not found." }, { status: 404 });
  }
  if (job.status !== "active") {
    return NextResponse.json({ error: "Applications for this programme are closed." }, { status: 404 });
  }

  // Sector -> Opportunity -> Position (2026-09-02) — a server-side
  // consistency check, not just trusting the client's own derived
  // pairing: the position must actually belong to the submitted job.
  if (parsed.data.job_position_id) {
    const jobPosition = await prisma.jobPosition.findUnique({
      where: { id: parsed.data.job_position_id },
      include: { job_sector: true },
    });
    if (!jobPosition || jobPosition.job_sector.job_id !== job.id) {
      return NextResponse.json({ error: "Selected position does not belong to this opportunity." }, { status: 422 });
    }
  }

  // Ensure payment is completed if fee required. A candidate with no
  // linked account (brand-new, or a recruiter-sourced lead) has no way
  // to have paid themselves — block rather than silently skip the fee
  // requirement.
  if (job.application_fee && job.application_fee > 0) {
    if (!candidate?.user_id) {
      return NextResponse.json({
        error: "This position requires a paid application fee, which only the candidate can pay from their own account. Ask them to create an account first.",
      }, { status: 402 });
    }
    const payment = await prisma.payment.findFirst({
      where: {
        user_id: candidate.user_id,
        job_id: job.id,
        payment_status: "completed"
      }
    });

    if (!payment) {
      return NextResponse.json({
        error: "An application fee is required for this position. Please complete the payment first.",
        requiresPayment: true,
        jobId: job.id
      }, { status: 402 });
    }
  }

  // current_location_country_name is a free choice from the full
  // world-country list, not a Country FK — resolve it against Vertex's
  // admin-managed Country rows by name (case-insensitive) for
  // record-keeping; country_id/current_location_country_id simply stay
  // null when it doesn't match (e.g. a candidate currently in a country
  // Vertex has no operational presence in yet — the raw name is preserved
  // on country_name/current_location_country_name regardless). No longer
  // drives recruiter assignment (2026-07-31) — self-registered candidates
  // are never recruiter-assigned at all.
  const currentLocationCountry = await prisma.country.findFirst({
    where: { name: { equals: parsed.data.current_location_country_name, mode: "insensitive" } },
  });

  const db = auditedPrisma(user?.userId ?? null);

  if (isNewCandidate) {
    const isStaffSubmission = !!user && isStaffRole(user.role);
    // Only an actual Regional Recruiter walking in a new lead self-assigns
    // as the owner — every other case (anonymous self-submission, or any
    // other staff role) gets no recruiter at all. A self-registered
    // candidate goes to HR for review instead (the new hr branch on
    // /api/candidates/:id/status), not a country-based recruiter pickup.
    const recruiterId = user?.role === "regional_recruiter" ? user.userId : null;

    // Referral attribution (2026-08-29) — resolves a ?ref= code captured
    // on /apply (see ApplicationForm.tsx) into a ReferralAgent, only for
    // a genuine self-service submission (never a staff walk-in). An
    // invalid, unknown, or non-active code silently falls through to
    // self_registered — this must never block registration.
    let source: CandidateSource = isStaffSubmission ? "recruiter_sourced" : "self_registered";
    let referralAgentId: string | null = null;
    if (!isStaffSubmission && parsed.data.referral_code) {
      const agent = await prisma.referralAgent.findUnique({ where: { referral_code: parsed.data.referral_code } });
      if (agent && agent.status === "active") {
        source = "referral_sourced";
        referralAgentId = agent.id;
      }
    }

    // Non-null assertions below: submitApplicationSchema's superRefine
    // already required these fields since candidate_id was absent (the
    // only way to reach isNewCandidate: true).
    const newCandidate = await db.candidate.create({
      data: {
        full_name: parsed.data.full_name!,
        nationality: parsed.data.nationality!,
        date_of_birth: new Date(parsed.data.date_of_birth!),
        passport_number: parsed.data.passport_number!,
        passport_expiry: new Date(parsed.data.passport_expiry!),
        second_nationality: parsed.data.second_nationality,
        gender: parsed.data.gender,
        current_occupation: parsed.data.current_occupation,
        highest_education: parsed.data.highest_education,
        home_address: parsed.data.home_address,
        phone: parsed.data.phone!,
        whatsapp_number: parsed.data.whatsapp_number,
        email: parsed.data.email!,
        marital_status: parsed.data.marital_status,
        consent_given: true,
        consent_at: new Date(),
        source,
        recruiter_id: recruiterId,
        referral_agent_id: referralAgentId,
        country_name: parsed.data.current_location_country_name,
        country_id: currentLocationCountry?.id ?? null,
        lifecycle_status: "identified",
      },
      include: { user: true, documents: { select: { type: true } } },
    });
    candidate = newCandidate;

    if (referralAgentId) {
      await checkReferralDuplicate({
        candidateId: newCandidate.id,
        email: newCandidate.email,
        phone: newCandidate.phone,
        passport_number: newCandidate.passport_number,
      });
      await generateReferralCommissionIfDue({ candidateId: newCandidate.id, milestone: "registered", actorId: user?.userId ?? null });
    }
  } else if (user?.role === "candidate") {
    // Signed-in candidate submitting the CIF for the first time (or
    // reviewing/completing it) — the same Section 2 fields as a brand-new
    // Candidate, folded into this one POST rather than a prerequisite PUT.
    // Same non-null-assertion reasoning as above — candidate_id is absent
    // here too (this branch is only reached when it was), so the
    // superRefine already required these fields.
    candidate = await db.candidate.update({
      where: { id: candidate!.id },
      data: {
        full_name: parsed.data.full_name!,
        nationality: parsed.data.nationality!,
        date_of_birth: new Date(parsed.data.date_of_birth!),
        passport_number: parsed.data.passport_number!,
        passport_expiry: new Date(parsed.data.passport_expiry!),
        second_nationality: parsed.data.second_nationality,
        gender: parsed.data.gender,
        current_occupation: parsed.data.current_occupation,
        highest_education: parsed.data.highest_education,
        home_address: parsed.data.home_address,
        phone: parsed.data.phone!,
        whatsapp_number: parsed.data.whatsapp_number,
        email: parsed.data.email!,
        marital_status: parsed.data.marital_status,
        consent_given: true,
        consent_at: new Date(),
      },
      include: { user: true, documents: { select: { type: true } } },
    });
  }

  const activeCandidate = candidate!;

  const application = await db.application.create({
    data: {
      candidate_id: activeCandidate.id,
      job_id: parsed.data.job_id,
      job_position_id: parsed.data.job_position_id,
      cover_letter: parsed.data.cover_letter,
      earliest_travel_date: new Date(parsed.data.earliest_travel_date),
      prior_eu_visa_applied: parsed.data.prior_eu_visa_applied,
      prior_eu_visa_applied_details: parsed.data.prior_eu_visa_applied_details,
      documents_available: parsed.data.documents_available,
      current_location_country_name: parsed.data.current_location_country_name,
      current_location_country_id: currentLocationCountry?.id ?? null,
      holds_schengen_visa: parsed.data.holds_schengen_visa,
      holds_schengen_visa_details: parsed.data.holds_schengen_visa_details,
      prior_visa_refusals: parsed.data.prior_visa_refusals,
      prior_visa_refusals_details: parsed.data.prior_visa_refusals_details,
      available_for_embassy_appointment: parsed.data.available_for_embassy_appointment,
      willing_to_start_within_30_days: parsed.data.willing_to_start_within_30_days,
      preferred_contact_channel: parsed.data.preferred_contact_channel,
      payment_plan_acknowledged: parsed.data.payment_plan_acknowledged,
    },
  });

  // Auto-advance only applies to an existing candidate somehow already at
  // guided_to_apply resubmitting — a brand-new candidate always starts at
  // identified, several stages earlier.
  if (!isNewCandidate && activeCandidate.lifecycle_status === "guided_to_apply") {
    await db.candidate.update({ where: { id: activeCandidate.id }, data: { lifecycle_status: "submitted" } });
  }

  // Screening (and the account-creation invite it triggers on pass) fires
  // immediately for a brand-new self-applicant (2026-08-06) — no manual HR
  // click first. Screening only ever depends on the CIF's own Section 1/2
  // answers, both of which are already on file by this point (the
  // Application row above included), so there's no reason to wait. On
  // pass, also issues a short-lived upload_token scoped to this one
  // candidate so the same browser session can immediately attach real
  // documents for Section 3, before the emailed invite is ever claimed —
  // this candidate has no session and no User account yet, so neither of
  // /api/upload's other two auth paths would work for them otherwise.
  let uploadToken: string | undefined;
  if (isNewCandidate && activeCandidate.source === "self_registered") {
    const result = await screenAndInvite(activeCandidate.id, null);
    if (result.passed) {
      uploadToken = signCifUploadToken(activeCandidate.id);
    }
  }

  const recipientEmail = activeCandidate.user?.email ?? activeCandidate.email;
  const recipientName = activeCandidate.user?.full_name ?? activeCandidate.full_name;
  if (recipientEmail && recipientName) {
    // Deferred via after() (2026-08-06) — notification-only, the
    // Application row above is already the real record, so a slow (or
    // failed) confirmation email shouldn't hold up the response the
    // candidate/recruiter is waiting on. See screening.ts's screenAndInvite
    // for why after() specifically, not a bare un-awaited promise.
    after(async () => {
      try {
        const { sendApplicationConfirmationEmail } = await import("@/lib/email");
        await sendApplicationConfirmationEmail(recipientEmail, recipientName, job?.title ?? "your Vertex programme", !!activeCandidate.user);
      } catch (err) {
        log.error("api.failed_to_trigger_confirmation_email", { err });
      }
    });
  }

  return NextResponse.json({ ...application, upload_token: uploadToken }, { status: 201 });
}
