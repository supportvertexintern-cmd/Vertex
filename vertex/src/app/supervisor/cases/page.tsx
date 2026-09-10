"use client";

import PortalShell from "@/components/portal/PortalShell";
import { SUPERVISOR_NAV_ITEMS } from "@/components/portal/supervisorNav";
import CaseList from "@/components/portal/CaseList";

export default function SupervisorCasesPage() {
  return (
    <PortalShell roleLabel="Country Supervisor" navItems={SUPERVISOR_NAV_ITEMS}>
      <p className="eyebrow mb-3">
        <span className="eyebrow-rule" />
        Mobility Lifecycle
      </p>
      <h1 className="section-title text-3xl md:text-4xl mb-2">Cases.</h1>
      <p className="text-midnight-900/55 font-light mb-8 max-w-2xl">
        Every case across your country's recruiters — offer through permit, visa, and travel (SRS FR-4.1).
      </p>
      <CaseList emptyLabel="No active cases in your country yet." basePath="/supervisor/cases" />
    </PortalShell>
  );
}
