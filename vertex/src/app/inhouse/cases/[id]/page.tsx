"use client";

import { use } from "react";
import PortalShell from "@/components/portal/PortalShell";
import { INHOUSE_NAV_ITEMS } from "@/components/portal/inhouseNav";
import CaseDetail from "@/components/portal/CaseDetail";

export default function InhouseCaseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <PortalShell roleLabel="In-House Supervisor" navItems={INHOUSE_NAV_ITEMS}>
      <p className="eyebrow mb-3">
        <span className="eyebrow-rule" />
        Mobility Lifecycle
      </p>
      <h1 className="section-title text-3xl md:text-4xl mb-2">Case detail.</h1>
      <p className="text-midnight-900/55 font-light mb-8 max-w-2xl">
        Read-only — case status and document updates are handled by Operations, payments by Finance.
      </p>
      <CaseDetail caseId={id} />
    </PortalShell>
  );
}
