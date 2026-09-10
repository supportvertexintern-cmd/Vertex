"use client";

import { use } from "react";
import PortalShell from "@/components/portal/PortalShell";
import { HR_NAV_ITEMS } from "@/components/portal/hrNav";
import CaseDetail from "@/components/portal/CaseDetail";

// HR's drill-through view into a case it personally handed off (SRS
// FR-5.1, 2026-07-31 per the Operational Workflow SOP) — read-only, no
// separate case-browsing tab, since HR only needs visibility into
// submissions it reviewed, not every case in the system.
export default function HrCaseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <PortalShell roleLabel="Human Resources" navItems={HR_NAV_ITEMS}>
      <p className="eyebrow mb-3">
        <span className="eyebrow-rule" />
        Mobility Lifecycle
      </p>
      <h1 className="section-title text-3xl md:text-4xl mb-2">Case detail.</h1>
      <p className="text-midnight-900/55 font-light mb-8 max-w-2xl">
        Case status and document updates are handled by Operations, payments by Finance. Use Reject Case to
        close a case you created by mistake, or edit the application's own details directly below.
      </p>
      <CaseDetail
        caseId={id}
        capabilities={{
          advanceStage: false,
          manageContract: false,
          manageDocuments: false,
          managePayments: false,
          manageRetention: false,
          sendReminder: false,
          manageWorkPermit: false,
          manageOpsReview: false,
          rejectCase: true,
          editApplication: true,
        }}
      />
    </PortalShell>
  );
}
