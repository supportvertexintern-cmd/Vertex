"use client";

import { use } from "react";
import PortalShell from "@/components/portal/PortalShell";
import { OPERATIONS_NAV_ITEMS } from "@/components/portal/operationsNav";
import PartnerSubmissionDetail from "@/components/portal/PartnerSubmissionDetail";

// Operations' view of a single partner submission (2026-08-04) — read
// access here already existed (GET /api/partner-candidates/:id has always
// allowed operations_team/operations_director, "so it can see what's
// coming before HR approves anything"), just with no detail route to
// reach it from. Now also gets the same minor-correction edit + document
// upload capability as HR (PartnerSubmissionDetail gates this by the
// authenticated user's actual role, not a prop) — Create Case / Reject
// stay HR-exclusive, per the existing confirmed decision.
export default function OperationsPartnerSubmissionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <PortalShell roleLabel="Operations" navItems={OPERATIONS_NAV_ITEMS}>
      <p className="eyebrow mb-3">
        <span className="eyebrow-rule" />
        Partner Submission
      </p>
      <PartnerSubmissionDetail id={id} backHref="/operations/partner-candidates" />
    </PortalShell>
  );
}
