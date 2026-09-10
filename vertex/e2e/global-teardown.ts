import { config } from "dotenv";
import path from "path";
config({ path: path.resolve(__dirname, "../.env") });

import { PrismaClient } from "@prisma/client";

// E2E tests exercise the real dev server/database (there's no separate test
// instance to spin up cheaply) — this sweeps up anything the suite created
// so dev data doesn't accumulate across runs. Scoped to the "e2e-" prefix
// specifically (not all of @test.local) so it never touches manually
// created dev fixtures that happen to share the .test.local convention.
export default async function globalTeardown() {
  const prisma = new PrismaClient();
  try {
    // Candidates lose their recruiter_id (SetNull) rather than being
    // deleted when the recruiter is removed, so clean them up explicitly
    // first — otherwise every run leaves an orphaned candidate behind.
    await prisma.candidate.deleteMany({
      where: { recruiter: { email: { startsWith: "e2e-", endsWith: "@test.local" } } },
    });
    // Same reasoning as the recruiter cleanup above — a candidate loses its
    // partner_id (SetNull) rather than being deleted when the partner is
    // removed, so sweep candidates first (belt-and-braces: the recruiter
    // cleanup above should already have caught it via round-robin
    // assignment, but this covers the case where that assignment fails).
    await prisma.candidate.deleteMany({ where: { partner: { name: "E2E Test Partner" } } });
    // PartnerCandidate.preferred_country_1/current_location_country are
    // Restrict FKs (not SetNull/Cascade) — must go before Country/Region
    // cleanup below, or deleting "E2E Country" fails with a constraint
    // violation. Partner's own cascade would eventually clean these up too,
    // but only after Country deletion has already run, which is too late.
    await prisma.partnerCandidate.deleteMany({ where: { partner: { name: "E2E Test Partner" } } });
    await prisma.partner.deleteMany({ where: { name: "E2E Test Partner" } });
    await prisma.user.deleteMany({ where: { email: { startsWith: "e2e-", endsWith: "@test.local" } } });
    await prisma.country.deleteMany({ where: { name: "E2E Country" } });
    await prisma.region.deleteMany({ where: { name: "E2E Region" } });
    // Application rows cascade with the Job (onDelete: Cascade in schema).
    await prisma.job.deleteMany({ where: { title: "E2E Test Job" } });
  } finally {
    await prisma.$disconnect();
  }
}
