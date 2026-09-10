"use client";

import { use } from "react";
import PortalShell from "@/components/portal/PortalShell";
import { HR_NAV_ITEMS } from "@/components/portal/hrNav";
import PartnerSubmissionDetail from "@/components/portal/PartnerSubmissionDetail";

// HR's full review of a single partner submission (SRS FR-5.1, 2026-07-31
// per the Operational Workflow SOP) — the back-and-forth with the partner
// (message thread) happens here, and Create Case / Reject are the two
// terminal actions HR can take. Operations reads this same data before HR
// approves anything (confirmed) and, since 2026-08-04, can also make minor
// corrections and attach documents on the same page at /operations/
// partner-candidates/:id — see PartnerSubmissionDetail, which both routes
// render.
export default function HrPartnerSubmissionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <PortalShell roleLabel="Human Resources" navItems={HR_NAV_ITEMS}>
      <p className="eyebrow mb-3">
        <span className="eyebrow-rule" />
        Partner Submission
      </p>
      <PartnerSubmissionDetail id={id} backHref="/hr" />
    </PortalShell>
  );
}
