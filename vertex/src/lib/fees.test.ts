import { describe, it, expect } from "vitest";
import { computePaymentStageAmounts, computePaymentPlanBalance } from "./fees";

describe("computePaymentStageAmounts", () => {
  it("splits into 25/25/50", () => {
    expect(computePaymentStageAmounts(1000, [25, 25, 50])).toEqual([250, 250, 500]);
  });

  // The real bug this replaces: independent Math.round(total * pct) calls
  // per stage can drift the total by a few pence whenever the total isn't
  // evenly divisible — the last stage absorbs the remainder instead, so
  // every stage's amounts always sum exactly back to the total.
  it("always sums exactly to the total, even when independent roundings would drift", () => {
    for (const total of [1900, 1901, 1899, 999, 1, 3, 7, 12345]) {
      const amounts = computePaymentStageAmounts(total, [25, 25, 50]);
      expect(amounts.reduce((a, b) => a + b, 0)).toBe(total);
    }
  });

  it("matches the 2026 pricing revision's Bulgaria figure (450/450/900 of 1800 GBP)", () => {
    expect(computePaymentStageAmounts(1800, [25, 25, 50])).toEqual([450, 450, 900]);
  });

  describe("two-stage split (e.g. Canada)", () => {
    it("splits 50/50", () => {
      expect(computePaymentStageAmounts(3100, [50, 50])).toEqual([1550, 1550]);
    });

    it("still sums exactly to the total for odd totals", () => {
      for (const total of [1901, 999, 1, 3, 7, 12345]) {
        const amounts = computePaymentStageAmounts(total, [50, 50]);
        expect(amounts.reduce((a, b) => a + b, 0)).toBe(total);
      }
    });
  });

  describe("upfront + N installments (Credit Service Programme)", () => {
    it("splits a 100%-financed plan into a 0 upfront plus equal installments", () => {
      const amounts = computePaymentStageAmounts(1800, [0, ...Array(9).fill(100 / 9)]);
      expect(amounts[0]).toBe(0);
      expect(amounts.reduce((a, b) => a + b, 0)).toBe(1800);
    });

    it("splits a partially-financed plan with an uneven installment count", () => {
      const amounts = computePaymentStageAmounts(2950, [30, ...Array(3).fill(70 / 3)]);
      expect(amounts.reduce((a, b) => a + b, 0)).toBe(2950);
      expect(amounts[0]).toBe(885);
    });
  });

  describe("financed/credit programmes with sub-100% plans (2026-10-04)", () => {
    // The regression this guards: the last stage used to absorb the remainder
    // up to the FULL fee, so a 40%+40% plan silently produced amounts summing
    // to 100% of the fee. Now the last stage only absorbs up to the staged
    // portion ((sum of percents / 100) × total), so a below-100% plan truly
    // collects less than the fee — the balance is repaid out-of-band.
    it("does not inflate the last stage when the plan totals less than 100%", () => {
      expect(computePaymentStageAmounts(3000, [40, 40])).toEqual([1200, 1200]);
      expect(computePaymentStageAmounts(6200, [15, 15])).toEqual([930, 930]); // Canada financed: apply £930 + permit £930
      expect(computePaymentStageAmounts(3200, [15, 15, 70])).toEqual([480, 480, 2240]); // full 100% plan unchanged
    });

    it("keeps a zero-percent middle stage at zero in a 100%-sum plan", () => {
      expect(computePaymentStageAmounts(2600, [10, 0, 90])).toEqual([260, 0, 2340]);
    });

    it("sums exactly to the staged portion when rounding is involved", () => {
      const amounts = computePaymentStageAmounts(1000, [33.33, 33.33, 33.33]);
      expect(amounts).toEqual([333.3, 333.3, 333.3]);
      // 333.3 × 3 is 999.9000000000001 in IEEE754 — compare with tolerance.
      expect(amounts.reduce((a, b) => a + b, 0)).toBeCloseTo(999.9);
    });
  });

  it("returns an empty array for no stages", () => {
    expect(computePaymentStageAmounts(1000, [])).toEqual([]);
  });

  describe("computePaymentPlanBalance", () => {
    it("returns no balance for a full 100% plan", () => {
      expect(computePaymentPlanBalance(3200, [15, 15, 70])).toEqual({ hasBalance: false, balancePercent: 0, balanceAmount: 0 });
      expect(computePaymentPlanBalance(2600, [10, 0, 90])).toEqual({ hasBalance: false, balancePercent: 0, balanceAmount: 0 });
    });

    it("treats float-noise near-100% sums as full plans", () => {
      expect(computePaymentPlanBalance(1000, [33.33, 33.33, 33.33]).hasBalance).toBe(false);
    });

    it("reports the uncovered balance for financed plans", () => {
      // Canada financed (15/15 of £6200): £930 + £930 through the platform, £4,340 still owed
      expect(computePaymentPlanBalance(6200, [15, 15])).toEqual({ hasBalance: true, balancePercent: 70, balanceAmount: 4340 });
      expect(computePaymentPlanBalance(3000, [40, 40])).toEqual({ hasBalance: true, balancePercent: 20, balanceAmount: 600 });
      // Georgia-style: nothing collected through the platform, all £1,200 financed
      expect(computePaymentPlanBalance(1200, [0])).toEqual({ hasBalance: true, balancePercent: 100, balanceAmount: 1200 });
    });

    it("treats an empty plan as fully financed", () => {
      expect(computePaymentPlanBalance(1000, [])).toEqual({ hasBalance: true, balancePercent: 100, balanceAmount: 1000 });
    });
  });
});
