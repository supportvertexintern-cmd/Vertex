import type { PortalNavItem } from "./PortalShell";
import { Gauge, FileText, Airplane, UsersThree, Users, Warning } from "@phosphor-icons/react";

// "Applications" was retired (2026-07-27) — a read-only duplicate of
// candidate/case data. Document verification pre-approval (the one real
// capability that page had) is now on the Candidates detail page instead.
export const SUPERVISOR_NAV_ITEMS: PortalNavItem[] = [
  { href: "/supervisor", label: "Overview", icon: Gauge },
  { href: "/supervisor/recruiters", label: "Recruiters", icon: UsersThree },
  { href: "/supervisor/candidates", label: "Candidates", icon: Users },
  { href: "/supervisor/cases", label: "Cases", icon: Airplane },
  { href: "/supervisor/reports", label: "Reports", icon: FileText },
  { href: "/supervisor/exceptions", label: "Exceptions", icon: Warning },
];
