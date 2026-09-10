import type { PortalNavItem } from "./PortalShell";
import { Gauge, IdentificationCard, Airplane, FileText, ChatCircleDots } from "@phosphor-icons/react";

// The candidate's own portal (rebuilt on PortalShell 2026-07-13 to match
// every other role's portal, replacing the old single-page public-chrome
// dashboard).
export const CANDIDATE_NAV_ITEMS: PortalNavItem[] = [
  { href: "/dashboard", label: "Overview", icon: Gauge },
  { href: "/dashboard/profile", label: "Profile", icon: IdentificationCard },
  { href: "/dashboard/cases", label: "Cases", icon: Airplane },
  { href: "/dashboard/documents", label: "Documents", icon: FileText },
  { href: "/dashboard/messages", label: "Messages", icon: ChatCircleDots },
];
