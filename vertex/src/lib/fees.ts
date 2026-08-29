export interface MilestoneSplit {
  documentation: number;
  permit: number;
  visa: number;
}

// Every work-permit programme in the Service & Pricing List follows the
// same fixed three-stage split of the total service fee (25% / 25% / 50%,
// updated 2026-07-31 for the 2026 pricing revision — was 20% / 40% / 40%)
// — only the total is stored (Job.service_fee_gbp), so the stage amounts
// are derived here, the one shared place, rather than recomputed
// independently by every consumer. documentation and permit round
// independently; visa absorbs whatever's left so all three always sum
// exactly to the total, rather than three independent roundings that can
// drift the total by ±1.
export function computeMilestoneSplit(totalGbp: number): MilestoneSplit {
  const documentation = Math.round(totalGbp * 0.25);
  const permit = Math.round(totalGbp * 0.25);
  const visa = totalGbp - documentation - permit;
  return { documentation, permit, visa };
}

export interface CreditServiceSchedule {
  upfrontGbp: number;
  installmentCount: number;
  installmentAmountGbp: number; // installments 1..N-1
  finalInstallmentAmountGbp: number; // installment N, absorbs the rounding remainder
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// The Credit Service Programme's upfront/installment split (European
// Credit Service Programme, Edition 2026) — a second pricing model
// alongside computeMilestoneSplit's fixed 25/25/50, used only by Jobs with
// is_credit_service: true. financing_percent determines the upfront vs.
// financed split (e.g. 70% financing = 30% upfront); installment_count is
// stored explicitly per Job since it isn't derivable from financing_percent
// alone. Same "compute don't store, absorb rounding remainder into the
// last item" pattern as computeMilestoneSplit, generalized from a fixed
// 3-way whole-pound split to an N-way penny-precision split.
export function computeCreditServiceSchedule(
  totalGbp: number,
  financingPercent: number,
  installmentCount: number
): CreditServiceSchedule {
  const upfrontGbp = round2((totalGbp * (100 - financingPercent)) / 100);
  const financedGbp = totalGbp - upfrontGbp;
  const installmentAmountGbp = round2(financedGbp / installmentCount);
  const finalInstallmentAmountGbp = round2(financedGbp - installmentAmountGbp * (installmentCount - 1));
  return { upfrontGbp, installmentCount, installmentAmountGbp, finalInstallmentAmountGbp };
}
