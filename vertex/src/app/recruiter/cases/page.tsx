"use client";

import PortalShell from "@/components/portal/PortalShell";
import { RECRUITER_NAV_ITEMS } from "@/components/portal/recruiterNav";
import CaseList from "@/components/portal/CaseList";

export default function RecruiterCasesPage() {
  return (
    <PortalShell roleLabel="Regional Recruiter" navItems={RECRUITER_NAV_ITEMS}>
      <p className="eyebrow mb-3">
        <span className="eyebrow-rule" />
        Mobility Lifecycle
      </p>
      <h1 className="section-title text-3xl md:text-4xl mb-2">Cases.</h1>
      <p className="text-midnight-900/55 font-light mb-8 max-w-2xl">
        Track your candidates from offer through permit, visa, and travel — the full mobility journey (SRS FR-4.1).
      </p>
      <CaseList emptyLabel="No active cases yet — a case opens automatically once one of your candidates' applications is approved." basePath="/recruiter/cases" />
    </PortalShell>
  );
}
