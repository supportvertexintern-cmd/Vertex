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
