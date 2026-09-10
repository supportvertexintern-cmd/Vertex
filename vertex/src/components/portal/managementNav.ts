import type { PortalNavItem } from "./PortalShell";
import { Gauge, Target, FileText, Airplane, HandCoins, Handshake, Buildings, Warning, UserCheck, DownloadSimple } from "@phosphor-icons/react";

// Fee Policy lives here rather than under System Administrator — "sets
// policy & criteria... approves & controls the workflow" is In-House
// Supervisor/Director's mandate per the Regional Supervisory Operational
// Workflow, not a system-admin task. Jobs lives under the dedicated
// Marketing portal instead — it's solely responsible for job postings,
// not part of this three-tier hierarchy. Partners and Employer Clients
// (Phase 5, SRS FR-5.1/FR-5.2) live here for the same reason as Fee
// Policy — a management/CRM concern, not system admin.
//
// "Applications" was retired (2026-07-27) — case ownership already
// narrows to Director/Management, so applications are effectively
// handled as Cases now. Document verification pre-approval (the one
// capability Applications had that nothing else did) moved to the
// Candidates detail page — it's Country Supervisor's job, before
// forwarding a candidate to In-House for approval. Interview scheduling,
// cover letter, and the legacy application_status field were retired
// without a replacement — post-approval status is the Case's own stage;
// pre-approval progress is Candidate.lifecycle_status.
//
// "Partner Submissions" moved to its own HR portal (2026-07-31, per the
// Operational Workflow SOP's separation of duties) — Director/Admin keep
// API access (HR_ROLES includes both) but no dedicated nav entry here,
// same "UI moves, API access doesn't" precedent as System Admin's
// Candidates/Finances removal.
export const MANAGEMENT_NAV_ITEMS: PortalNavItem[] = [
  { href: "/management", label: "Control Dashboard", icon: Gauge },
  { href: "/management/campaigns", label: "Campaigns", icon: Target },
  { href: "/management/partners", label: "Partners", icon: Handshake },
  { href: "/management/employer-clients", label: "Employer Clients", icon: Buildings },
  { href: "/management/fee-policy", label: "Fee Policy", icon: HandCoins },
  { href: "/management/cases", label: "Cases", icon: Airplane },
  { href: "/management/reports", label: "Reports", icon: FileText },
  { href: "/management/exceptions", label: "Exceptions", icon: Warning },
  { href: "/management/staff-scorecards", label: "Staff Scorecards", icon: UserCheck },
  { href: "/management/backup", label: "Backup", icon: DownloadSimple },
];
