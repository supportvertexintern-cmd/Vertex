"use client";

import { use } from "react";
import PortalShell from "@/components/portal/PortalShell";
import { RECRUITER_NAV_ITEMS } from "@/components/portal/recruiterNav";
import CandidateDetail from "@/components/portal/CandidateDetail";

export default function RecruiterCandidateDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <PortalShell roleLabel="Regional Recruiter" navItems={RECRUITER_NAV_ITEMS}>
      <CandidateDetail candidateId={id} backHref="/recruiter" canVerify={false} canApprove={false} />
    </PortalShell>
  );
}
