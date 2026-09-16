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
// EXACTLY to totalGbp rather than drifting by a penny across several
// independent roundings.
//
// Takes/returns plain percent/amount arrays (in the same order) rather
// than trying to generically merge amounts onto the caller's own stage
// objects — callers zip the result back onto their own richer stage data
// by index (`stages.map((s, i) => ({ ...s, amount: amounts[i] }))`),
// which is simpler and avoids TypeScript generic-inference pitfalls that
// come with returning `T & { amount: number }`.
export function computePaymentStageAmounts(totalGbp: number, percents: number[]): number[] {
  if (percents.length === 0) return [];
  let allocated = 0;
  return percents.map((percent, i) => {
    if (i === percents.length - 1) {
      return round2(totalGbp - allocated);
    }
    const amount = round2((totalGbp * percent) / 100);
    allocated += amount;
    return amount;
  });
}
