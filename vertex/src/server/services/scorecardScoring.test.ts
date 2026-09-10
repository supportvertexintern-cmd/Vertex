import { describe, it, expect } from "vitest";
import { computeOverallScore, categorizeScore } from "./scorecardScoring";
import { SCORECARD_AREAS } from "@/lib/validations";

describe("SCORECARD_AREAS", () => {
  it("weights sum to exactly 1.00, per the framework's own table", () => {
    const total = SCORECARD_AREAS.reduce((sum, a) => sum + a.weight, 0);
    expect(Math.round(total * 100) / 100).toBe(1);
  });
});

describe("computeOverallScore", () => {
  it("computes the weighted sum across every area", () => {
    const areas = [
      { weight: 0.2, rating: 4 },
      { weight: 0.2, rating: 4 },
      { weight: 0.15, rating: 5 },
      { weight: 0.15, rating: 4 },
      { weight: 0.15, rating: 3 },
      { weight: 0.1, rating: 4 },
      { weight: 0.05, rating: 5 },
    ];
    // 0.8 + 0.8 + 0.75 + 0.6 + 0.45 + 0.4 + 0.25 = 4.05
    expect(computeOverallScore(areas)).toBe(4.05);
  });

  it("treats an unrated area as a zero contribution", () => {
    expect(computeOverallScore([{ weight: 0.5, rating: null }, { weight: 0.5, rating: 5 }])).toBe(2.5);
  });

  it("a perfect scorecard scores exactly 5.00", () => {
    const areas = SCORECARD_AREAS.map((a) => ({ weight: a.weight, rating: 5 }));
    expect(computeOverallScore(areas)).toBe(5);
  });
});

describe("categorizeScore", () => {
  it("bands scores per the framework's 5-point scale", () => {
    expect(categorizeScore(5)).toEqual({ category: "Exceptional", requiredAction: "Recognition" });
    expect(categorizeScore(4)).toEqual({ category: "Strong", requiredAction: "Maintain" });
    expect(categorizeScore(3)).toEqual({ category: "Effective", requiredAction: "Coaching" });
    expect(categorizeScore(2)).toEqual({ category: "Improvement Required", requiredAction: "Improvement Plan" });
    expect(categorizeScore(1)).toEqual({ category: "Unsatisfactory", requiredAction: "Formal Review" });
  });

  it("handles boundary values at each band's minimum", () => {
    expect(categorizeScore(4.5).category).toBe("Exceptional");
    expect(categorizeScore(4.49).category).toBe("Strong");
    expect(categorizeScore(0).category).toBe("Unsatisfactory");
  });
});
