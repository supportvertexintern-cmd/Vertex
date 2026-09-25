"use client";

import { use } from "react";
import PortalShell from "@/components/portal/PortalShell";
import { MANAGEMENT_NAV_ITEMS } from "@/components/portal/managementNav";
import CaseDetail from "@/components/portal/CaseDetail";

export default function ManagementCaseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <PortalShell roleLabel="Management" navItems={MANAGEMENT_NAV_ITEMS}>
      <p className="eyebrow mb-3">
        <span className="eyebrow-rule" />
        Mobility Lifecycle
      </p>
      <h1 className="section-title text-3xl md:text-4xl mb-8">Case detail.</h1>
      <CaseDetail
        caseId={id}
        capabilities={{
          advanceStage: true,
          manageContract: true,
          manageDocuments: true,
          managePayments: true,
          manageRetention: true,
          sendReminder: true,
          manageWorkPermit: false,
          manageOpsReview: true,
          rejectCase: true,
          editApplication: true,
          undoPayments: false,
          overturnRejection: false,
        }}
      />
    </PortalShell>
  );
}
