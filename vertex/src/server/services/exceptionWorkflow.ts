import type { EscalationLevel, Role } from "@prisma/client";

export const ESCALATION_LEVEL_ORDER: EscalationLevel[] = ["regional", "country", "inhouse", "management"];

// The lowest tier a given role is trusted to act on (escalate/decide) —
// matches Supervisory Reporting Framework §6's escalation path (Regional
// Recruiter → Country Supervisor → In-House Supervisor → Management).
export const MIN_ACTIONABLE_LEVEL_BY_ROLE: Partial<Record<Role, EscalationLevel>> = {
  country_supervisor: "country",
  inhouse_supervisor: "inhouse",
  director: "management",
  admin: "regional",
};

/** Advances one tier up the escalation line; stays at "management" once there. */
export function nextEscalationLevel(current: EscalationLevel): EscalationLevel {
  const idx = ESCALATION_LEVEL_ORDER.indexOf(current);
  return ESCALATION_LEVEL_ORDER[Math.min(idx + 1, ESCALATION_LEVEL_ORDER.length - 1)];
}

/**
 * Whether a role is trusted to act (escalate/decide) on an exception
 * currently sitting at the given level — country-scoping (is this
 * requester's assigned country the same as the exception's) is a
 * separate, DB-dependent check layered on top by the API route; this is
 * just the role/tier part, kept pure so it's unit-testable.
 */
export function roleCanActOnLevel(role: Role, level: EscalationLevel): boolean {
  if (role === "admin") return true;
  const minLevel = MIN_ACTIONABLE_LEVEL_BY_ROLE[role];
  if (!minLevel) return false;
  return ESCALATION_LEVEL_ORDER.indexOf(level) >= ESCALATION_LEVEL_ORDER.indexOf(minLevel);
}
