import type { PortalNavItem } from "./PortalShell";
import { Gauge, GearSix, GlobeHemisphereWest, IdentificationBadge, Briefcase, ClockCounterClockwise, Handshake, LockKey, ShieldCheck, UserList, Warning } from "@phosphor-icons/react";

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
  // Admin → Monitoring (owner's requirements, 2026-11-07). Admins only (D1).
  { href: "/admin/monitoring", label: "Security Overview", icon: ShieldCheck, section: "Monitoring" },
  { href: "/admin/monitoring/partners", label: "Partners & Logins", icon: Handshake, section: "Monitoring" },
  { href: "/admin/monitoring/accounts", label: "User Accounts", icon: UserList, section: "Monitoring" },
  {
    href: "/admin/monitoring/suspicious",
    label: "Suspicious Activity",
    icon: Warning,
    section: "Monitoring",
    badgeFrom: "/api/admin/monitoring/alerts/summary",
  },
  {
    href: "/admin/monitoring/locked",
    label: "Locked Accounts",
    icon: LockKey,
    section: "Monitoring",
    // Lockouts at the 24-hour step not yet reviewed (login protection, 4.1).
    badgeFrom: "/api/admin/monitoring/locked/summary",
  },
  { href: "/admin/monitoring/audit", label: "Audit Trail", icon: ClockCounterClockwise, section: "Monitoring" },
];
