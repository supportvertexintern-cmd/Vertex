import { prisma } from "../src/lib/prisma";
import { syncJobMilestonePricing } from "../src/server/services/stripeProvisioning";

// Bulk-provisions/re-syncs the 3 Stripe Products/Prices (documentation/
// permit/visa) for every active Job — reads DATABASE_URL and
// STRIPE_SECRET_KEY straight from the environment, same as the app itself,
// so pointing this at a different database/Stripe account (e.g. running
// it once against production with the live secret key) needs no code
// changes, just different env vars for this one invocation:
//
//   DATABASE_URL="..." STRIPE_SECRET_KEY="..." npx tsx scripts/sync-stripe-pricing.ts
//
// Safe to re-run — syncJobMilestonePricing no-ops per job/milestone if the
// stored amount already matches, and only creates a new Stripe Price (not
// a duplicate Product) if the fee changed since the last sync.
async function main() {
  const jobs = await prisma.job.findMany({
    where: { status: "active" },
    select: { id: true, title: true, service_fee_gbp: true },
    orderBy: { country: "asc" },
  });

  console.log(`Found ${jobs.length} active job(s).\n`);

  for (const job of jobs) {
    if (!job.service_fee_gbp) {
      console.log(`- ${job.title}: skipped (no service_fee_gbp set)`);
      continue;
    }
    try {
      await syncJobMilestonePricing(job.id);
      const prices = await prisma.jobMilestonePrice.findMany({ where: { job_id: job.id } });
      console.log(`✓ ${job.title}: ${prices.length} milestone price(s) synced`);
    } catch (err) {
      console.error(`✗ ${job.title}: FAILED —`, err instanceof Error ? err.message : err);
    }
  }
}

main().finally(() => prisma.$disconnect());
