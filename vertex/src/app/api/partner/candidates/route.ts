import { NextRequest, NextResponse, after } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { auditedPrisma } from "@/lib/audit";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { submitPartnerCandidateSchema } from "@/lib/validations";
import { getRequiredDocumentTypesForCountryIds } from "@/server/services/documentCompleteness";
import { NON_PROGRAMME_TYPE_KEYS } from "@/lib/documentTypes";

// GET /api/partner/candidates — a partner sees only its own submissions
// (SRS FR-5.1). Scoped by Partner.user_id, not a role-wide query — a
// partner has no visibility into any other agency's candidates.
export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, ["partner"]);
  if (guardRes) return guardRes;

  const partner = await prisma.partner.findUnique({ where: { user_id: user!.userId } });
  if (!partner) return NextResponse.json({ error: { code: "not_found", message: "Partner record not found." } }, { status: 404 });

  const candidates = await prisma.partnerCandidate.findMany({
    where: { partner_id: partner.id },
    include: {
      job: { select: { title: true, country: true, city: true } },
    },
    orderBy: { submitted_at: "desc" },
  });

  // "Needs attention" signals (2026-07-31) — a document HR rejected (the
  // candidate stays exactly where it was; only the document itself needs
  // a new version), or the last message on the thread came from HR/
  // Operations rather than the partner, meaning the ball is in the
  // partner's court. Mirrors the same signals built for HR's own
  // dashboard, from the partner's side of the same data.
  const withSignals = await Promise.all(
    candidates.map(async (c: (typeof candidates)[number]) => {
      if (!c.bridged_candidate_id) {
        return { ...c, has_rejected_document: false, awaiting_partner_reply: false };
      }
      const candidateId = c.bridged_candidate_id;
      const [rejectedCount, lastMessage] = await Promise.all([
        prisma.document.count({ where: { candidate_id: candidateId, verification_status: "rejected" } }),
        prisma.candidateMessage.findFirst({
          where: { candidate_id: candidateId },
          orderBy: { created_at: "desc" },
          select: { sender: { select: { role: true } } },
        }),
      ]);
      return {
        ...c,
        has_rejected_document: rejectedCount > 0,
        awaiting_partner_reply: !!lastMessage && lastMessage.sender.role !== "partner",
      };
    })
  );

  const summary = {
    needs_attention_count: withSignals.filter((c) => c.has_rejected_document || c.awaiting_partner_reply).length,
  };

  return NextResponse.json({ data: withSignals, summary });
}

