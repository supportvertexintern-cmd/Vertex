import type { PortalNavItem } from "./PortalShell";
import type { Role } from "@/lib/enums";
import { ADMIN_NAV_ITEMS } from "./adminNav";
import { FINANCE_NAV_ITEMS } from "./financeNav";
import { HR_NAV_ITEMS } from "./hrNav";
import { INHOUSE_NAV_ITEMS } from "./inhouseNav";
import { MANAGEMENT_NAV_ITEMS } from "./managementNav";
import { MARKETING_NAV_ITEMS } from "./marketingNav";
import { OPERATIONS_NAV_ITEMS } from "./operationsNav";
import { RECRUITER_NAV_ITEMS } from "./recruiterNav";
import { SUPERVISOR_NAV_ITEMS } from "./supervisorNav";
import { VA_NAV_ITEMS } from "./vaNav";

/**
 * An internal role's own portal shell (its label and nav), for the pages a
 * role reaches by permission rather than by portal (/content/...; role
 * management, 2026-11-21): they open inside whichever portal the user has.
 */
export const PORTAL_FOR_ROLE: Partial<Record<Role, { roleLabel: string; navItems: PortalNavItem[] }>> = {
  admin: { roleLabel: "System Administrator", navItems: ADMIN_NAV_ITEMS },
  director: { roleLabel: "Management", navItems: MANAGEMENT_NAV_ITEMS },
  inhouse_supervisor: { roleLabel: "In-House Supervisor", navItems: INHOUSE_NAV_ITEMS },
  country_supervisor: { roleLabel: "Country Supervisor", navItems: SUPERVISOR_NAV_ITEMS },
  regional_recruiter: { roleLabel: "Regional Recruiter", navItems: RECRUITER_NAV_ITEMS },
  marketing: { roleLabel: "Marketing", navItems: MARKETING_NAV_ITEMS },
  hr: { roleLabel: "Human Resources", navItems: HR_NAV_ITEMS },
  operations_team: { roleLabel: "Operations", navItems: OPERATIONS_NAV_ITEMS },
  operations_director: { roleLabel: "Operations", navItems: OPERATIONS_NAV_ITEMS },
  finance: { roleLabel: "Finance", navItems: FINANCE_NAV_ITEMS },
  virtual_assistant: { roleLabel: "Virtual Assistant", navItems: VA_NAV_ITEMS },
};
