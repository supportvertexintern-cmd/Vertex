import type { PortalNavItem } from "./PortalShell";
import { Gauge, GearSix, GlobeHemisphereWest, IdentificationBadge, Briefcase } from "@phosphor-icons/react";

// System Administrator is restricted to system-level concerns — account
// provisioning, reference-data taxonomy, technical settings — not
// operational recruitment workflows. Candidates, Jobs, Applications,
// Cases, Finances, and Fee Policy all live under Management/Marketing (In-
// House Supervisor/Director/Marketing), per the Regional Supervisory
// Operational Workflow's role assignments — a system administrator has no
// business need to see recruitment-pipeline or financial data day to day.
// Admin retains API-level override access to all of them for support
// purposes, it just isn't the primary place these get done, and isn't
// surfaced in this nav.
export const ADMIN_NAV_ITEMS: PortalNavItem[] = [
  { href: "/admin", label: "Overview", icon: Gauge },
  { href: "/admin/regions", label: "Regions & Countries", icon: GlobeHemisphereWest },
  { href: "/admin/sectors", label: "Sectors & Requirements", icon: Briefcase },
  { href: "/admin/users", label: "Staff & Roles", icon: IdentificationBadge },
  { href: "/admin/settings", label: "Settings", icon: GearSix },
];
