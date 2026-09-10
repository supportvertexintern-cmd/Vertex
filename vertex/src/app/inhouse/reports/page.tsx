"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import PortalShell from "@/components/portal/PortalShell";
import { INHOUSE_NAV_ITEMS } from "@/components/portal/inhouseNav";
import ReportsSection from "@/components/portal/reports/ReportsSection";
import { CheckCircle, XCircle, Plus } from "@phosphor-icons/react";

interface Overview {
  dailyCompliance: { submitted: number; total: number; recruiters: { id: string; full_name: string; submittedToday: boolean }[] };
}

export default function InhouseReportsPage() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/inhouse/overview")
      .then((r) => r.json())
      .then((res) => setOverview(res.data ?? null))
      .finally(() => setLoading(false));
  }, []);

  return (
    <PortalShell roleLabel="In-House Supervisor" navItems={INHOUSE_NAV_ITEMS}>
      <p className="eyebrow mb-3">
        <span className="eyebrow-rule" />
        Operations
      </p>
      <h1 className="section-title text-3xl md:text-4xl mb-2">Reports.</h1>
      <p className="text-midnight-900/55 font-light mb-8 max-w-2xl">
        Daily submission compliance, your Country Supervisors&rsquo; reports across every assigned country, and your
        own portfolio report to Management/Director — it previews what&rsquo;s ready to pull in from their verified
        reports, but you always review and submit it yourself.
      </p>

      <section className="mb-10">
        <h2 className="text-sm font-semibold text-midnight-900/70 uppercase tracking-wider mb-4">
          Daily report compliance — today
        </h2>
        {loading ? (
          <p className="text-midnight-900/50">Loading…</p>
        ) : !overview || overview.dailyCompliance.total === 0 ? (
          <div className="card p-6 text-center text-midnight-900/50 text-sm">No recruiters assigned to your countries yet.</div>
        ) : (
          <div className="card p-4">
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {overview.dailyCompliance.recruiters.map((r) => (
                <div key={r.id} className="flex items-center justify-between gap-2 bg-ivory-100 rounded-lg px-3 py-2.5 text-sm">
                  <span className="text-midnight-900/80">{r.full_name}</span>
                  {r.submittedToday ? (
                    <CheckCircle size={18} weight="fill" className="text-emerald-600 shrink-0" />
                  ) : (
                    <XCircle size={18} weight="fill" className="text-red-400 shrink-0" />
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      <h2 className="text-sm font-semibold text-midnight-900/50 uppercase tracking-wider mb-3">Country reports</h2>
      <div className="mb-10">
        <ReportsSection
          scopeLevel="country"
          detailBasePath="/inhouse/reports"
          submitterColumnLabel="Country Supervisor"
          countryColumn
          searchPlaceholder="Search by supervisor or country…"
          typeLabel="country reports"
        />
      </div>

      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-midnight-900/50 uppercase tracking-wider">Your portfolio reports (to Management)</h2>
        <Link href="/inhouse/reports/new" className="btn-secondary text-xs">
          <Plus size={14} weight="bold" /> Create Report
        </Link>
      </div>
      <ReportsSection
        scopeLevel="inhouse"
        detailBasePath="/inhouse/reports"
        searchPlaceholder="Search…"
        typeLabel="portfolio reports"
      />
    </PortalShell>
  );
}
