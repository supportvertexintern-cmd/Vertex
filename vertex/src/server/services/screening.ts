import { after } from "next/server";
import { prisma } from "@/lib/prisma";
import { auditedPrisma } from "@/lib/audit";
import { sendCandidateInviteEmail } from "@/lib/email";

export interface ScreeningResult {
  passed: boolean;
  failures: string[];
}

const MINIMUM_AGE_YEARS = 18;
const MINIMUM_PASSPORT_VALIDITY_MONTHS = 6;

type ScreenableCandidate = {
  full_name: string | null;
  nationality: string | null;
  date_of_birth: Date | null;
  passport_number: string | null;
  passport_expiry: Date | null;
  phone: string | null;
  email: string | null;
  consent_given: boolean;
  user: { full_name: string; email: string; phone: string | null } | null;
  applications: {
    job_id: string | null;
    preferred_country_1_id: string | null;
    preferred_sector_id: string | null;
    earliest_travel_date: Date | null;
  }[];
};

function calculateAge(dob: Date): number {
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const monthDiff = now.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < dob.getDate())) {
    age--;
  }
  return age;
}

function monthsUntil(date: Date): number {
  const now = new Date();
  return (date.getFullYear() - now.getFullYear()) * 12 + (date.getMonth() - now.getMonth());
}

/**
 * Screening gate (SRS FR-2.5): evaluated against the Candidate Information
 * Form itself — the candidate's own Section 2 answers plus their
 * Application's Section 1 selections — not against uploaded documents or
 * an account, neither of which exist yet at this point in the real
 * process (the CIF is filled in first, screened, and only then does the
 * candidate get invited to create an account and upload documents).
 * "Role suitability" from FR-2.5 has no dedicated matching model yet
 * (that's Phase 4's Case/stage territory) — represented here as requiring
 * a preferred sector be on file via the CIF, not an actual suitability
 * judgment.
 */
export function evaluateScreeningGate(candidate: ScreenableCandidate): ScreeningResult {
  const failures: string[] = [];

  const fullName = candidate.user?.full_name ?? candidate.full_name;
  const email = candidate.user?.email ?? candidate.email;
  const phone = candidate.user?.phone ?? candidate.phone;

  if (!fullName) failures.push("Full name is missing.");
  if (!candidate.nationality) failures.push("Nationality is missing.");
  if (!candidate.date_of_birth) failures.push("Date of birth is missing.");
  if (!candidate.passport_number) failures.push("Passport number is missing.");
  if (!phone) failures.push("Phone number is missing.");
  if (!email) failures.push("Email address is missing.");

  if (candidate.date_of_birth && calculateAge(candidate.date_of_birth) < MINIMUM_AGE_YEARS) {
    failures.push(`Candidate is under the minimum eligible age of ${MINIMUM_AGE_YEARS}.`);
  }

  if (!candidate.passport_expiry) {
    failures.push("Passport expiry date is missing.");
  } else if (monthsUntil(candidate.passport_expiry) < MINIMUM_PASSPORT_VALIDITY_MONTHS) {
    failures.push(`Passport must have at least ${MINIMUM_PASSPORT_VALIDITY_MONTHS} months' validity remaining.`);
  }

  const application = candidate.applications[0];
  if (!application) {
    failures.push("No Candidate Information Form submission on file.");
  } else {
    // Section 1 is a single required Job pick now (2026-07-31) — job_id
    // alone already implies both a destination and a type of work, so it
    // satisfies both checks at once. Historical applications that predate
    // this change still have preferred_country_1_id/preferred_sector_id
    // instead and are checked the old way.
    if (!application.job_id) {
      if (!application.preferred_country_1_id) failures.push("Preferred programme country is missing.");
      if (!application.preferred_sector_id) failures.push("Preferred type of work is missing.");
    }
    if (!application.earliest_travel_date) failures.push("Earliest possible travel date is missing.");
  }

  if (!candidate.consent_given) failures.push("Candidate consent has not been recorded.");

  return { passed: failures.length === 0, failures };
}

export async function evaluateScreeningGateForCandidateId(candidateId: string): Promise<ScreeningResult> {
  const candidate = await prisma.candidate.findUnique({
    where: { id: candidateId },
    select: {
      full_name: true,
      nationality: true,
      date_of_birth: true,
      passport_number: true,
      passport_expiry: true,
      phone: true,
      email: true,
      consent_given: true,
      user: { select: { full_name: true, email: true, phone: true } },
      applications: {
        where: { application_status: { not: "rejected" } },
        orderBy: { submitted_at: "desc" },
        take: 1,
        select: { job_id: true, preferred_country_1_id: true, preferred_sector_id: true, earliest_travel_date: true },
      },
    },
  });

  if (!candidate) {
    return { passed: false, failures: ["Candidate not found."] };
  }

  return evaluateScreeningGate(candidate);
}

export interface ScreenAndInviteResult extends ScreeningResult {
  candidate?: { id: string; lifecycle_status: string; return_reason: string | null };
}

/**
 * Evaluates the screening gate, persists the result (screening_result is
 * its own standard report-content field regardless of outcome — Regional
 * Supervisory Operational Workflow p.7), and on pass advances the
 * candidate to "screened" and sends the account-creation invite (SRS
 * FR-2.1) — skipped if they already have an account, or there's no email
 * to invite yet (a phone-only lead can still be screened, they just can't
 * self-serve from here).
 *
 * Shared between two callers (2026-08-06): HR's manual PATCH
 * identified→screened action (retained as a retry path for a candidate
 * who initially failed screening and had their data corrected), and the
 * automatic call fired the moment a self-registered candidate submits the
 * CIF — screening only ever depends on the CIF's own Section 1/2 answers,
 * never on documents or an account, so there's no reason to wait for a
 * manual HR click on the common, already-eligible case.
 */
export async function screenAndInvite(candidateId: string, actorId: string | null): Promise<ScreenAndInviteResult> {
  const screening = await evaluateScreeningGateForCandidateId(candidateId);

  const db = auditedPrisma(actorId);
  await db.candidate.update({
    where: { id: candidateId },
    data: { screening_result: screening.passed, screening_evaluated_at: new Date() },
  });

  if (!screening.passed) {
    return screening;
  }

  const updated = await db.candidate.update({
    where: { id: candidateId },
    data: { lifecycle_status: "screened", return_reason: null },
    select: { id: true, lifecycle_status: true, return_reason: true, user_id: true, email: true, full_name: true },
  });

  if (!updated.user_id && updated.email) {
    // Deferred via next/server's after() (2026-08-06), not awaited inline —
    // the CIF submission this is called from was taking 30s-150s+ to
    // respond because live SMTP sends have been observed taking that long.
    // A bare un-awaited promise would risk Vercel freezing the function
    // right after the response is sent, silently killing the send before
    // it completes (the exact reason this used to be awaited) — after()
    // is the platform-supported way to defer work past the response while
    // still guaranteeing it runs to completion.
    after(() => sendCandidateInviteEmail(candidateId, updated.email!, updated.full_name ?? "there").catch(console.error));
  }

  return { passed: true, failures: [], candidate: { id: updated.id, lifecycle_status: updated.lifecycle_status, return_reason: updated.return_reason } };
}
