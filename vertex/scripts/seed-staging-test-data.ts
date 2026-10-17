import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

// One-off: seed staging with realistic candidate/partner/case data covering
// every path touched by the 2026-08-10 CRM Comments batch — self-submitted
// and partner-sourced candidates at various stages, Cases at both
// ops_review_status values, and CasePayments in different states. Run via:
//   DATABASE_URL="<staging url>" npx tsx scripts/seed-staging-test-data.ts
const prisma = new PrismaClient();
const PASSWORD = "TestPassword123!";

async function main() {
  const password_hash = await bcrypt.hash(PASSWORD, 12);

  const countries = await prisma.country.findMany({ take: 5 });
  const jobs = await prisma.job.findMany({ where: { status: "active" }, take: 5 });
  if (countries.length === 0 || jobs.length === 0) throw new Error("Run npm run db:seed against this database first.");

  const adminUserRow = await prisma.user.findUnique({ where: { email: "admin@test.local" } });
  const testPartner = await prisma.partner.findFirst({ where: { name: "Test Partner Agency" } });
  if (!adminUserRow || !testPartner) throw new Error("Run scripts/seed-test-accounts.ts against this database first.");
  // Narrowed to a plain string so the nested helper closures below don't
  // hit "possibly null" (TS control-flow narrowing doesn't reach into
  // nested function declarations).
  const adminUserId = adminUserRow.id;

  // SANISA Travel and Recruitment (CRM Comments item 10) — the real
  // partner the on-behalf-of onboarding flow was built for. No login of
  // its own yet; staff enter its candidates directly. Partner.name has no
  // unique constraint, so find-then-create rather than upsert.
  const existingSanisa = await prisma.partner.findFirst({ where: { name: "SANISA Travel and Recruitment" } });
  const sanisa =
    existingSanisa ??
    (await prisma.partner.create({
      data: {
        name: "SANISA Travel and Recruitment",
        partner_type: "travel_agency",
        country_of_operation: "Morocco",
        business_registration_number: "RC-4471-MA",
        contact_name: "Sanisa Admin",
        contact_email: "contact@sanisa-travel.example",
        contact_phone: "+212 600 000 000",
        status: "active",
        mou_status: "signed",
      },
    }));

  // ---- Self-submitted candidates -----------------------------------
  async function makeSelfCandidate(name: string, email: string, daysAgo: number) {
    const user = await prisma.user.upsert({
      where: { email },
      update: { role: "candidate", password_hash, email_verified: true },
      create: { full_name: name, email, password_hash, role: "candidate", email_verified: true },
    });
    const created_at = new Date(Date.now() - daysAgo * 86400000);
    const candidate = await prisma.candidate.upsert({
      where: { user_id: user.id },
      update: {},
      create: {
        user_id: user.id,
        source: "self_registered",
        lifecycle_status: "submitted",
        country_id: countries[daysAgo % countries.length].id,
        consent_given: true,
        consent_at: created_at,
        created_at,
        screening_result: true,
      },
    });
    const existingApp = await prisma.application.findFirst({ where: { candidate_id: candidate.id } });
    const application =
      existingApp ??
      (await prisma.application.create({
        data: {
          candidate_id: candidate.id,
          job_id: jobs[daysAgo % jobs.length].id,
          submitted_at: created_at,
          payment_plan_acknowledged: true,
        },
      }));
    return { user, candidate, application };
  }

  const grace = await makeSelfCandidate("Grace Achieng", "grace.achieng@staging-test.local", 1);
  const peter = await makeSelfCandidate("Peter Mwangi", "peter.mwangi@staging-test.local", 3);
  const amara = await makeSelfCandidate("Amara Okafor", "amara.okafor@staging-test.local", 6);

  await prisma.candidate.update({ where: { id: peter.candidate.id }, data: { lifecycle_status: "approved" } });
  await prisma.candidate.update({ where: { id: amara.candidate.id }, data: { lifecycle_status: "approved" } });

  // ---- Partner-sourced candidates (Test Partner Agency) -------------
  async function makePartnerCandidate(partnerId: string, name: string, email: string, daysAgo: number, status: "submitted" | "job_assigned") {
    const created_at = new Date(Date.now() - daysAgo * 86400000);
    const job = jobs[daysAgo % jobs.length];
    const country = countries[daysAgo % countries.length];
    // Candidate.email has no unique constraint (a recruiter/partner-sourced
    // lead may share an inbox, etc.) — find-then-create/update instead of
    // upsert, same pattern used elsewhere in this codebase for non-unique
    // lookups.
    const existingCandidate = await prisma.candidate.findFirst({ where: { email } });
    const candidate =
      existingCandidate ??
      (await prisma.candidate.create({
        data: {
          full_name: name,
          email,
          source: "partner_sourced",
          partner_id: partnerId,
          lifecycle_status: status === "job_assigned" ? "approved" : "submitted",
          nationality: country.name,
          date_of_birth: new Date("1994-05-12"),
          passport_number: `P${Math.floor(Math.random() * 9000000 + 1000000)}`,
          passport_expiry: new Date("2029-01-01"),
          consent_given: true,
          consent_at: created_at,
          created_at,
        },
      }));
    const existingApplication = await prisma.application.findFirst({ where: { candidate_id: candidate.id } });
    const application =
      existingApplication ??
      (await prisma.application.create({
        data: {
          candidate_id: candidate.id,
          job_id: job.id,
          submitted_at: created_at,
          earliest_travel_date: new Date(Date.now() + 30 * 86400000),
          current_location_country_id: country.id,
          current_location_country_name: country.name,
          payment_plan_acknowledged: true,
        },
      }));
    const partnerCandidate = await prisma.partnerCandidate.upsert({
      where: { bridged_candidate_id: candidate.id },
      update: { status },
      create: {
        partner_id: partnerId,
        bridged_candidate_id: candidate.id,
        status,
        full_name: name,
        email,
        nationality: country.name,
        date_of_birth: new Date("1994-05-12"),
        passport_number: candidate.passport_number!,
        passport_expiry: new Date("2029-01-01"),
        job_id: job.id,
        earliest_travel_date: new Date(Date.now() + 30 * 86400000),
        current_location_country_id: country.id,
        current_location_country_name: country.name,
        payment_plan_acknowledged: true,
        submitted_at: created_at,
      },
    });
    return { candidate, application, partnerCandidate };
  }

  const fatima = await makePartnerCandidate(testPartner.id, "Fatima Ibrahim", "fatima.ibrahim@staging-test.local", 2, "submitted");
  const david = await makePartnerCandidate(testPartner.id, "David Mensah", "david.mensah@staging-test.local", 4, "job_assigned");
  const john = await makePartnerCandidate(testPartner.id, "John Otieno", "john.otieno@staging-test.local", 5, "job_assigned");

  // ---- Cases (CRM Comments item 3/4 — ops_review_status coverage) ---
  async function makeCase(applicationId: string, opsStatus: "pending" | "confirmed", stage: "registration_document_submission" | "document_preparation_legalization") {
    const existing = await prisma.case.findUnique({ where: { application_id: applicationId } });
    if (existing) return existing;
    const kase = await prisma.case.create({
      data: { application_id: applicationId, current_stage: stage, ops_review_status: opsStatus },
    });
    await prisma.caseStageEvent.create({ data: { case_id: kase.id, stage, owner_id: adminUserId } });
    return kase;
  }

  // Peter (self-submitted): pending ops review — tests the confirmation
  // gate + blocked stage-advance on the self-submitted pipeline.
  const peterCase = await makeCase(peter.application.id, "pending", "registration_document_submission");

  // Amara (self-submitted): confirmed, stage advanced, mixed payments —
  // tests stage-advance-allowed + Finance's "Partially Collected" label.
  const amaraCase = await makeCase(amara.application.id, "confirmed", "document_preparation_legalization");
  const existingAmaraPayments = await prisma.casePayment.count({ where: { case_id: amaraCase.id } });
  if (existingAmaraPayments === 0 && amara.application.job_id) {
    const amaraJobStages = await prisma.jobPaymentStage.findMany({
      where: { job_id: amara.application.job_id },
      orderBy: { order: "asc" },
    });
    const [stage1, stage2] = amaraJobStages;
    if (stage1) {
      await prisma.casePayment.create({
        data: { case_id: amaraCase.id, job_payment_stage_id: stage1.id, amount: 500, status: "collected", recorded_by: adminUserId },
      });
    }
    if (stage2) {
      await prisma.casePayment.create({
        data: { case_id: amaraCase.id, job_payment_stage_id: stage2.id, amount: 500, status: "pending", sent_to_email: amara.user.email, recorded_by: adminUserId },
      });
    }
  }

  // David (partner-sourced): pending ops review — tests the gate applies
  // to the partner pipeline too, not just self-submitted.
  const davidCase = await makeCase(david.application.id, "pending", "registration_document_submission");

  // John (partner-sourced): confirmed, no payments yet — tests Finance's
  // "Awaiting Payment" label + stage-advance-allowed on the partner pipeline.
  const johnCase = await makeCase(john.application.id, "confirmed", "registration_document_submission");

  console.log("Seeded:");
  console.log("  Partner: SANISA Travel and Recruitment —", sanisa.id);
  console.log("  Self-submitted: Grace Achieng (submitted, ready for HR approval)");
  console.log("  Self-submitted: Peter Mwangi (approved, Case pending ops review) —", peterCase.id);
  console.log("  Self-submitted: Amara Okafor (approved, Case confirmed, mixed payments) —", amaraCase.id);
  console.log("  Partner-sourced (Test Partner Agency): Fatima Ibrahim (submitted, not yet bridged to a case)");
  console.log("  Partner-sourced (Test Partner Agency): David Mensah (job_assigned, Case pending ops review) —", davidCase.id);
  console.log("  Partner-sourced (Test Partner Agency): John Otieno (job_assigned, Case confirmed) —", johnCase.id);
}

main().finally(() => prisma.$disconnect());
