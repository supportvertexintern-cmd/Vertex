import { prisma } from "@/lib/prisma";
import { stripe } from "@/lib/stripe";
import { computePaymentStageAmounts } from "@/lib/fees";

// e.g. "Serbia, Visa D, 6 months" from country: "Serbia", visa_type: "Visa
// D", duration_permit: "6 months · TRC possible" — the simplified name the
// business asked for, derived from the same 3 real seeded Job fields.
function productName(job: { country: string; visa_type: string | null; duration_permit: string | null }): string {
  const duration = job.duration_permit?.split("·")[0]?.trim() ?? "";
  return [job.country, job.visa_type, duration].filter(Boolean).join(", ");
}

/**
 * Provisions (or re-syncs) one Stripe Product/Price per payment stage
 * defined on this Job (2026-09-16, flexible per-Job payment stages — any
 * number of stages, any shape, not just the old fixed 3-value
 * documentation/permit/visa split). Each stage's own `label` (Marketing's
 * own free text, e.g. "At Application", "Installment 2 of 6") becomes the
 * Stripe Price's description, so the candidate/partner sees the same
 * wording on the Stripe-hosted checkout page as everywhere else in the
 * app. Called for every new Job and again whenever an edit touches a
 * fee-relevant field. A Stripe outage/misconfiguration must never block
 * Job creation/editing — every call site wraps this in try/catch and logs
 * rather than letting it throw.
 *
 * Previously this skipped every is_credit_service Job entirely, since
 * their upfront+N-installment shape couldn't be represented by the old
 * fixed-type JobMilestonePrice model — that gap is closed now that every
 * Job's fee schedule (of any shape) lives in payment_stages the same way.
 */
export async function syncJobMilestonePricing(jobId: string): Promise<void> {
  const job = await prisma.job.findUnique({ where: { id: jobId }, include: { payment_stages: { orderBy: { order: "asc" } } } });
  // General-programme Job with no fee, or no payment stages defined yet:
  // nothing to provision.
  if (!job || !job.service_fee_gbp || job.payment_stages.length === 0) return;

  const name = productName(job);
  const amounts = computePaymentStageAmounts(job.service_fee_gbp, job.payment_stages.map((s: (typeof job.payment_stages)[number]) => s.percent));
  const stagesWithAmounts = job.payment_stages.map((s: (typeof job.payment_stages)[number], i: number) => ({ ...s, amount: amounts[i] }));

  for (const stage of stagesWithAmounts) {
    if (stage.amount <= 0) continue; // e.g. a 0% "Upfront" stage — nothing to charge for this one

    if (!stage.stripe_product_id || !stage.stripe_price_id) {
      const product = await stripe.products.create({ name, description: stage.label });
      const price = await stripe.prices.create({
        product: product.id,
        unit_amount: Math.round(stage.amount * 100),
        currency: "gbp",
      });
      await stripe.products.update(product.id, { default_price: price.id });
      await prisma.jobPaymentStage.update({
        where: { id: stage.id },
        data: { stripe_product_id: product.id, stripe_price_id: price.id, synced_amount_gbp: stage.amount },
      });
      continue;
    }

    if (stage.synced_amount_gbp !== stage.amount) {
      // Stripe Prices are immutable — create a new Price on the same
      // existing Product and repoint default_price at it, rather than
      // piling up duplicate Products per opportunity every time a fee
      // changes.
      const price = await stripe.prices.create({
        product: stage.stripe_product_id,
        unit_amount: Math.round(stage.amount * 100),
        currency: "gbp",
      });
      await stripe.products.update(stage.stripe_product_id, { default_price: price.id });
      await prisma.jobPaymentStage.update({
        where: { id: stage.id },
        data: { stripe_price_id: price.id, synced_amount_gbp: stage.amount },
      });
    }
    // else: amount unchanged since last sync — no-op.
  }
}
