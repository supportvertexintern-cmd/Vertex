import { prisma } from "@/lib/prisma";
import { paymentReceiptTypeKey } from "@/lib/documentTypes";

// Ensures every one of a Job's payment_stages has a matching
// DocumentRequirementType row to upload a receipt against (2026-09-16,
// flexible per-Job payment stages) — POST /api/upload validates its
// `type` param against this table, and each stage needs its own key so
// two still-pending payments for the same candidate don't clobber each
// other's receipt on upload (see documentTypes.ts for the full
// rationale). Called after every Job create/update that touches
// payment_stages — never blocks the request on failure, same
// fire-and-forget posture as syncJobMilestonePricing.
export async function ensurePaymentReceiptDocumentTypes(jobId: string): Promise<void> {
  const stages = await prisma.jobPaymentStage.findMany({ where: { job_id: jobId } });
  await Promise.all(
    stages.map((stage: (typeof stages)[number]) =>
      prisma.documentRequirementType.upsert({
        where: { key: paymentReceiptTypeKey(stage.id) },
        update: {},
        create: { key: paymentReceiptTypeKey(stage.id), label: `Payment Receipt — ${stage.label}`, is_universal: false },
      })
    )
  );
}
