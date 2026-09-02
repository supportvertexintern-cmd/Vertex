"use client";

import { useEffect, useState, use } from "react";
import Link from "next/link";
import PortalShell from "@/components/portal/PortalShell";
import { MANAGEMENT_NAV_ITEMS } from "@/components/portal/managementNav";
import { ShareNetwork, Briefcase, Trophy } from "@phosphor-icons/react";

const STATUS_STYLES: Record<string, string> = {
  pending_approval: "bg-yellow-100 text-yellow-800",
  active: "bg-emerald-100 text-emerald-800",
  suspended: "bg-red-100 text-red-700",
  rejected: "bg-slate-100 text-slate-600",
};

const MILESTONE_LABELS: Record<string, string> = {
  registered: "Registered",
  qualified: "Qualified",
  application_submitted: "Application Submitted",
  work_permit_approved: "Work Permit Approved",
  visa_approved: "Visa Approved",
  deployed: "Deployed",
};

interface AgentRow {
  id: string;
  full_name: string;
  status: string;
  referral_code: string;
  _count: { candidates: number };
}

interface JobRow {
  id: string;
  title: string;
  city: string;
  status: string;
}

interface PerformanceRow {
  referralAgentId: string;
  referralAgentName: string;
  totalReferrals: number;
  qualified: number;
  deployed: number;
  totalCommissionEarned: number;
  currency: string;
}

interface Summary {
  country: { id: string; name: string };
  agents: AgentRow[];
  milestoneCounts: Record<string, number>;
  jobs: JobRow[];
  performance: PerformanceRow[];
  pendingCommissionTotal: number;
}

