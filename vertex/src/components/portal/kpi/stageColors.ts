// Ordinal color ramp for the pre-application lifecycle funnel — one hue
// (the brand's midnight green), monotone light→dark, validated with
// scripts/validate_palette.js --ordinal (all 6 checks pass: monotone L,
// adjacent ΔL >= 0.06, light-end contrast >= 2:1 on ivory-50, single hue).
// "identified" is deliberately a neutral gray rather than the ramp's own
// lightest step — it's raw, pre-action inflow, not yet through any real
// screening step, so it reads as a different *kind* of bar, not just the
// lightest one.
export const STAGE_LABELS: Record<string, string> = {
  identified: "Identified",
  screened: "Screened",
  guided_to_apply: "Guided to Apply",
  submitted: "Submitted",
  reported: "Reported",
  verified: "Verified",
  approved: "Approved",
};

export const STAGE_ORDER = ["identified", "screened", "guided_to_apply", "submitted", "reported", "verified", "approved"] as const;

export const STAGE_COLORS: Record<string, string> = {
  identified: "#9ca39c", // neutral gray — pre-action inflow, not part of the validated green ramp
  screened: "#2bc47e",
  guided_to_apply: "#1ca36a",
  submitted: "#17694a",
  reported: "#104f36",
  verified: "#0a3326",
  approved: "#03120d",
};
