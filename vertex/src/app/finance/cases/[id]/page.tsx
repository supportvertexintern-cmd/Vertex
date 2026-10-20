"use client";

import { use } from "react";
import PortalShell from "@/components/portal/PortalShell";
import { FINANCE_NAV_ITEMS } from "@/components/portal/financeNav";
import CaseDetail from "@/components/portal/CaseDetail";

export default function FinanceCaseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <PortalShell roleLabel="Finance" navItems={FINANCE_NAV_ITEMS}>
      <p className="eyebrow mb-3">
        <span className="eyebrow-rule" />
        Mobility Lifecycle
      </p>
      <h1 className="section-title text-3xl md:text-4xl mb-2">Case detail.</h1>
      <p className="text-midnight-900/55 font-light mb-8 max-w-2xl">
        Payments are yours to manage. Stage and document updates are Operations&apos; own lane.
      </p>
      <CaseDetail
        caseId={id}
        capabilities={{
          advanceStage: false,
          manageContract: false,
          manageDocuments: false,
          managePayments: true,
          manageRetention: false,
          sendReminder: false,
          manageWorkPermit: false,
          manageOpsReview: false,
          rejectCase: false,
          editApplication: false,
          undoPayments: true,
          overturnRejection: false,
        }}
      />
    </PortalShell>
  );
}
