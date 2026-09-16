import { describe, it, expect } from "vitest";
import { computePaymentStageAmounts } from "./fees";

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

  it("returns an empty array for no stages", () => {
    expect(computePaymentStageAmounts(1000, [])).toEqual([]);
  });
});
