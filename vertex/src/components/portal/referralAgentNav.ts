import type { PortalNavItem } from "./PortalShell";
import { House } from "@phosphor-icons/react";

// A Referral Agent's own portal (2026-08-29) — single-page dashboard
// (referral link/QR, commission summary, referred-candidates table), same
// shape as Partner's own single-page /partner portal.
export const REFERRAL_AGENT_NAV_ITEMS: PortalNavItem[] = [{ href: "/referral-agent", label: "Dashboard", icon: House }];
