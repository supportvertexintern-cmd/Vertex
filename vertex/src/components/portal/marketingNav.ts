import type { PortalNavItem } from "./PortalShell";
import { Briefcase } from "@phosphor-icons/react";

// Marketing is solely responsible for job postings — not part of the
// three-tier operational hierarchy (Regional Supervisory Operational
// Workflow), so it gets its own portal rather than sharing Management's.
export const MARKETING_NAV_ITEMS: PortalNavItem[] = [
  { href: "/marketing/jobs", label: "Jobs", icon: Briefcase },
];
