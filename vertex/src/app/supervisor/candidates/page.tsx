"use client";

import PortalShell from "@/components/portal/PortalShell";
import CandidateList from "@/components/portal/CandidateList";
import { SUPERVISOR_NAV_ITEMS } from "@/components/portal/supervisorNav";

export default function SupervisorCandidatesPage() {
  return (
    <PortalShell roleLabel="Country Supervisor" navItems={SUPERVISOR_NAV_ITEMS}>
      <p className="eyebrow mb-3">
        <span className="eyebrow-rule" />
        Agent network
      </p>
      <h1 className="section-title text-3xl md:text-4xl mb-2">Candidates.</h1>
      <p className="text-midnight-900/55 font-light mb-10 max-w-2xl">
        Every candidate sourced by recruiters in your assigned country. Click a candidate to see their full
        Candidate Information Form submission, verify them, or return them for correction with a reason.
      </p>
      <CandidateList emptyLabel="No candidates in your assigned country yet." canVerify basePath="/supervisor/candidates" />
    </PortalShell>
  );
}
