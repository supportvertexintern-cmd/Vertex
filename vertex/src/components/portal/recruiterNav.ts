import type { PortalNavItem } from "./PortalShell";
import { Gauge, Users, FileText, Airplane, Warning, XCircle } from "@phosphor-icons/react";

// "Applications" was retired (2026-07-27) — it was a read-only duplicate of
// candidate/case data already visible on "My Candidates"/"Cases"; the real
// approve/reject action always lived on the candidate lifecycle, not here.
export const RECRUITER_NAV_ITEMS: PortalNavItem[] = [
  { href: "/recruiter/overview", label: "Overview", icon: Gauge },
  { href: "/recruiter", label: "My Candidates", icon: Users },
  { href: "/recruiter/cases", label: "Cases", icon: Airplane },
  { href: "/recruiter/rejected-submissions", label: "Rejected Submissions", icon: XCircle },
  { href: "/recruiter/reports", label: "Reports", icon: FileText },
  { href: "/recruiter/exceptions", label: "Exceptions", icon: Warning },
];
