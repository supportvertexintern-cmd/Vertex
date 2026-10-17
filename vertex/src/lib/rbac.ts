import type { Role } from "@prisma/client";

/**
 * Central role/portal permission table (SRS FR-1.1, FR-1.2).
 * Every route/page authorization check should read from here rather than
 * reimplementing "who can see what" locally.
 */

// Portal path prefix -> roles allowed to access it.
export const PORTAL_ACCESS: Record<string, Role[]> = {
  "/dashboard": ["candidate"],
  "/recruiter": ["regional_recruiter", "admin"],
  "/supervisor": ["country_supervisor", "admin"],
  "/inhouse": ["inhouse_supervisor", "admin"],
  "/management": ["director", "admin"],
  "/marketing": ["marketing", "admin"],
  "/partner": ["partner", "admin"],
  "/hr": ["hr", "admin"],
  "/operations": ["operations_team", "operations_director", "admin"],
  "/finance": ["finance", "admin"],
  "/admin": ["admin"],
  "/referral-agent": ["referral_agent", "admin"],
};

// Where each role lands after login / when redirected away from a portal it can't access.
export const ROLE_HOME: Record<Role, string> = {
  candidate: "/dashboard",
  regional_recruiter: "/recruiter",
  country_supervisor: "/supervisor",
  inhouse_supervisor: "/inhouse",
  director: "/management",
  marketing: "/marketing/jobs",
  partner: "/partner",
  hr: "/hr",
  operations_team: "/operations",
  operations_director: "/operations",
  finance: "/finance",
  admin: "/admin",
  referral_agent: "/referral-agent",
};

// Roles that manage other staff (used for supervisor-assignment validation,
// SRS FR-1.3) — the three-tier operational hierarchy only. "marketing",
// "partner", and the separation-of-duties roles (hr/operations_team/
// operations_director/finance) are all deliberately excluded: marketing is
// solely responsible for job postings, partner is an external agency's own
// login (SRS FR-5.1), and hr/operations/finance are their own distinct
// directorates (2026-07-31, per the Operational Workflow SOP) — none of
// them are part of this hierarchy, and shouldn't incidentally inherit the
// broader candidate/application access several checks gate on isStaffRole().
export const STAFF_ROLES: Role[] = [
  "regional_recruiter",
  "country_supervisor",
  "inhouse_supervisor",
  "director",
  "admin",
];

export function isStaffRole(role: Role): boolean {
  return STAFF_ROLES.includes(role);
}

// Case-management actions split by directorate (2026-07-31, per the
// Operational Workflow SOP), replacing the single director/admin-only
// CASE_MANAGER_ROLES this used to be. Director/Admin keep full override on
// every one of these, matching every other role-narrowing precedent in
// this codebase (API access retained even when a dedicated UI moves
// elsewhere). Applies uniformly to every Case regardless of source
// (internally-recruited or partner-bridged) — only the HR review step
// (HR_ROLES, gating the separate PartnerCandidate review queue) is
// partner-specific.
export const OPERATIONS_ROLES: Role[] = ["operations_team", "operations_director", "director", "admin"];
export const FINANCE_ROLES: Role[] = ["finance", "director", "admin"];
export const HR_ROLES: Role[] = ["hr", "director", "admin"];

// Referral Agent System admin controls (2026-08-29) — deliberately
// director/admin only, unlike PARTNER_MANAGER_ROLES which also includes
// inhouse_supervisor. Confirmed with the business: these controls belong
// in the Director/Management portal, not the operational in-house tier.
export const REFERRAL_AGENT_MANAGER_ROLES: Role[] = ["director", "admin"];

export function canAccessPortal(role: Role, pathname: string): boolean {
  const prefix = Object.keys(PORTAL_ACCESS).find((p) => pathname.startsWith(p));
  if (!prefix) return true; // not a portal-gated path
  return PORTAL_ACCESS[prefix].includes(role);
}

export function homeFor(role: Role): string {
  return ROLE_HOME[role] ?? "/";
}

// Every role-based portal shell (including the candidate's own /dashboard,
// rebuilt on PortalShell 2026-07-13 to match the others) renders its own
// chrome and should NOT also get the public marketing Navbar/Footer/chat
// widgets.
const INTERNAL_PORTAL_PREFIXES = ["/admin", "/recruiter", "/supervisor", "/inhouse", "/management", "/marketing", "/partner", "/hr", "/operations", "/finance", "/dashboard", "/referral-agent"];

export function isInternalPortalPath(pathname: string): boolean {
  return INTERNAL_PORTAL_PREFIXES.some((p) => pathname.startsWith(p));
}
