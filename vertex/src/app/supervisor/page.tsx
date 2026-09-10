"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import PortalShell from "@/components/portal/PortalShell";
import { SUPERVISOR_NAV_ITEMS } from "@/components/portal/supervisorNav";
import { UsersThree, Users, Target, ClockCountdown, FileText } from "@phosphor-icons/react";

interface CountryTargetProgress {
  campaignTargetId: string;
  metric: string;
  campaignName: string;
  targetValue: number;
  actualValue: number;
}

interface OverviewData {
  countryName: string | null;
  recruiterCount: number;
  candidateCount: number;
  pendingVerificationCount: number;
  reportsAwaitingReviewCount: number;
  targetProgress: CountryTargetProgress[];
}

const METRIC_LABELS: Record<string, string> = {
  agent_signups: "Agent Sign-ups",
  applicant_flow: "Applicant Flow",
  conversion_rate: "Conversion Rate (%)",
};

function StatTile({ icon: Icon, label, value, href }: { icon: typeof Users; label: string; value: string | number; href?: string }) {
  const content = (
    <div className="card p-6 flex items-center gap-4 h-full">
      <div className="w-12 h-12 rounded-full bg-midnight-950/5 flex items-center justify-center shrink-0">
        <Icon size={22} weight="regular" className="text-midnight-800" />
      </div>
      <div>
        <div className="text-2xl font-semibold text-midnight-900">{value}</div>
        <div className="text-midnight-900/50 text-xs uppercase tracking-wider mt-1">{label}</div>
      </div>
    </div>
  );
  return href ? <Link href={href}>{content}</Link> : content;
}

export default function SupervisorOverviewPage() {
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);

  const period = useMemo(() => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    return { period_start: monthStart.toISOString().slice(0, 10), period_end: now.toISOString().slice(0, 10) };
  }, []);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/supervisor/overview?${new URLSearchParams(period)}`)
      .then((r) => r.json())
      .then((res) => setData(res.data ?? null))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [period]);

  return (
    <PortalShell roleLabel="Country Supervisor" navItems={SUPERVISOR_NAV_ITEMS}>
      <p className="eyebrow mb-3">
        <span className="eyebrow-rule" />
        Agent network
      </p>
      <h1 className="section-title text-3xl md:text-4xl mb-2">
        {data?.countryName ? `${data.countryName} overview.` : "Country overview."}
      </h1>
      <p className="text-midnight-900/55 font-light mb-8 max-w-2xl">
        Your country&rsquo;s recruiter team, candidate pipeline, and progress against target this month —
        drill into Recruiters, Candidates, or Reports for the detail behind any of these numbers.
      </p>

      {loading || !data ? (
        <p className="text-midnight-900/50">Loading…</p>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 mb-8">
            <StatTile icon={UsersThree} label="Recruiters" value={data.recruiterCount} href="/supervisor/recruiters" />
            <StatTile icon={Users} label="Candidates in country" value={data.candidateCount} href="/supervisor/candidates" />
            <StatTile icon={ClockCountdown} label="Awaiting your verification" value={data.pendingVerificationCount} href="/supervisor/candidates" />
            <StatTile icon={FileText} label="Reports awaiting review" value={data.reportsAwaitingReviewCount} href="/supervisor/reports" />
          </div>

          <div className="card p-6">
            <h2 className="text-sm font-semibold text-midnight-900/70 uppercase tracking-wider mb-4 flex items-center gap-2">
              <Target size={16} weight="bold" className="text-gold-600" /> Country performance vs target this month
            </h2>
            {data.targetProgress.length === 0 ? (
              <p className="text-sm text-midnight-900/40">No active campaign targets touch your country yet.</p>
            ) : (
              <div className="space-y-2">
                {data.targetProgress.map((p) => (
                  <div key={p.campaignTargetId} className="flex items-center justify-between text-sm bg-ivory-100 rounded-lg px-3 py-2.5">
                    <span className="text-midnight-900/70">
                      {METRIC_LABELS[p.metric] ?? p.metric} <span className="text-midnight-900/40 text-xs">({p.campaignName})</span>
                    </span>
                    <span className="font-semibold text-midnight-900">
                      {p.actualValue} / {p.targetValue}
                      {p.metric === "conversion_rate" ? "%" : ""}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </PortalShell>
  );
}
