"use client";

import PortalShell from "@/components/portal/PortalShell";
import { INHOUSE_NAV_ITEMS } from "@/components/portal/inhouseNav";
import CaseList from "@/components/portal/CaseList";

export default function InhouseCasesPage() {
  return (
    <PortalShell roleLabel="In-House Supervisor" navItems={INHOUSE_NAV_ITEMS}>
      <p className="eyebrow mb-3">
        <span className="eyebrow-rule" />
        Mobility Lifecycle
      </p>
      <h1 className="section-title text-3xl md:text-4xl mb-2">Cases.</h1>
      <p className="text-midnight-900/55 font-light mb-8 max-w-2xl">
        Every case across your assigned countries — offer through permit, visa, and travel (SRS FR-4.1). Read-only:
        status, contract, and payment updates are handled by Director/Management.
      </p>
      <CaseList emptyLabel="No active cases in your countries yet." basePath="/inhouse/cases" />
    </PortalShell>
  );
}
