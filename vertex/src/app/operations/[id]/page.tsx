"use client";

import { use } from "react";
import PortalShell from "@/components/portal/PortalShell";
import { OPERATIONS_NAV_ITEMS } from "@/components/portal/operationsNav";
import CaseDetail from "@/components/portal/CaseDetail";

export default function OperationsCaseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <PortalShell roleLabel="Operations" navItems={OPERATIONS_NAV_ITEMS}>
      <p className="eyebrow mb-3">
        <span className="eyebrow-rule" />
        Mobility Lifecycle
      </p>
      <h1 className="section-title text-3xl md:text-4xl mb-2">Case detail.</h1>
      <p className="text-midnight-900/55 font-light mb-8 max-w-2xl">
        Stage, documents, and the work permit delivery are yours to manage. Payments are Finance's own lane.
      </p>
      <CaseDetail
        caseId={id}
        capabilities={{
          advanceStage: true,
          manageContract: false,
          manageDocuments: true,
          managePayments: false,
          manageRetention: true,
          sendReminder: true,
          manageWorkPermit: true,
          manageOpsReview: true,
          rejectCase: true,
          editApplication: true,
        }}
      />
    </PortalShell>
  );
}
