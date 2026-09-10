import { prisma } from "@/lib/prisma";
import { stripe } from "@/lib/stripe";
import { computeMilestoneSplit } from "@/lib/fees";
import type { MilestonePaymentType } from "@prisma/client";

// "First Payment" / "Second Payment" / "Final Payment" — ordinal wording
// matching the reference Stripe-dashboard screenshot, not the internal
// documentation/permit/visa jargon these map to everywhere else. Exported
// so the payment-link email (lib/email.ts) uses the exact same wording
// the candidate/partner will also see on the Stripe-hosted page itself.
export const MILESTONE_DESCRIPTIONS: Record<MilestonePaymentType, string> = {
  documentation: "First Payment",
  permit: "Second Payment",
  visa: "Final Payment",
};

// e.g. "Serbia, Visa D, 6 months" from country: "Serbia", visa_type: "Visa
// D", duration_permit: "6 months · TRC possible" — the simplified name the
// business asked for, derived from the same 3 real seeded Job fields.
function productName(job: { country: string; visa_type: string | null; duration_permit: string | null }): string {
  const duration = job.duration_permit?.split("·")[0]?.trim() ?? "";
  return [job.country, job.visa_type, duration].filter(Boolean).join(", ");
}

/**
 * Provisions (or re-syncs) the 3 Stripe Products/Prices for one opportunity
 * — one per milestone (documentation/permit/visa), each with a one-off
 * Price marked as the product's default_price, exactly how the Stripe
 * dashboard itself creates a product. Called for every new Job and again
 * whenever an edit touches a fee-relevant field. A Stripe outage/
 * misconfiguration must never block Job creation/editing — every call site
 * wraps this in try/catch and logs rather than letting it throw.
 */
export async function syncJobMilestonePricing(jobId: string): Promise<void> {
  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job || !job.service_fee_gbp) return; // general-programme Job with no fee: nothing to provision

  const split = computeMilestoneSplit(job.service_fee_gbp);
  const name = productName(job);

  const milestones: { type: MilestonePaymentType; amount: number }[] = [
    { type: "documentation", amount: split.documentation },
    { type: "permit", amount: split.permit },
    { type: "visa", amount: split.visa },
  ];

  for (const milestone of milestones) {
    const existing = await prisma.jobMilestonePrice.findUnique({
      where: { job_id_type: { job_id: jobId, type: milestone.type } },
    });

    if (!existing) {
      const product = await stripe.products.create({ name, description: MILESTONE_DESCRIPTIONS[milestone.type] });
      const price = await stripe.prices.create({
        product: product.id,
        unit_amount: Math.round(milestone.amount * 100),
        currency: "gbp",
      });
      await stripe.products.update(product.id, { default_price: price.id });
      await prisma.jobMilestonePrice.create({
        data: {
          job_id: jobId,
          type: milestone.type,
          amount_gbp: milestone.amount,
          stripe_product_id: product.id,
          stripe_price_id: price.id,
        },
      });
      continue;
    }

    if (existing.amount_gbp !== milestone.amount) {
      // Stripe Prices are immutable — create a new Price on the same
      // existing Product and repoint default_price at it, rather than
      // piling up duplicate Products per opportunity every time a fee
      // changes.
      const price = await stripe.prices.create({
        product: existing.stripe_product_id,
        unit_amount: Math.round(milestone.amount * 100),
        currency: "gbp",
      });
      await stripe.products.update(existing.stripe_product_id, { default_price: price.id });
      await prisma.jobMilestonePrice.update({
        where: { id: existing.id },
        data: { amount_gbp: milestone.amount, stripe_price_id: price.id },
      });
    }
    // else: amount unchanged since last sync — no-op.
  }
}
