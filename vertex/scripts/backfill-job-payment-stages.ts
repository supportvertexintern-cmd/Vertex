import { prisma } from "../src/lib/prisma";
import type { CaseStage } from "@prisma/client";

// One-off migration (2026-09-16) for the flexible per-Job payment stages
// feature — see the approved plan for full context. Two passes:
//
// 1. For every Job with a real service_fee_gbp and no JobPaymentStage rows
//    yet, generate stages reproducing its CURRENT formula exactly
//    (computeMilestoneSplit's 25/25/50 or 50/0/50, or
//    computeCreditServiceSchedule's upfront+N-equal-installments) — so no
//    live pricing silently changes for anyone mid-migration.
// 2. Backfill every existing CasePayment row's new job_payment_stage_id
//    from its old `type`. Production only ever recorded "documentation"
//    and "upfront" types (confirmed against the live DB before writing
//    this), so the mapping below only needs to handle those two plus
//    permit/visa for completeness/future-proofing on dev/test data.
//
// Safe to re-run: stage generation is skipped per-Job once it already has
// payment_stages; backfill only touches rows where job_payment_stage_id
// is still null.
//
//   DATABASE_URL="..." npx tsx scripts/backfill-job-payment-stages.ts

async function main() {
  const jobs = await prisma.job.findMany({ include: { payment_stages: true } });

  console.log(`Found ${jobs.length} job(s).\n`);

  for (const job of jobs) {
    if (job.payment_stages.length > 0) {
      console.log(`- ${job.title}: already has payment_stages, skipping generation`);
      continue;
    }
    if (!job.service_fee_gbp) {
      console.log(`- ${job.title}: no service_fee_gbp, no stages needed`);
      continue;
    }

    let stagesData: { order: number; label: string; percent: number; trigger_stage: CaseStage }[];

    if (job.is_credit_service) {
      if (job.financing_percent == null || job.installment_count == null) {
        console.log(`  ! ${job.title}: is_credit_service but missing financing_percent/installment_count — SKIPPED, needs manual attention`);
        continue;
      }
      const financingPercent = job.financing_percent;
      const installmentCount = job.installment_count;
      const upfrontPercent = 100 - financingPercent;
      stagesData = [{ order: 1, label: "Upfront", percent: upfrontPercent, trigger_stage: "registration_document_submission" }];
      const perInstallment = financingPercent / installmentCount;
      for (let i = 0; i < installmentCount; i++) {
        stagesData.push({
          order: i + 2,
          label: `Installment ${i + 1} of ${installmentCount}`,
          percent: perInstallment,
          trigger_stage: "departure_arrival_support",
        });
      }
    } else if (job.two_stage_pricing) {
      stagesData = [
        { order: 1, label: "Documentation", percent: 50, trigger_stage: "registration_document_submission" },
        { order: 2, label: "Visa", percent: 50, trigger_stage: "visa_interview_decision" },
      ];
    } else {
      stagesData = [
        { order: 1, label: "Documentation", percent: 25, trigger_stage: "registration_document_submission" },
        { order: 2, label: "Work Permit", percent: 25, trigger_stage: "permit_authorization_approved" },
        { order: 3, label: "Visa", percent: 50, trigger_stage: "visa_interview_decision" },
      ];
    }

    await prisma.jobPaymentStage.createMany({
      data: stagesData.map((s) => ({ ...s, job_id: job.id })),
    });
    console.log(`- ${job.title}: created ${stagesData.length} payment stage(s) (${stagesData.map((s) => `${s.label} ${s.percent}%`).join(", ")})`);
  }

  const payments = await prisma.casePayment.findMany({
    where: { job_payment_stage_id: null },
    include: { case: { include: { application: { select: { job_id: true } } } } },
  });

  console.log(`\nBackfilling ${payments.length} CasePayment row(s) with no job_payment_stage_id yet...`);

  let backfilled = 0;
  let skipped = 0;
  for (const payment of payments) {
    const jobId = payment.case.application.job_id;
    if (!jobId) {
      console.log(`  ! CasePayment ${payment.id}: case's application has no linked Job — cannot backfill (type=${payment.type})`);
      skipped++;
      continue;
    }
    const stages: { id: string; order: number; label: string }[] = await prisma.jobPaymentStage.findMany({ where: { job_id: jobId }, orderBy: { order: "asc" } });

    let targetStage;
    if (payment.type === "documentation") targetStage = stages.find((s: (typeof stages)[number]) => s.order === 1);
    else if (payment.type === "upfront") targetStage = stages.find((s: (typeof stages)[number]) => s.label === "Upfront") ?? stages.find((s: (typeof stages)[number]) => s.order === 1);
    else if (payment.type === "permit") targetStage = stages.find((s: (typeof stages)[number]) => s.label === "Work Permit");
    else if (payment.type === "visa") targetStage = stages.find((s: (typeof stages)[number]) => s.label === "Visa");

    if (!targetStage) {
      console.log(`  ! CasePayment ${payment.id}: no matching stage found for type=${payment.type} on job ${jobId} — SKIPPED, needs manual attention`);
      skipped++;
      continue;
    }

    await prisma.casePayment.update({ where: { id: payment.id }, data: { job_payment_stage_id: targetStage.id } });
    backfilled++;
  }

  console.log(`\nDone. Backfilled ${backfilled}, skipped ${skipped}.`);
  if (skipped > 0) {
    console.log("WARNING: some rows were skipped — resolve these manually before dropping the old `type` column.");
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
