"use client";

import { use } from "react";
import PortalShell from "@/components/portal/PortalShell";
import { HR_NAV_ITEMS } from "@/components/portal/hrNav";
import CandidateDetail from "@/components/portal/CandidateDetail";

export default function HrSelfApplicationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <PortalShell roleLabel="Human Resources" navItems={HR_NAV_ITEMS}>
      <CandidateDetail
        candidateId={id}
        backHref="/hr/self-applications"
        canVerifyDocuments
        hrMode
      />
    </PortalShell>
  );
}
