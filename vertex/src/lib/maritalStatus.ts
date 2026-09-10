// Standardized marital status options (2026-08-06, business-requested
// field standardization) — was free text everywhere it appears
// (ApplicationForm.tsx, CandidateProfileForm.tsx, CandidateEditDetails.tsx,
// PartnerCandidateForm.tsx). One shared list so the dropdown UI and the
// Zod validation enum can't drift apart.
export const MARITAL_STATUS_VALUES = ["Single", "Married", "Divorced", "Widowed", "Separated"] as const;

export const MARITAL_STATUS_OPTIONS = MARITAL_STATUS_VALUES.map((v) => ({ value: v, label: v }));
