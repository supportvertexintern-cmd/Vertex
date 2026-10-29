import { prisma } from "@/lib/prisma";

// Referral commissions are earned in the pipeline, which FastAPI writes
// since the switch (docs/architecture/pipeline-handover.md, step 6.7):
// vertex_be/app/services/referrals.py (commission_if_due, the milestone
// triggers, the duplicate-referral flag). What's left here is the agents'
// own referral codes, which stay with the website's referral agent sign-up.

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
