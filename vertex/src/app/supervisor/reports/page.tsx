"use client";

import Link from "next/link";
import PortalShell from "@/components/portal/PortalShell";
import { SUPERVISOR_NAV_ITEMS } from "@/components/portal/supervisorNav";
import ReportsSection from "@/components/portal/reports/ReportsSection";
import { Plus } from "@phosphor-icons/react";

export default function SupervisorReportsPage() {
  return (
    <PortalShell roleLabel="Country Supervisor" navItems={SUPERVISOR_NAV_ITEMS}>
      <p className="eyebrow mb-3">
        <span className="eyebrow-rule" />
        Agent network
      </p>
      <h1 className="section-title text-3xl md:text-4xl mb-2">Reports.</h1>
      <p className="text-midnight-900/55 font-light mb-8 max-w-2xl">
        Verify or return your recruiters&rsquo; submissions, then create your own daily, weekly, or monthly country
        report — it previews what&rsquo;s ready to pull in from their verified reports, but you always review and
        submit it yourself.
      </p>

      <h2 className="text-sm font-semibold text-midnight-900/50 uppercase tracking-wider mb-3">Recruiter submissions</h2>
      <div className="mb-10">
        <ReportsSection
          scopeLevel="recruiter"
          detailBasePath="/supervisor/reports"
          submitterColumnLabel="Recruiter"
          searchPlaceholder="Search by recruiter name…"
          typeLabel="reports"
        />
      </div>

      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-midnight-900/50 uppercase tracking-wider">Country reports (to In-House)</h2>
        <Link href="/supervisor/reports/new" className="btn-secondary text-xs">
          <Plus size={14} weight="bold" /> Create Report
        </Link>
      </div>
      <ReportsSection
        scopeLevel="country"
        detailBasePath="/supervisor/reports"
        searchPlaceholder="Search…"
        typeLabel="country reports"
      />
    </PortalShell>
  );
}
