// Supervisory Reporting Framework §7's 5-point rating scale, applied to
// the weighted overall score (areas' weights sum to 1.00, so the overall
// score is already on the same 1-5 scale) — thresholds are this
// implementation's own reasonable banding, not literal SRS text, since
// the framework states the scale's meanings but not numeric cut points.
const CATEGORY_BANDS: { min: number; category: string; requiredAction: string }[] = [
  { min: 4.5, category: "Exceptional", requiredAction: "Recognition" },
  { min: 3.5, category: "Strong", requiredAction: "Maintain" },
  { min: 2.5, category: "Effective", requiredAction: "Coaching" },
  { min: 1.5, category: "Improvement Required", requiredAction: "Improvement Plan" },
  { min: 0, category: "Unsatisfactory", requiredAction: "Formal Review" },
];

export function categorizeScore(score: number): { category: string; requiredAction: string } {
  const band = CATEGORY_BANDS.find((b) => score >= b.min) ?? CATEGORY_BANDS[CATEGORY_BANDS.length - 1];
  return { category: band.category, requiredAction: band.requiredAction };
}

/** Weighted sum of rated areas, rounded to 2 decimal places (a /5.00 score). */
export function computeOverallScore(areas: { weight: number; rating: number | null }[]): number {
  return Math.round(areas.reduce((sum, a) => sum + a.weight * (a.rating ?? 0), 0) * 100) / 100;
}
