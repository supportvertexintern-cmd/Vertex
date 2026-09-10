"use client";

import { use } from "react";
import PortalShell from "@/components/portal/PortalShell";
import { SUPERVISOR_NAV_ITEMS } from "@/components/portal/supervisorNav";
import CandidateDetail from "@/components/portal/CandidateDetail";

export default function SupervisorCandidateDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <PortalShell roleLabel="Country Supervisor" navItems={SUPERVISOR_NAV_ITEMS}>
      <CandidateDetail candidateId={id} backHref="/supervisor/candidates" canVerify canApprove={false} canVerifyDocuments />
    </PortalShell>
  );
}