// Country Management hub — detail (§7.6). Every section here is assembled
// from data the rest of the Referral Agent System already produces (§6,
// §7.1-7.4) — Commission/Performance deep-link into those same pages with
// ?countryId= prefilled rather than duplicating their UI.
export default function ReferralAgentCountryDetailPage({ params }: { params: Promise<{ countryId: string }> }) {
  const { countryId } = use(params);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    setLoading(true);
    fetch(`/api/admin/referral-agents/countries/${countryId}/summary`)
      .then((r) => r.json())
      .then((res) => {
        if (res.error) throw new Error(res.error.message);
        setSummary(res.data);
      })
      .catch(() => setError("Failed to load country summary."))
      .finally(() => setLoading(false));
  }, [countryId]);

  if (loading) {
    return (
      <PortalShell roleLabel="Management" navItems={MANAGEMENT_NAV_ITEMS}>
        <p className="text-midnight-900/50">Loading…</p>
      </PortalShell>
    );
  }

  if (!summary) {
    return (
      <PortalShell roleLabel="Management" navItems={MANAGEMENT_NAV_ITEMS}>
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4 text-sm">{error || "Country not found."}</div>
      </PortalShell>
    );
  }

  return (
    <PortalShell roleLabel="Management" navItems={MANAGEMENT_NAV_ITEMS}>
      <div className="flex items-center justify-between mb-2">
        <div>
          <p className="eyebrow mb-3">
            <span className="eyebrow-rule" />
            Referral Agent System · Country Management
          </p>
          <h1 className="section-title text-3xl md:text-4xl mb-2">{summary.country.name}.</h1>
        </div>
        <Link href="/management/referral-agents/countries" className="text-sm font-medium text-midnight-900/50 hover:text-gold-600">
          ← Back to Countries
        </Link>
      </div>

      {/* Milestone breakdown */}
      <div className="card p-6 mb-8">
        <h2 className="text-xs font-semibold text-midnight-900/50 uppercase tracking-wider mb-4">Candidates by Milestone</h2>
        <div className="grid sm:grid-cols-3 lg:grid-cols-6 gap-4">
          {Object.entries(MILESTONE_LABELS).map(([key, label]) => (
            <div key={key}>
              <p className="text-xs text-midnight-900/50 mb-1">{label}</p>
              <p className="text-xl font-semibold text-midnight-900">{summary.milestoneCounts[key] ?? 0}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-6 mb-8">
        {/* Referral Partners */}
        <div className="card p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xs font-semibold text-midnight-900/50 uppercase tracking-wider">Referral Partners</h2>
            <ShareNetwork size={16} weight="regular" className="text-gold-600" />
          </div>
          {summary.agents.length === 0 ? (
            <p className="text-sm text-midnight-900/50">No referral agents in this country yet.</p>
          ) : (
            <div className="space-y-2">
              {summary.agents.map((a) => (
                <div key={a.id} className="flex items-center justify-between text-sm">
                  <Link href={`/management/referral-agents/${a.id}`} className="font-medium text-midnight-900 hover:text-gold-600">
                    {a.full_name}
                  </Link>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-midnight-900/50">{a._count.candidates} referred</span>
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ${STATUS_STYLES[a.status] ?? "bg-slate-100 text-slate-700"}`}>
                      {a.status.replace(/_/g, " ")}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Programmes */}
        <div className="card p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xs font-semibold text-midnight-900/50 uppercase tracking-wider">Programmes</h2>
            <Briefcase size={16} weight="regular" className="text-gold-600" />
          </div>
          {summary.jobs.length === 0 ? (
            <p className="text-sm text-midnight-900/50">No opportunities listed for this country yet.</p>
          ) : (
            <div className="space-y-2">
              {summary.jobs.map((j) => (
                <div key={j.id} className="flex items-center justify-between text-sm">
                  <Link href={`/marketing/jobs/${j.id}/edit`} className="font-medium text-midnight-900 hover:text-gold-600">
                    {j.title}
                  </Link>
                  <span className="text-xs text-midnight-900/50">{j.city} · {j.status}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Commission — deep-links, not a duplicate UI */}
      <div className="card p-6 mb-8">
        <h2 className="text-xs font-semibold text-midnight-900/50 uppercase tracking-wider mb-4">Commission</h2>
        <div className="flex items-center justify-between text-sm mb-4">
          <span className="text-midnight-900/60">Pending commission total in this country</span>
          <span className="font-semibold text-midnight-900">${summary.pendingCommissionTotal.toLocaleString()}</span>
        </div>
        <div className="flex gap-4 text-sm font-medium">
          <Link href={`/management/referral-agents/commission-rules`} className="text-gold-600 hover:underline">
            Edit Commission Rules →
          </Link>
          <Link href={`/management/referral-agents/commissions?countryId=${countryId}`} className="text-gold-600 hover:underline">
            View Commission Ledger →
          </Link>
        </div>
      </div>

      {/* Performance */}
      <div className="card p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xs font-semibold text-midnight-900/50 uppercase tracking-wider">Performance</h2>
          <Trophy size={16} weight="regular" className="text-gold-600" />
        </div>
        {summary.performance.length === 0 ? (
          <p className="text-sm text-midnight-900/50">No active agents to rank yet.</p>
        ) : (
          <div className="space-y-2">
            {summary.performance
              .slice()
              .sort((a, b) => b.totalReferrals - a.totalReferrals)
              .map((p) => (
                <div key={p.referralAgentId} className="flex items-center justify-between text-sm">
                  <Link href={`/management/referral-agents/${p.referralAgentId}`} className="font-medium text-midnight-900 hover:text-gold-600">
                    {p.referralAgentName}
                  </Link>
                  <span className="text-xs text-midnight-900/60">
                    {p.totalReferrals} referred · {p.deployed} deployed · {new Intl.NumberFormat("en-US", { style: "currency", currency: p.currency }).format(p.totalCommissionEarned)} earned
                  </span>
                </div>
              ))}
          </div>
        )}
        <Link href={`/management/referral-agents/performance`} className="inline-block mt-4 text-sm font-medium text-gold-600 hover:underline">
          View Full Performance Ranking →
        </Link>
      </div>
    </PortalShell>
  );
}
