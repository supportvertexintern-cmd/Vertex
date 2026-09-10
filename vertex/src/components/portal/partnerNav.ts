import type { PortalNavItem } from "./PortalShell";
import { UsersThree, Airplane } from "@phosphor-icons/react";

// A partner's own portal (SRS FR-5.1) — submits and tracks its own
// candidates only, no access to Vertex's internal recruiter/screening
// pipeline. Cases (2026-07-31) shows only candidates HR has approved and
// bridged into a real Case — a still-under-review submission has no case
// to show yet, so it stays on the My Candidates tab until then.
export const PARTNER_NAV_ITEMS: PortalNavItem[] = [
  { href: "/partner", label: "My Candidates", icon: UsersThree },
  { href: "/partner/cases", label: "Cases", icon: Airplane },
];
