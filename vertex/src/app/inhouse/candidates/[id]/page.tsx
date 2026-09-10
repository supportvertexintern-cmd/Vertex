"use client";

import { use } from "react";
import PortalShell from "@/components/portal/PortalShell";
import { INHOUSE_NAV_ITEMS } from "@/components/portal/inhouseNav";
import CandidateDetail from "@/components/portal/CandidateDetail";

export default function InhouseCandidateDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <PortalShell roleLabel="In-House Supervisor" navItems={INHOUSE_NAV_ITEMS}>
      <CandidateDetail candidateId={id} backHref="/inhouse/candidates" canVerify canApprove canVerifyDocuments />
    </PortalShell>
  );
}
