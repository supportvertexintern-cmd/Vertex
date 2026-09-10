import { describe, it, expect } from "vitest";
import { computeMilestoneSplit } from "./fees";

describe("computeMilestoneSplit", () => {
  it("splits into 25/25/50", () => {
    expect(computeMilestoneSplit(1000)).toEqual({ documentation: 250, permit: 250, visa: 500 });
  });

  // The real bug this replaces: three independent Math.round(total * pct)
  // calls can drift the total by ±1 whenever the total isn't a multiple of
  // 4 — visa absorbs the remainder instead, so the three always sum
  // exactly back to the total.
  it("always sums exactly to the total, even when independent roundings would drift", () => {
    for (const total of [1900, 1901, 1899, 999, 1, 3, 7, 12345]) {
      const split = computeMilestoneSplit(total);
      expect(split.documentation + split.permit + split.visa).toBe(total);
    }
  });

  it("matches the 2026 pricing revision's Bulgaria figure (450/450/900 of 1800 GBP)", () => {
    expect(computeMilestoneSplit(1800)).toEqual({ documentation: 450, permit: 450, visa: 900 });
  });
});
