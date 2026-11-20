"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import PortalShell from "@/components/portal/PortalShell";
import { VA_NAV_ITEMS } from "@/components/portal/vaNav";
import PartnerTrackingPanel from "@/components/portal/PartnerTrackingPanel";

// VA per-partner view — the same tracking panel Management uses (doc §9:
// open any partner and immediately see registration status, agreement
// signing, report status, application progress, candidates, assigned VA
// and pending actions), under the VA portal.
export default function VaPartnerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [name, setName] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    // Name comes from the scoped tracking endpoint (VA row-level scoping):
    // a VA has no access to the partner directory (upstream's DEF-009).
    fetch(`/api/management/partners/${id}/tracking`)
      .then((r) => r.json())
      .then((res) => {
        if (res.error) throw new Error(res.error.message);
        setName(res.data?.partner?.name ?? null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load partner."));
  }, [id]);

  return (
    <PortalShell roleLabel="Virtual Assistant" navItems={VA_NAV_ITEMS}>
      <div className="mb-6">
        <Link href="/va/partners" className="text-sm text-gold-600 font-semibold hover:underline">&larr; All partners</Link>
        <h1 className="text-2xl font-bold text-midnight-900 mt-1">{name ?? "Partner"}</h1>
      </div>

      {error && <div className="card p-4 border-l-4 border-red-400 text-red-700 text-sm">{error}</div>}

      {!error && <PartnerTrackingPanel partnerId={id} />}
    </PortalShell>
  );
}