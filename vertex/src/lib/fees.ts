function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// Generalizes the old fixed-shape computeMilestoneSplit (a hardcoded
// 25%/25%/50%, or the two_stage_pricing 50%/0%/50% variant) and
// computeCreditServiceSchedule (one upfront payment + N *equal*
// installments) into a single function that works for any number of
// stages in any percentage split (2026-09-16, flexible per-Job payment
// stages — see JobPaymentStage in schema.prisma). Every stage's amount is
// computed independently from its own percent except the last, which
// absorbs whatever rounding remainder is left, so the stages always sum
// EXACTLY to the staged portion of the fee rather than drifting by a
// penny across several independent roundings.
//
// The staged portion is (sum of percents / 100) × totalGbp — which equals
// totalGbp exactly when the plan totals 100%, but is LESS for financed/
// credit programmes (2026-10-04) where the marketed stages cover only part
// of the fee and the balance is repaid out-of-band. The remainder absorbed
// by the last stage is therefore capped at that staged portion; letting it
// absorb up to totalGbp would have silently inflated the final stage to
// collect the full fee even when the plan only adds up to e.g. 30%.
//
// Takes/returns plain percent/amount arrays (in the same order) rather
// than trying to generically merge amounts onto the caller's own stage
// objects — callers zip the result back onto their own richer stage data
// by index (`stages.map((s, i) => ({ ...s, amount: amounts[i] }))`),
// which is simpler and avoids TypeScript generic-inference pitfalls that
// come with returning `T & { amount: number }`.
export function computePaymentStageAmounts(totalGbp: number, percents: number[]): number[] {
  if (percents.length === 0) return [];
  const totalPercent = percents.reduce((sum, p) => sum + p, 0);
  const stagedTotal = round2((totalGbp * totalPercent) / 100);
  let allocated = 0;
  return percents.map((percent, i) => {
    if (i === percents.length - 1) {
      return round2(stagedTotal - allocated);
    }
    const amount = round2((totalGbp * percent) / 100);
    allocated += amount;
    return amount;
  });
}

export interface PaymentPlanBalance {
  hasBalance: boolean;
  /** Percent of the fee left uncovered by the stages (0 when the plan is full). */
  balancePercent: number;
  /** GBP value of that uncovered portion (0 when the plan is full). */
  balanceAmount: number;
}

// The portion of a Job's service fee NOT covered by its payment stages.
// Financed/credit programmes deliberately stage only part of the fee
// through the platform — the remainder is still owed and repaid separately
// (e.g. monthly instalments after employment starts). Every payment-plan
// display must state this balance explicitly, or a sub-100% sum reads as a
// discount when the full service fee still holds (2026-10-04). Float noise
// is treated as a full plan with a wide-enough tolerance to absorb repeated
// decimals entered by marketing (e.g. three 33.33% stages sum to
// 99.98999999999999 — a gap of ~0.01 from pure representation error);
// genuine financed balances are integer percents (70%, 90%, 100%…), so a
// 0.02 band never hides a real balance.
export function computePaymentPlanBalance(totalGbp: number, percents: number[]): PaymentPlanBalance {
  const collected = percents.reduce((sum, p) => sum + p, 0);
  if (collected >= 100 || Math.abs(100 - collected) < 0.02) {
    return { hasBalance: false, balancePercent: 0, balanceAmount: 0 };
  }
  const balancePercent = round2(100 - collected);
  return { hasBalance: true, balancePercent, balanceAmount: round2((totalGbp * balancePercent) / 100) };
}
