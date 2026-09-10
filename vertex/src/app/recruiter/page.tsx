"use client";

import { useState } from "react";
import PortalShell from "@/components/portal/PortalShell";
import CandidateList from "@/components/portal/CandidateList";
import RegisterCandidateForm from "@/components/portal/RegisterCandidateForm";
import { RECRUITER_NAV_ITEMS } from "@/components/portal/recruiterNav";

export default function RecruiterPortalPage() {
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <PortalShell roleLabel="Regional Recruiter" navItems={RECRUITER_NAV_ITEMS}>
      <p className="eyebrow mb-3">
        <span className="eyebrow-rule" />
        Agent network
      </p>
      <h1 className="section-title text-3xl md:text-4xl mb-2">My candidates.</h1>
      <p className="text-midnight-900/55 font-light mb-8 max-w-2xl">
        Register new leads, guide them through the screening gate, and hand off reported candidates to your country
        supervisor for verification. Click a candidate to see their full Candidate Information Form submission and
        take action.
      </p>
      <RegisterCandidateForm onRegistered={() => setRefreshKey((k) => k + 1)} />
      <CandidateList
        emptyLabel="No candidates attributed to you yet."
        canVerify={false}
        refreshKey={refreshKey}
        basePath="/recruiter/candidates"
      />
    </PortalShell>
  );
}
