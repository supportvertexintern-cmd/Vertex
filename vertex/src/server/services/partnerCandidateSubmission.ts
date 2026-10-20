import type { Partner, PartnerCandidate } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { auditedPrisma } from "@/lib/audit";
import { z } from "zod";
import type { submitPartnerCandidateSchema } from "@/lib/validations";
import { getRequiredDocumentTypesForCountryIds } from "@/server/services/documentCompleteness";
import { isNonProgrammeTypeKey } from "@/lib/documentTypes";

type SubmitData = z.infer<typeof submitPartnerCandidateSchema>;

type FinalizeResult =
  | { ok: true; candidate: { id: string }; application: { id: string }; partnerCandidate: PartnerCandidate }
  | { ok: false; status: number; code: string; message: string };

// Shared by POST /api/partner/candidates (fresh submission) and
// POST /api/partner/candidates/[id]/submit (finalizing a draft) — the same
// job-active / position-belongs-to-job / document-completeness validation,
// and the same Candidate+Application+PartnerCandidate materialization,
// whether this is a brand-new PartnerCandidate row or an existing draft
// being upgraded in place (2026-09-09). Extracted rather than duplicated
// so both call sites stay in sync as this validation evolves.
export async function finalizeSubmission({
  db,
  partner,
  data,
  existingPartnerCandidateId,
  submittedBy,
}: {
  db: ReturnType<typeof auditedPrisma>;
  partner: Partner;
  data: SubmitData;
  existingPartnerCandidateId?: string;
  // The logged-in user who clicked "Submit Candidate" — the partner
  // themselves, or HR/Operations entering on the partner's behalf.
  submittedBy: string;
}): Promise<FinalizeResult> {
  const [job, currentLocationCountry] = await Promise.all([
    prisma.job.findUnique({ where: { id: data.job_id } }),
    // current_location_country_name is a free choice from the full
    // world-country list, not a Country FK — resolve it against Vertex's
    // admin-managed Country rows by name (case-insensitive), same
    // best-effort pattern applications/route.ts already uses. Stays null
    // when it doesn't match one of Vertex's actual reference-data
    // countries — the raw name is preserved either way.
    prisma.country.findFirst({ where: { name: { equals: data.current_location_country_name, mode: "insensitive" } } }),
  ]);
  // Distinct "closed" vs "doesn't exist" message (2026-09-15) — a closed
  // job is already excluded from the partner form's own job picker, but a
  // stale/pre-loaded picker (open before the job was closed) or an
  // in-progress draft saved against it beforehand could still reach this
  // check at final submission.
  if (!job) {
    return { ok: false, status: 404, code: "not_found", message: "Opportunity not found." };
  }
  if (job.status !== "active") {
    return { ok: false, status: 404, code: "programme_closed", message: "Applications for this programme are closed." };
  }

  // Duplicate-passport block (2026-09-14) — platform-wide, not scoped to
  // this partner: a passport number already on file from ANY partner's
  // still-live submission blocks a second one. Deliberately excludes
  // "draft" (never actually submitted) and "rejected" (an explicitly
  // supported resubmission-after-correction path elsewhere in this
  // codebase — rejection is never a dead end) — neither counts as an
  // existing submission to collide with. The id-not-equal exclusion
  // matters for the finalize-a-draft path, so a draft's own row (which
  // already holds this same passport number) doesn't block itself.
  const duplicate = await prisma.partnerCandidate.findFirst({
    where: {
      passport_number: data.passport_number,
      status: { notIn: ["draft", "rejected"] },
      ...(existingPartnerCandidateId ? { id: { not: existingPartnerCandidateId } } : {}),
    },
  });
  if (duplicate) {
    return {
      ok: false,
      status: 422,
      code: "duplicate_passport",
      message: "A submission with this passport number is already on file. If you believe this is an error, contact Vertex.",
    };
  }

  // Sector -> Opportunity -> Position (2026-09-02) — same server-side
  // consistency check as the internal CIF's own route.
  if (data.job_position_id) {
    const jobPosition = await prisma.jobPosition.findUnique({
      where: { id: data.job_position_id },
      include: { job_sector: true },
    });
    if (!jobPosition || jobPosition.job_sector.job_id !== job.id) {
      return { ok: false, status: 422, code: "validation_error", message: "Selected position does not belong to this opportunity." };
    }
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
    (t) => !isNonProgrammeTypeKey(t)
  );
  const missingTypes = requiredTypes.filter((t) => !data.documents_available.includes(t));
  if (missingTypes.length > 0) {
    return { ok: false, status: 422, code: "documents_incomplete", message: `Missing required documents: ${missingTypes.join(", ")}` };
  }

  // Wrapped in a transaction (2026-08-07) — a real incident: a bug in the
  // Application create below (prior_eu_visa_applied's String->Boolean
  // conversion) threw partway through this sequence, and because these
  // were three independent writes, every failed retry left behind an
  // orphaned Candidate row with no Application/PartnerCandidate — invisible
  // to HR's review queue (which only reads PartnerCandidate) but visible
  // wherever staff browse Candidate rows directly, confusingly showing up
  // as unexplained duplicates. A transaction makes a mid-sequence failure
  // roll back to nothing instead of a partial, orphaned record.
  const { candidate, application, partnerCandidate } = await db.$transaction(async (tx) => {
    // Personal-info fields → Candidate. No country_id/country_name is set —
    // a partner-sourced candidate deliberately never enters a recruiter's or
    // country supervisor's scoped queue (both key off Candidate.country_id),
    // only Director/Management (unrestricted scope) and the sourcing partner
    // itself. consent_given mirrors the existing recruiter/self-service
    // create path — the partner's own submission is itself the attestation,
    // same as a staff-entered lead.
    const candidate = await tx.candidate.create({
      data: {
        full_name: data.full_name,
        nationality: data.nationality,
        date_of_birth: new Date(data.date_of_birth),
        passport_number: data.passport_number,
        passport_expiry: new Date(data.passport_expiry),
        second_nationality: data.second_nationality,
        gender: data.gender,
        current_occupation: data.current_occupation,
        highest_education: data.highest_education,
        home_address: data.home_address,
        whatsapp_number: data.whatsapp_number,
        email: data.email,
        marital_status: data.marital_status,
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
        job_position_id: data.job_position_id,
        earliest_travel_date: new Date(data.earliest_travel_date),
        prior_eu_visa_applied: data.prior_eu_visa_applied,
        prior_eu_visa_applied_details: data.prior_eu_visa_applied_details,
        documents_available: data.documents_available,
        payment_plan_acknowledged: data.payment_plan_acknowledged,
        current_location_country_name: data.current_location_country_name,
        current_location_country_id: currentLocationCountry?.id,
        holds_schengen_visa: data.holds_schengen_visa,
        holds_schengen_visa_details: data.holds_schengen_visa_details,
        prior_visa_refusals: data.prior_visa_refusals,
        prior_visa_refusals_details: data.prior_visa_refusals_details,
        available_for_embassy_appointment: data.available_for_embassy_appointment,
        willing_to_start_within_30_days: data.willing_to_start_within_30_days,
        preferred_contact_channel: data.preferred_contact_channel,
      },
    });

    const partnerCandidateData = {
      partner_id: partner.id,
      bridged_candidate_id: candidate.id,
      status: "submitted" as const,
      submitted_at: new Date(),
      submitted_by: submittedBy,
      full_name: data.full_name,
      nationality: data.nationality,
      date_of_birth: new Date(data.date_of_birth),
      passport_number: data.passport_number,
      passport_expiry: new Date(data.passport_expiry),
      email: data.email,
      second_nationality: data.second_nationality,
      gender: data.gender,
      current_occupation: data.current_occupation,
      highest_education: data.highest_education,
      home_address: data.home_address,
      whatsapp_number: data.whatsapp_number,
      marital_status: data.marital_status,
      job_id: job.id,
      job_position_id: data.job_position_id,
      earliest_travel_date: new Date(data.earliest_travel_date),
      prior_eu_visa_applied: data.prior_eu_visa_applied,
      prior_eu_visa_applied_details: data.prior_eu_visa_applied_details,
      documents_available: data.documents_available,
      payment_plan_acknowledged: data.payment_plan_acknowledged,
      current_location_country_name: data.current_location_country_name,
      current_location_country_id: currentLocationCountry?.id,
      holds_schengen_visa: data.holds_schengen_visa,
      holds_schengen_visa_details: data.holds_schengen_visa_details,
      prior_visa_refusals: data.prior_visa_refusals,
      prior_visa_refusals_details: data.prior_visa_refusals_details,
      available_for_embassy_appointment: data.available_for_embassy_appointment,
      willing_to_start_within_30_days: data.willing_to_start_within_30_days,
      preferred_contact_channel: data.preferred_contact_channel,
    };

    const partnerCandidate = existingPartnerCandidateId
      ? await tx.partnerCandidate.update({ where: { id: existingPartnerCandidateId }, data: partnerCandidateData })
      : await tx.partnerCandidate.create({ data: partnerCandidateData });

    // Re-parent any documents uploaded while this was still a draft
    // (2026-09-09) onto the newly-created real Candidate — same file, same
    // storage_path, no re-upload. From this point on they're
    // indistinguishable from any other candidate's documents.
    if (existingPartnerCandidateId) {
      await tx.document.updateMany({
        where: { partner_candidate_id: existingPartnerCandidateId },
        data: { candidate_id: candidate.id },
      });
    }

    return { candidate, application, partnerCandidate };
  });

  return { ok: true, candidate, application, partnerCandidate };
}
