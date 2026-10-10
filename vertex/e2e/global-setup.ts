import { config } from "dotenv";
import path from "path";
config({ path: path.resolve(__dirname, "../.env") });

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

// Creates real, known-password accounts for E2E tests that need to exercise
// authenticated access (not just the unauthenticated-redirect path) —
// cleaned up by global-teardown.ts alongside everything else matching
// e2e-*@test.local. A dedicated Region/Country is created too, rather than
// depending on prisma/seed.ts having been run, so this suite is
// self-contained.
// The suite creates and deletes users; never let it near a real database.
export function assertLocalDatabase() {
  const url = process.env.DATABASE_URL ?? "";
  const host = (() => { try { return new URL(url).hostname; } catch { return ""; } })();
  if (!["localhost", "127.0.0.1", "::1", "postgres", "db"].includes(host)) {
    throw new Error(`E2E refuses to run against a non-local database (host "${host || "unset"}"); point DATABASE_URL at a throwaway one`);
  }
}

export default async function globalSetup() {
  assertLocalDatabase();
  const prisma = new PrismaClient();
  try {
    const password_hash = await bcrypt.hash("E2ETestPassword123!", 12);
    await prisma.user.upsert({
      where: { email: "e2e-admin@test.local" },
      update: { role: "admin", password_hash, email_verified: true },
      create: {
        full_name: "E2E Admin",
        email: "e2e-admin@test.local",
        password_hash,
        role: "admin",
        email_verified: true,
      },
    });

    const region = await prisma.region.upsert({
      where: { name: "E2E Region" },
      update: {},
      create: { name: "E2E Region" },
    });
    const country = await prisma.country.upsert({
      where: { name: "E2E Country" },
      update: {},
      create: { name: "E2E Country", region_id: region.id },
    });

    // "Approved by In-House" is a distinct, higher tier than Country
    // Supervisor's "Verified" ceiling (Regional Supervisory Operational
    // Workflow p.5) — tests that need to reach "approved" need a real
    // In-House account, not the country supervisor. In-House's own portal
    // is scoped to their assigned countries exactly like Country
    // Supervisor's — via InhouseCountryAssignment (2026-07, replaces the
    // single assigned_country_id for this one role), or their candidate
    // list scopes to nothing.
    const inhouse = await prisma.user.upsert({
      where: { email: "e2e-inhouse@test.local" },
      update: { role: "inhouse_supervisor", password_hash, email_verified: true },
      create: {
        full_name: "E2E In-House Supervisor",
        email: "e2e-inhouse@test.local",
        password_hash,
        role: "inhouse_supervisor",
        email_verified: true,
      },
    });
    await prisma.inhouseCountryAssignment.upsert({
      where: { inhouse_supervisor_id_country_id: { inhouse_supervisor_id: inhouse.id, country_id: country.id } },
      update: {},
      create: { inhouse_supervisor_id: inhouse.id, country_id: country.id },
    });

    const supervisor = await prisma.user.upsert({
      where: { email: "e2e-supervisor@test.local" },
      update: { role: "country_supervisor", password_hash, email_verified: true, assigned_country_id: country.id },
      create: {
        full_name: "E2E Supervisor",
        email: "e2e-supervisor@test.local",
        password_hash,
        role: "country_supervisor",
        email_verified: true,
        assigned_country_id: country.id,
      },
    });

    await prisma.user.upsert({
      where: { email: "e2e-recruiter@test.local" },
      update: {
        role: "regional_recruiter",
        password_hash,
        email_verified: true,
        assigned_country_id: country.id,
        supervisor_id: supervisor.id,
      },
      create: {
        full_name: "E2E Recruiter",
        email: "e2e-recruiter@test.local",
        password_hash,
        role: "regional_recruiter",
        email_verified: true,
        assigned_country_id: country.id,
        supervisor_id: supervisor.id,
      },
    });

    // Separation-of-duties directorates (2026-07-31, per the Operational
    // Workflow SOP) — unrestricted/global scope, so no country assignment
    // needed, unlike the three-tier hierarchy above.
    await prisma.user.upsert({
      where: { email: "e2e-hr@test.local" },
      update: { role: "hr", password_hash, email_verified: true },
      create: { full_name: "E2E HR", email: "e2e-hr@test.local", password_hash, role: "hr", email_verified: true },
    });
    await prisma.user.upsert({
      where: { email: "e2e-operations@test.local" },
      update: { role: "operations_team", password_hash, email_verified: true },
      create: { full_name: "E2E Operations", email: "e2e-operations@test.local", password_hash, role: "operations_team", email_verified: true },
    });
    await prisma.user.upsert({
      where: { email: "e2e-operations-director@test.local" },
      update: { role: "operations_director", password_hash, email_verified: true },
      create: {
        full_name: "E2E Operations Director",
        email: "e2e-operations-director@test.local",
        password_hash,
        role: "operations_director",
        email_verified: true,
      },
    });
    await prisma.user.upsert({
      where: { email: "e2e-finance@test.local" },
      update: { role: "finance", password_hash, email_verified: true },
      create: { full_name: "E2E Finance", email: "e2e-finance@test.local", password_hash, role: "finance", email_verified: true },
    });

    // Job has no unique field to upsert against — check-then-create.
    const existingJob = await prisma.job.findFirst({ where: { title: "E2E Test Job" } });
    const job =
      existingJob ??
      (await prisma.job.create({
        data: {
          title: "E2E Test Job",
          country: "Kenya",
          city: "Nairobi",
          job_description: "A job created solely for the E2E suite's real-application submission test.",
          requirements: "None — this posting exists only for automated testing.",
          status: "active",
          application_fee: 0,
        },
      }));

    // A candidate with a real, logged-in-able account, already "verified"
    // (one step short of "approved"), and a real, still-pending
    // application — built directly rather than walked through the full
    // Phase 2 screening-gate + invite-email flow (already covered by
    // candidate-lifecycle.spec.ts), so the Phase 4 case-workflow E2E test
    // can focus on what's new: an In-House Supervisor approving the
    // candidate through the real UI (exercising the actual
    // case-auto-creation hook, not a pre-baked one), stage advance, and
    // the candidate signing their own contract.
    const caseCandidateUser = await prisma.user.upsert({
      where: { email: "e2e-case-candidate@test.local" },
      update: { role: "candidate", password_hash, email_verified: true },
      create: {
        full_name: "E2E Case Candidate",
        email: "e2e-case-candidate@test.local",
        password_hash,
        role: "candidate",
        email_verified: true,
      },
    });

    const caseCandidate = await prisma.candidate.upsert({
      where: { user_id: caseCandidateUser.id },
      update: { lifecycle_status: "verified", country_id: country.id },
      // country_id is required for this candidate to appear in In-House's
      // own country-scoped candidate list (In-House Supervisor portal
      // work, this session) — without it, "approved" is unreachable via
      // the real UI flow this test exercises.
      create: { user_id: caseCandidateUser.id, source: "self_registered", lifecycle_status: "verified", country_id: country.id },
    });

    // job_id has no unique constraint against candidate_id anymore
    // (applications are general programme submissions, not tied to a
    // specific job listing) — find-then-create/update instead of upsert.
    const existingCaseApplication = await prisma.application.findFirst({
      where: { candidate_id: caseCandidate.id, job_id: job.id },
    });
    if (existingCaseApplication) {
      await prisma.application.update({
        where: { id: existingCaseApplication.id },
        data: { application_status: "submitted" },
      });
    } else {
      await prisma.application.create({
        data: { candidate_id: caseCandidate.id, job_id: job.id, application_status: "submitted" },
      });
    }
  } finally {
    await prisma.$disconnect();
  }
}
