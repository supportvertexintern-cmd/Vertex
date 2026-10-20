"use client";

import { use } from "react";
import PortalShell from "@/components/portal/PortalShell";
import { PARTNER_NAV_ITEMS } from "@/components/portal/partnerNav";
import CaseDetail from "@/components/portal/CaseDetail";

export default function PartnerCaseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <PortalShell roleLabel="Partner" navItems={PARTNER_NAV_ITEMS}>
      <p className="eyebrow mb-3">
        <span className="eyebrow-rule" />
        Partner Portal
      </p>
      <h1 className="section-title text-3xl md:text-4xl mb-2">Case detail.</h1>
      <p className="text-midnight-900/55 font-light mb-8 max-w-2xl">
        Read-only — status of your candidate&apos;s case as it moves through documentation, permit, and visa stages.
      </p>
      <CaseDetail caseId={id} />
    </PortalShell>
  );
}
