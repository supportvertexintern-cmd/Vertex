import type { PortalNavItem } from "./PortalShell";
import { HandCoins, Airplane, CalendarCheck } from "@phosphor-icons/react";

// Finance's portal (2026-07-31, per the Operational Workflow SOP) — owns
// issuing payment links and recording milestone payments across every
// case, regardless of source. Case stage/contract/documents stay
// Operations' lane; Finance's own Cases tab is payments-only.
export const FINANCE_NAV_ITEMS: PortalNavItem[] = [
  { href: "/finance", label: "Payments Due", icon: HandCoins },
  { href: "/finance/cases", label: "Cases", icon: Airplane },
  { href: "/finance/consultations", label: "Consultations", icon: CalendarCheck },
];
