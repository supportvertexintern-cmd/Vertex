import type { PortalNavItem } from "./PortalShell";
import { Airplane, TrayArrowDown, CalendarCheck, DownloadSimple, XCircle } from "@phosphor-icons/react";

// Operations' portal (2026-07-31, per the Operational Workflow SOP) —
// owns case-stage advancement, contracts, and document handoff for every
// case regardless of source (internal or partner-sourced). Partner
// Submissions here is read-only visibility into what's coming before HR
// approves it (confirmed) — write actions (create-case, reject) stay
// HR-exclusive.
export const OPERATIONS_NAV_ITEMS: PortalNavItem[] = [
  { href: "/operations", label: "Cases", icon: Airplane },
  { href: "/operations/partner-candidates", label: "Partner Submissions", icon: TrayArrowDown },
  { href: "/operations/consultations", label: "Consultations", icon: CalendarCheck },
 { href: "/operations/rejected-submissions", label: "Rejected Submissions", icon: XCircle },
  { href: "/operations/backup", label: "Backup", icon: DownloadSimple },];
