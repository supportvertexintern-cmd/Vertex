import type { PortalNavItem } from "./PortalShell";
import { Gauge, Handshake } from "@phosphor-icons/react";

// The virtual assistants' portal (Phase 6): partner tracking, onboarding and
// follow-ups. Overview is the dashboard; Partners the working list.
export const VA_NAV_ITEMS: PortalNavItem[] = [
  { href: "/va", label: "Overview", icon: Gauge },
  { href: "/va/partners", label: "Partners", icon: Handshake },
];
