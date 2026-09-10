import type { PortalNavItem } from "./PortalShell";
import { Airplane, TrayArrowDown, Globe, DownloadSimple } from "@phosphor-icons/react";

// HR's portal (2026-07-31, per the Operational Workflow SOP) — reviews
// partner-submitted candidates and creates the Case that hands them to
// Operations. Self Applications (2026-07-31, HR-owned self-submission
// routing) is the second, independent queue: a public website submission
// now goes straight to HR instead of a recruiter/email-bridge — HR
// screens it and, once the candidate later completes their own
// documentation, approves it straight through (skipping the
// recruiter/supervisor/in-house pipeline entirely, since none of those
// roles are ever involved for this source). A recruiter-sourced candidate
// never appears in either queue — that pipeline is unchanged.
export const HR_NAV_ITEMS: PortalNavItem[] = [
  { href: "/hr", label: "Partner Submissions", icon: TrayArrowDown },
  { href: "/hr/self-applications", label: "Self Applications", icon: Globe },
  // Cases (2026-08-16) — a direct list of every case HR has handed off,
  // so finding one (e.g. to reject a mistaken case) doesn't mean digging
  // back through the Candidates/Partner Submissions queues that created
  // it. Read-only browsing + Reject Case only, same capabilities as the
  // existing /hr/cases/[id] detail view.
  { href: "/hr/cases", label: "Cases", icon: Airplane },
  { href: "/hr/backup", label: "Backup", icon: DownloadSimple },
];
