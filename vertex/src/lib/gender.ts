// Standardized gender options (2026-08-18, business-requested) — mandatory
// on both the Partner and Direct Candidate Application Forms. One shared
// list so the dropdown UI and the Zod validation enum can't drift apart,
// same pattern as maritalStatus.ts. Values match the Gender enum in
// schema.prisma exactly.
export const GENDER_VALUES = ["male", "female"] as const;

export const GENDER_OPTIONS = [
  { value: "male", label: "Male" },
  { value: "female", label: "Female" },
];
