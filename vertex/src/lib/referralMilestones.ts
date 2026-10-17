import { after } from "next/server";
import type { CaseStageKey } from "@/components/portal/caseStages";
import type { CandidateLifecycleStatus, ReferralMilestone } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { auditedPrisma } from "@/lib/audit";
import { sendReferralCommissionEarnedEmail } from "@/lib/email";
import { log } from "@/lib/log";

// The two lifecycle_status transitions (pre-Case) that map to a referral
// milestone — reuses the exact existing CandidateLifecycleStatus values,
// no parallel status system. "qualified" fires at HR's first approval
// (screening pass); "application_submitted" fires at HR's second
// approval, which is also the exact point a real Case gets created.
export const REFERRAL_LIFECYCLE_TRIGGER: Partial<Record<CandidateLifecycleStatus, ReferralMilestone>> = {
  screened: "qualified",
  approved: "application_submitted",
};

// The three Case.current_stage transitions (post-Case) that map to a
// referral milestone. work_permit_approved/visa_approved deliberately
// reuse the exact same stage keys already established as candidate
// payment-milestone triggers in paymentSchedule.ts's
// MILESTONE_TRIGGER_STAGE — direct, deliberate consistency.
export const REFERRAL_STAGE_TRIGGER: Partial<Record<CaseStageKey, ReferralMilestone>> = {
  permit_authorization_approved: "work_permit_approved",
  visa_interview_decision: "visa_approved",
  departure_arrival_support: "deployed",
};

interface GenerateReferralCommissionArgs {
  candidateId: string;
  milestone: ReferralMilestone;
  caseId?: string;
  actorId: string | null;
}

// Generates a ReferralCommission row for a candidate/milestone pair, if
// (a) the candidate was actually referred, and (b) a row for this exact
// milestone doesn't already exist (idempotency via the unique
// [candidate_id, milestone] constraint). A missing/zero-amount
// ReferralCommissionRule auto-settles the row as "paid" with a £0 amount
// — some milestones legitimately pay nothing, per the business, but the
// event should still be trackable (dashboard "Total Referrals" counts).
// Called synchronously/awaited inline from all 4 hook points — cheap
// single-lookup + single-insert; only the resulting notification email
// defers via after().
export async function generateReferralCommissionIfDue({ candidateId, milestone, caseId, actorId }: GenerateReferralCommissionArgs): Promise<void> {
  const candidate = await prisma.candidate.findUnique({
    where: { id: candidateId },
    select: { referral_agent_id: true, country_id: true, full_name: true },
  });
  if (!candidate?.referral_agent_id) return; // not a referred candidate

  const existing = await prisma.referralCommission.findUnique({
    where: { candidate_id_milestone: { candidate_id: candidateId, milestone } },
  });
  if (existing) return; // already generated — idempotent

  const rule = candidate.country_id
    ? await prisma.referralCommissionRule.findUnique({
        where: { country_id_milestone: { country_id: candidate.country_id, milestone } },
      })
    : null;

  const amount = rule?.amount ?? 0;
  const currency = rule?.currency ?? "USD";

  const commission = await auditedPrisma(actorId).referralCommission.create({
    data: {
      referral_agent_id: candidate.referral_agent_id,
      candidate_id: candidateId,
      case_id: caseId ?? null,
      milestone,
      commission_rule_id: rule?.id ?? null,
      amount,
      currency,
      status: amount > 0 ? "pending" : "paid",
      paid_at: amount > 0 ? null : new Date(),
    },
    include: { referral_agent: { select: { email: true, full_name: true } } },
  });

  if (amount > 0) {
    after(() =>
      sendReferralCommissionEarnedEmail(commission.referral_agent.email, commission.referral_agent.full_name, candidate.full_name ?? "your referral", milestone, amount, currency).catch((err) => log.error("email.send_failed", { err }))
    );
  }
}

interface DuplicateCheckInput {
  candidateId: string;
  email?: string | null;
  phone?: string | null;
  passport_number?: string | null;
}

// Simple, referral-scoped duplicate detection (fraud-prevention basic) —
// matches an existing Candidate by email/phone/passport_number. A match
// flags the new candidate for HR review; it never blocks registration.
// Not a general platform-wide dedup feature — only called for
// referral_sourced candidates, per the business's own "fraud-prevention
// basics" framing.
export async function checkReferralDuplicate({ candidateId, email, phone, passport_number }: DuplicateCheckInput): Promise<boolean> {
  const or: Array<Record<string, string>> = [];
  if (email) or.push({ email });
  if (phone) or.push({ phone });
  if (passport_number) or.push({ passport_number });
  if (or.length === 0) return false;

  const match = await prisma.candidate.findFirst({
    where: { id: { not: candidateId }, OR: or },
    select: { id: true },
  });
  if (!match) return false;

  await prisma.candidate.update({ where: { id: candidateId }, data: { referral_duplicate_flag: true } });
  return true;
}

// VTX-<3-letter-country-fragment>-<4-digit>, e.g. VTX-KEN-1047. Country
// has no ISO-code field, so the fragment is derived from the agent's own
// free-text country (uppercase, letters only, first 3 chars, padded with
// X if short). Retries on collision — cheap since referral_code is
// globally unique and the candidate pool of agents is small.
export async function generateReferralCode(country: string): Promise<string> {
  const fragment = (country.replace(/[^a-zA-Z]/g, "").toUpperCase() + "XXX").slice(0, 3);
  for (let attempt = 0; attempt < 5; attempt++) {
    const suffix = String(Math.floor(1000 + Math.random() * 9000));
    const code = `VTX-${fragment}-${suffix}`;
    const existing = await prisma.referralAgent.findUnique({ where: { referral_code: code }, select: { id: true } });
    if (!existing) return code;
  }
  // Extremely unlikely fallback — timestamp-suffixed, still matches the format.
  return `VTX-${fragment}-${Date.now().toString().slice(-4)}`;
}
