"use client";

import PortalShell from "@/components/portal/PortalShell";
import CandidateList from "@/components/portal/CandidateList";
import { INHOUSE_NAV_ITEMS } from "@/components/portal/inhouseNav";

export default function InhouseCandidatesPage() {
  return (
    <PortalShell roleLabel="In-House Supervisor" navItems={INHOUSE_NAV_ITEMS}>
      <p className="eyebrow mb-3">
        <span className="eyebrow-rule" />
        Operations
      </p>
      <h1 className="section-title text-3xl md:text-4xl mb-2">Candidates.</h1>
      <p className="text-midnight-900/55 font-light mb-8 max-w-2xl">
        Every candidate in your assigned country, across the full pipeline. Click into one to review and approve —
        or return it — once your Country Supervisor has verified it.
      </p>
      <CandidateList emptyLabel="No candidates in your assigned country yet." basePath="/inhouse/candidates" />
    </PortalShell>
  );
}