// POST /api/partner/candidates — the partner's own candidate-submission
// form (Agency Application Form Sections 2-6). Materializes a real
// Candidate + Application immediately (2026-07-27) — a partner has already
// screened/verified this candidate themselves, so it skips Vertex's
// internal recruiter/screening/verification funnel entirely and goes
// straight to an operations review that opens the Case (see
// PATCH /api/partner-candidates/:id/create-case). No User/login is ever
// created here — "candidates submitted by partners will not get their own
// accounts" is a confirmed, deliberate decision, not a gap to fill in
// later. Best-effort notifies staff by email; returns candidateId so the
// form can immediately follow up with real per-file document uploads
// (POST /api/upload?candidate_id=) against it.
export async function POST(req: NextRequest) {
  const user = await getAuthUser(req);
  // hr/operations_team/operations_director/admin (CRM Comments item 10,
  // 2026-08-10) — staff entering a partner's already-vetted, pre-CRM
  // candidates on their behalf (e.g. SANISA Travel and Recruitment's
  // paper-form backlog), since the scanned documents aren't clear enough
  // for the partner to self-serve. A staff caller must supply partner_id
  // explicitly; a partner's own submission still always derives its
  // Partner.id from the login, never from the request body.
  const guardRes = requireRole(user, ["partner", "hr", "operations_team", "operations_director", "admin"]);
  if (guardRes) return guardRes;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: { code: "invalid_json", message: "Invalid JSON" } }, { status: 400 });
  }

  const parsed = submitPartnerCandidateSchema.safeParse(body);
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

  const [job, currentLocationCountry] = await Promise.all([
    prisma.job.findUnique({ where: { id: parsed.data.job_id } }),
    // current_location_country_name is a free choice from the full
    // world-country list, not a Country FK — resolve it against Vertex's
    // admin-managed Country rows by name (case-insensitive), same
    // best-effort pattern applications/route.ts already uses. Stays null
    // when it doesn't match one of Vertex's actual reference-data
    // countries — the raw name is preserved either way.
    prisma.country.findFirst({ where: { name: { equals: parsed.data.current_location_country_name, mode: "insensitive" } } }),
  ]);
  if (!job || job.status !== "active") {
    return NextResponse.json({ error: { code: "not_found", message: "Opportunity not found or no longer active." } }, { status: 404 });
  }

  // Documents are uploaded as real files at submission time (this form has
  // no separate document-review step, unlike the CIF) — enforce server-side
  // that every checklist type the destination country requires is actually
  // ticked, not just left to the client-side Submit-button guard.
  // NON_PROGRAMME_TYPE_KEYS (cv, passport, etc.) are excluded — they're
  // handled by their own dedicated screening-gate upload, never offered as
  // a checklist item on this form, so requiring them here would be
  // permanently unsatisfiable.
  const jobCountry = await prisma.country.findFirst({ where: { name: { equals: job.country, mode: "insensitive" } } });
  const requiredByCountry = await getRequiredDocumentTypesForCountryIds([jobCountry?.id ?? null]);
  const requiredTypes = (requiredByCountry.get(jobCountry?.id ?? null) ?? requiredByCountry.get(null) ?? []).filter(
    (t) => !(NON_PROGRAMME_TYPE_KEYS as readonly string[]).includes(t)
  );
  const missingTypes = requiredTypes.filter((t) => !parsed.data.documents_available.includes(t));
  if (missingTypes.length > 0) {
    return NextResponse.json(
      { error: { code: "documents_incomplete", message: `Missing required documents: ${missingTypes.join(", ")}` } },
      { status: 422 }
    );
  }

  const db = auditedPrisma(user!.userId);

  // Wrapped in a transaction (2026-08-07) — a real incident: a bug in the
  // Application create below (prior_eu_visa_applied's String->Boolean
  // conversion) threw partway through this sequence, and because these
  // were three independent writes, every failed retry left behind an
  // orphaned Candidate row with no Application/PartnerCandidate — invisible
  // to HR's review queue (which only reads PartnerCandidate) but visible
  // wherever staff browse Candidate rows directly, confusingly showing up
  // as unexplained duplicates. A transaction makes a mid-sequence failure
  // roll back to nothing instead of a partial, orphaned record.
  const { candidate, application, partnerCandidate } = await db.$transaction(async (tx: Prisma.TransactionClient) => {
    // Personal-info fields → Candidate. No country_id/country_name is set —
    // a partner-sourced candidate deliberately never enters a recruiter's or
    // country supervisor's scoped queue (both key off Candidate.country_id),
    // only Director/Management (unrestricted scope) and the sourcing partner
    // itself. consent_given mirrors the existing recruiter/self-service
    // create path — the partner's own submission is itself the attestation,
    // same as a staff-entered lead.
    const candidate = await tx.candidate.create({
      data: {
        full_name: parsed.data.full_name,
        nationality: parsed.data.nationality,
        date_of_birth: new Date(parsed.data.date_of_birth),
        passport_number: parsed.data.passport_number,
        passport_expiry: new Date(parsed.data.passport_expiry),
        second_nationality: parsed.data.second_nationality,
        gender: parsed.data.gender,
        current_occupation: parsed.data.current_occupation,
        highest_education: parsed.data.highest_education,
        home_address: parsed.data.home_address,
        whatsapp_number: parsed.data.whatsapp_number,
        email: parsed.data.email,
        marital_status: parsed.data.marital_status,
        consent_given: true,
        consent_at: new Date(),
        source: "partner_sourced",
        partner_id: partner.id,
        lifecycle_status: "submitted",
      },
    });

    // Preference/visa/checklist/payment-plan fields → Application. A
    // partner's submission is always against a specific Job (unlike the
    // CIF's country/sector-only path for a candidate exploring options in
    // general), so job_id is set directly — this is also what
    // /api/cases/:id/payments/link needs to find pre-provisioned Stripe
    // pricing for a partner-bridged case, previously never set at all.
    const application = await tx.application.create({
      data: {
        candidate_id: candidate.id,
        job_id: job.id,
        earliest_travel_date: new Date(parsed.data.earliest_travel_date),
        prior_eu_visa_applied: parsed.data.prior_eu_visa_applied,
        prior_eu_visa_applied_details: parsed.data.prior_eu_visa_applied_details,
        documents_available: parsed.data.documents_available,
        payment_plan_acknowledged: parsed.data.payment_plan_acknowledged,
        current_location_country_name: parsed.data.current_location_country_name,
        current_location_country_id: currentLocationCountry?.id,
        holds_schengen_visa: parsed.data.holds_schengen_visa,
        holds_schengen_visa_details: parsed.data.holds_schengen_visa_details,
        prior_visa_refusals: parsed.data.prior_visa_refusals,
        prior_visa_refusals_details: parsed.data.prior_visa_refusals_details,
        available_for_embassy_appointment: parsed.data.available_for_embassy_appointment,
        willing_to_start_within_30_days: parsed.data.willing_to_start_within_30_days,
        preferred_contact_channel: parsed.data.preferred_contact_channel,
      },
    });

    const partnerCandidate = await tx.partnerCandidate.create({
      data: {
        partner_id: partner.id,
        bridged_candidate_id: candidate.id,
        full_name: parsed.data.full_name,
        nationality: parsed.data.nationality,
        date_of_birth: new Date(parsed.data.date_of_birth),
        passport_number: parsed.data.passport_number,
        passport_expiry: new Date(parsed.data.passport_expiry),
        email: parsed.data.email,
        second_nationality: parsed.data.second_nationality,
        gender: parsed.data.gender,
        current_occupation: parsed.data.current_occupation,
        highest_education: parsed.data.highest_education,
        home_address: parsed.data.home_address,
        whatsapp_number: parsed.data.whatsapp_number,
        marital_status: parsed.data.marital_status,
        job_id: job.id,
        earliest_travel_date: new Date(parsed.data.earliest_travel_date),
        prior_eu_visa_applied: parsed.data.prior_eu_visa_applied,
        prior_eu_visa_applied_details: parsed.data.prior_eu_visa_applied_details,
        documents_available: parsed.data.documents_available,
        payment_plan_acknowledged: parsed.data.payment_plan_acknowledged,
        current_location_country_name: parsed.data.current_location_country_name,
        current_location_country_id: currentLocationCountry?.id,
        holds_schengen_visa: parsed.data.holds_schengen_visa,
        holds_schengen_visa_details: parsed.data.holds_schengen_visa_details,
        prior_visa_refusals: parsed.data.prior_visa_refusals,
        prior_visa_refusals_details: parsed.data.prior_visa_refusals_details,
        available_for_embassy_appointment: parsed.data.available_for_embassy_appointment,
        willing_to_start_within_30_days: parsed.data.willing_to_start_within_30_days,
        preferred_contact_channel: parsed.data.preferred_contact_channel,
      },
    });

    return { candidate, application, partnerCandidate };
  });

  // Deferred via after() (2026-08-06) — Candidate/Application/
  // PartnerCandidate are already committed above, so a slow/failed staff
  // notification shouldn't hold up the partner's own response. See
  // screening.ts's screenAndInvite for why after(), not a bare un-awaited
  // promise.
  after(async () => {
    try {
      const { sendPartnerCandidateSubmittedEmail } = await import("@/lib/email");
      await sendPartnerCandidateSubmittedEmail(partner.name, partnerCandidate.full_name);
    } catch (err) {
      console.error("Failed to send partner-candidate submission notification.", err);
    }
  });

  return NextResponse.json(
    { data: { ...partnerCandidate, candidateId: candidate.id, applicationId: application.id } },
    { status: 201 }
  );
}
