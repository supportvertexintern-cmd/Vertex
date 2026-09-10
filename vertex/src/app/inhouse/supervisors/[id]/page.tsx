"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import PortalShell from "@/components/portal/PortalShell";
import { INHOUSE_NAV_ITEMS } from "@/components/portal/inhouseNav";
import StaffKpiTargetPanel from "@/components/portal/StaffKpiTargetPanel";
import { CaretLeft } from "@phosphor-icons/react";

interface SupervisorDetail {
  supervisor: { id: string; full_name: string; email: string };
  country: { id: string; name: string } | null;
  candidatesTotal: number;
  conversionRate: number;
}

export default function InhouseSupervisorDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [detail, setDetail] = useState<SupervisorDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    setLoading(true);
    fetch(`/api/inhouse/supervisors/${id}`)
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body.error?.message ?? "Failed to load supervisor.");
        return body.data;
      })
      .then(setDetail)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load supervisor."))
      .finally(() => setLoading(false));
  }, [id]);

  return (
    <PortalShell roleLabel="In-House Supervisor" navItems={INHOUSE_NAV_ITEMS}>
      <Link href="/inhouse/supervisors" className="inline-flex items-center gap-1 text-xs font-semibold text-midnight-900/50 hover:text-midnight-900 mb-4">
        <CaretLeft size={12} weight="bold" /> Country Supervisors
      </Link>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4 text-sm mb-6">{error}</div>}

      {loading || !detail ? (
        <p className="text-midnight-900/50">Loading…</p>
      ) : (
        <>
          <h1 className="section-title text-3xl md:text-4xl mb-1">{detail.supervisor.full_name}</h1>
          <p className="text-midnight-900/55 font-light mb-8">
            {detail.supervisor.email}
            {detail.country && <> · {detail.country.name}</>}
          </p>

          <div className="grid grid-cols-2 gap-5 mb-8">
            <div className="card p-6">
              <div className="text-2xl font-semibold text-midnight-900">{detail.candidatesTotal}</div>
              <div className="text-midnight-900/50 text-xs uppercase tracking-wider mt-1">Candidates this month</div>
            </div>
            <div className="card p-6">
              <div className="text-2xl font-semibold text-midnight-900">{detail.conversionRate}%</div>
              <div className="text-midnight-900/50 text-xs uppercase tracking-wider mt-1">Conversion rate this month</div>
            </div>
          </div>

          <div className="card p-6">
            <StaffKpiTargetPanel staffId={detail.supervisor.id} staffRole="country_supervisor" />
          </div>
        </>
      )}
    </PortalShell>
  );
}
