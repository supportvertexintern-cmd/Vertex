"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import PortalShell from "@/components/portal/PortalShell";
import { INHOUSE_NAV_ITEMS } from "@/components/portal/inhouseNav";
import StaffScorecardPanel from "@/components/portal/StaffScorecardPanel";
import { Users, UserCheck, CheckCircle, Target, FileText, ClipboardText } from "@phosphor-icons/react";

interface Overview {
  countries: { id: string; name: string }[];
  recruiterCount: number;
  dailyCompliance: { submitted: number; total: number; recruiters: { id: string; full_name: string; submittedToday: boolean }[] };
  candidateFunnel: Record<string, number>;
  pendingCountryReports: number;
  campaignTargets: {
    id: string;
    metric: string;
    targetValue: number;
    actualValue: number;
    campaignName: string;
    country: { id: string; name: string } | null;
  }[];
  countrySupervisors: { id: string; full_name: string; assigned_country: { id: string; name: string } | null }[];
}

const STAGE_LABELS: Record<string, string> = {
  identified: "Identified",
  screened: "Screened",
  guided_to_apply: "Guided to Apply",
  submitted: "Submitted",
  reported: "Reported",
  verified: "Verified",
  approved: "Approved",
};

const METRIC_LABELS: Record<string, string> = {
  agent_signups: "Agent Sign-ups",
  applicant_flow: "Applicant Flow",
  conversion_rate: "Conversion Rate (%)",
};

function StatTile({ icon: Icon, label, value }: { icon: typeof Users; label: string; value: string | number }) {
  return (
    <div className="card p-6 flex items-center gap-4">
      <div className="w-12 h-12 rounded-full bg-midnight-950/5 flex items-center justify-center shrink-0">
        <Icon size={22} weight="regular" className="text-midnight-800" />
      </div>
      <div>
        <div className="text-2xl font-semibold text-midnight-900">{value}</div>
        <div className="text-midnight-900/50 text-xs uppercase tracking-wider mt-1">{label}</div>
      </div>
    </div>
  );
}

export default function InhouseOverviewPage() {
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/inhouse/overview")
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body.error?.message ?? "Failed to load overview.");
        return body.data;
      })
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load overview."))
      .finally(() => setLoading(false));
  }, []);

  const totalCandidates = data ? Object.values(data.candidateFunnel).reduce((a, b) => a + b, 0) : 0;
  const approved = data?.candidateFunnel.approved ?? 0;

  return (
    <PortalShell roleLabel="In-House Supervisor" navItems={INHOUSE_NAV_ITEMS}>
      <p className="eyebrow mb-3">
        <span className="eyebrow-rule" />
        Operations
      </p>
      <h1 className="section-title text-3xl md:text-4xl mb-2">
        {data?.countries.length ? `${data.countries.map((c) => c.name).join(", ")} overview.` : "Country overview."}
      </h1>
      <p className="text-midnight-900/55 font-light mb-8 max-w-2xl">
        The operational link between Management and your recruitment teams — recruiters, candidate pipeline, target
        performance, and reporting compliance across {data && data.countries.length > 1 ? "your assigned countries" : "your assigned country"}, all in one place.
      </p>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4 text-sm mb-6">{error}</div>}

      {loading ? (
        <p className="text-midnight-900/50">Loading…</p>
      ) : data ? (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 mb-8">
            <StatTile icon={Users} label="Recruiters" value={data.recruiterCount} />
            <StatTile icon={ClipboardText} label="Candidates (all time)" value={totalCandidates} />
            <StatTile icon={CheckCircle} label="Approved" value={approved} />
            <StatTile
              icon={UserCheck}
              label="Daily reports submitted today"
              value={`${data.dailyCompliance.submitted} / ${data.dailyCompliance.total}`}
            />
          </div>

          <div className="grid lg:grid-cols-2 gap-6 mb-8">
            <div className="card p-6">
              <h2 className="text-sm font-semibold text-midnight-900/70 uppercase tracking-wider mb-4 flex items-center gap-2">
                <ClipboardText size={16} weight="bold" className="text-gold-600" /> Candidate funnel
              </h2>
              <div className="space-y-2">
                {Object.entries(data.candidateFunnel).map(([status, count]) => (
                  <div key={status} className="flex items-center justify-between text-sm bg-ivory-100 rounded-lg px-3 py-2.5">
                    <span className="text-midnight-900/70">{STAGE_LABELS[status] ?? status}</span>
                    <span className="font-semibold text-midnight-900">{count}</span>
                  </div>
                ))}
              </div>
              <Link href="/inhouse/candidates" className="inline-block mt-4 text-xs font-semibold text-gold-600 hover:underline">
                View candidates →
              </Link>
            </div>

            <div className="card p-6">
              <h2 className="text-sm font-semibold text-midnight-900/70 uppercase tracking-wider mb-4 flex items-center gap-2">
                <Target size={16} weight="bold" className="text-gold-600" /> Campaign targets vs. actuals
              </h2>
              {data.campaignTargets.length === 0 ? (
                <p className="text-sm text-midnight-900/40">No active campaign targets yet.</p>
              ) : (
                <div className="space-y-2">
                  {data.campaignTargets.map((t) => (
                    <div key={t.id} className="flex items-center justify-between text-sm bg-ivory-100 rounded-lg px-3 py-2.5">
                      <span className="text-midnight-900/70">
                        {METRIC_LABELS[t.metric] ?? t.metric}{" "}
                        <span className="text-midnight-900/40 text-xs">
                          ({t.campaignName}{data.countries.length > 1 && t.country ? ` · ${t.country.name}` : ""})
                        </span>
                      </span>
                      <span className="font-semibold text-midnight-900">
                        {t.actualValue} / {t.targetValue}
                        {t.metric === "conversion_rate" ? "%" : ""}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              <Link href="/inhouse/campaigns" className="inline-block mt-4 text-xs font-semibold text-gold-600 hover:underline">
                Adjust targets →
              </Link>
            </div>
          </div>

          <div className="card p-6">
            <h2 className="text-sm font-semibold text-midnight-900/70 uppercase tracking-wider mb-4 flex items-center gap-2">
              <FileText size={16} weight="bold" className="text-gold-600" /> Reports awaiting your review
            </h2>
            {data.pendingCountryReports === 0 ? (
              <p className="text-sm text-midnight-900/40">Nothing outstanding — you&apos;re caught up.</p>
            ) : (
              <p className="text-sm text-midnight-900">
                <span className="font-semibold">{data.pendingCountryReports}</span> country report
                {data.pendingCountryReports === 1 ? "" : "s"} submitted by your Country Supervisor need review.
              </p>
            )}
            <Link href="/inhouse/reports" className="inline-block mt-4 text-xs font-semibold text-gold-600 hover:underline">
              Go to Reports →
            </Link>
          </div>

          {data.countrySupervisors.map((cs) => (
            <div key={cs.id} className="card p-6 mt-8">
              <h2 className="text-sm font-semibold text-midnight-900/70 uppercase tracking-wider mb-4 flex items-center gap-2">
                <UserCheck size={16} weight="bold" className="text-gold-600" /> {cs.full_name} — Country Supervisor
                {cs.assigned_country && data.countries.length > 1 ? ` (${cs.assigned_country.name})` : ""}
              </h2>
              <StaffScorecardPanel staffId={cs.id} />
            </div>
          ))}
        </>
      ) : null}
    </PortalShell>
  );
}
