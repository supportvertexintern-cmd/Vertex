import type { PortalNavItem } from "./PortalShell";
import { Gauge, Target, Users, FileText, Warning, Briefcase, UserCircleGear } from "@phosphor-icons/react";

// In-House Supervisor's own dedicated portal (previously shared
// /management with Director/admin) — scoped entirely to their one
// assigned country. No Employer Clients / Fee Policy (confirmed not an
// In-House task — pricing lives per-Job now, and Employer Clients is a
// Director/admin concern), no campaign authoring (Director/admin create
// campaigns; In-House sets/edits their own country's targets under them).
export const INHOUSE_NAV_ITEMS: PortalNavItem[] = [
  { href: "/inhouse", label: "Country Overview", icon: Gauge },
  { href: "/inhouse/campaigns", label: "Campaign Targets", icon: Target },
  { href: "/inhouse/candidates", label: "Candidates", icon: Users },
  { href: "/inhouse/supervisors", label: "Country Supervisors", icon: UserCircleGear },
  { href: "/inhouse/cases", label: "Cases", icon: Briefcase },
  { href: "/inhouse/reports", label: "Reports", icon: FileText },
  { href: "/inhouse/exceptions", label: "Exceptions", icon: Warning },
];
