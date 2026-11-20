"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import PortalShell from "@/components/portal/PortalShell";
import { MANAGEMENT_NAV_ITEMS } from "@/components/portal/managementNav";

// Phase 6 master dashboard page (doc §8) — partner onboarding progress,
// reporting compliance, partner performance rankings, team-member
// performance, commission balances and admin-fee revenue. All computed
// live by the API on every read.

interface PerformanceData {
  compliance: { onboarding_complete: number; agreements_signed: number; reports_received: number; applications_started: number };
  ranked: Array<{
    partner_id: string;
    partner_name: string;
    status: string;
    assigned_to: string | null;
    onboarding: { documents_submitted: boolean; mou_signed: boolean; sla_signed: boolean };
    registered: number;
    initiated: number;
    deployed_candidates: number;
    reports: number;
    follow_ups_open: number;
    commissions_earned: number;
    commissions_paid: number;
    commissions_outstanding: number;
  }>;
  teamPerformance: Array<{ team_member: string; partners_assigned: number; flagged: number; outstanding: number }>;
  totals: {
    total_partners: number;
    commissions_payable: number;
    commissions_approved: number;
    commissions_paid: number;
    commissions_outstanding: number;
    admin_fee_revenue: number;
    admin_fee_collected: number;
    open_follow_ups: number;
  };
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card p-4">
      <div className="text-xs font-semibold text-midnight-900/50 uppercase tracking-wider">{label}</div>
      <div className="text-xl font-bold text-midnight-900 mt-1">{value}</div>
      {sub && <div className="text-xs text-midnight-900/45 mt-0.5">{sub}</div>}
    </div>
  );
}

export default function PartnerPerformancePage() {
  const [data, setData] = useState<PerformanceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/management/partner-performance")
      .then((r) => r.json())
      .then((res) => { if (res.error) throw new Error(res.error.message); setData(res.data); })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load dashboard."))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <PortalShell roleLabel="Management" navItems={MANAGEMENT_NAV_ITEMS}>
        <div className="card p-10 text-center text-midnight-900/50">Loading…</div>
      </PortalShell>
    );
  }

  if (error || !data) {
    return (
      <PortalShell roleLabel="Management" navItems={MANAGEMENT_NAV_ITEMS}>
        <div className="card p-6 border-l-4 border-red-400 text-red-700 text-sm">{error}</div>
      </PortalShell>
    );
  }

  const usd = (n: number) => `USD ${n.toLocaleString()}`;
  const { compliance: c, ranked, teamPerformance: team, totals: t } = data;
  const pct = (n: number) => (t.total_partners === 0 ? "—" : `${Math.round((n / t.total_partners) * 100)}%`);

  return (
    <PortalShell roleLabel="Management" navItems={MANAGEMENT_NAV_ITEMS}>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-midnight-900">Partner & Commission Performance</h1>
        <p className="text-sm text-midnight-900/50 mt-1">Onboarding, reporting, application progress, partner rankings and financial balances — live from the ledgers.</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 mb-8">
        <Stat label="Commissions payable" value={usd(t.commissions_payable)} sub={`${usd(t.commissions_approved)} approved`} />
        <Stat label="Commissions paid" value={usd(t.commissions_paid)} />
        <Stat label="Outstanding liability" value={usd(t.commissions_outstanding)} />
        <Stat label="Admin fee revenue" value={usd(t.admin_fee_revenue)} sub={`${usd(t.admin_fee_collected)} collected`} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <Stat label="Onboarding complete" value={`${c.onboarding_complete}/${t.total_partners}`} sub={pct(c.onboarding_complete)} />
        <Stat label="Agreements signed" value={`${c.agreements_signed}/${t.total_partners}`} sub={pct(c.agreements_signed)} />
        <Stat label="Reports received" value={`${c.reports_received}/${t.total_partners}`} sub={pct(c.reports_received)} />
        <Stat label="Applications started" value={`${c.applications_started}/${t.total_partners}`} sub={pct(c.applications_started)} />
      </div>

      <h2 className="text-sm font-semibold text-midnight-900/50 uppercase tracking-wider mb-3">Partner performance rankings</h2>
      {ranked.length === 0 ? (
        <div className="card p-8 text-center text-midnight-900/50 mb-8">No partners yet.</div>
      ) : (
        <div className="card overflow-x-auto mb-8">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-midnight-900/10 text-left text-midnight-900/40 text-xs uppercase tracking-wider">
                <th className="px-4 py-3">#</th>
                <th className="px-4 py-3">Partner</th>
                <th className="px-4 py-3">Assigned to</th>
                <th className="px-4 py-3">Onboarding</th>
                <th className="px-4 py-3">Registered</th>
                <th className="px-4 py-3">Deployed</th>
                <th className="px-4 py-3">Earned</th>
                <th className="px-4 py-3">Paid</th>
                <th className="px-4 py-3">Outstanding</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {ranked.map((r, i) => (
                <tr key={r.partner_id} className="border-b border-midnight-900/5">
                  <td className="px-4 py-3 text-midnight-900/50">{i + 1}</td>
                  <td className="px-4 py-3 font-semibold">{r.partner_name}</td>
                  <td className="px-4 py-3">{r.assigned_to ?? "—"}</td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <span className={`badge ${r.onboarding.mou_signed ? "bg-emerald-100 text-emerald-800" : "bg-yellow-100 text-yellow-800"}`}>MOU</span>
                    <span className={`badge ml-1 ${r.onboarding.sla_signed ? "bg-emerald-100 text-emerald-800" : "bg-yellow-100 text-yellow-800"}`}>SLA</span>
                    <span className={`badge ml-1 ${r.onboarding.documents_submitted ? "bg-emerald-100 text-emerald-800" : "bg-orange-100 text-orange-700"}`}>Docs</span>
                  </td>
                  <td className="px-4 py-3">
                    {r.registered}
                    {r.initiated !== r.registered && (
                      <span className="block text-[11px] text-midnight-900/40">{r.initiated} initiated</span>
                    )}
                  </td>
                  <td className="px-4 py-3">{r.deployed_candidates}</td>
                  <td className="px-4 py-3 font-semibold">{usd(r.commissions_earned)}</td>
                  <td className="px-4 py-3">{usd(r.commissions_paid)}</td>
                  <td className="px-4 py-3">{usd(r.commissions_outstanding)}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <Link href={`/management/partners/${r.partner_id}`} className="text-gold-600 font-semibold hover:underline">Open</Link>
                    {r.follow_ups_open > 0 && <span className="ml-2 badge bg-red-100 text-red-700">{r.follow_ups_open} follow-ups</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2 className="text-sm font-semibold text-midnight-900/50 uppercase tracking-wider mb-3">Team member performance</h2>
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-midnight-900/10 text-left text-midnight-900/40 text-xs uppercase tracking-wider">
              <th className="px-4 py-3">Team member</th>
              <th className="px-4 py-3">Partners assigned</th>
              <th className="px-4 py-3">Flagged</th>
              <th className="px-4 py-3">Outstanding commissions</th>
            </tr>
          </thead>
          <tbody>
            {team.map((m) => (
              <tr key={m.team_member} className="border-b border-midnight-900/5">
                <td className="px-4 py-3 font-semibold">{m.team_member}</td>
                <td className="px-4 py-3">{m.partners_assigned}</td>
                <td className="px-4 py-3">{m.flagged}</td>
                <td className="px-4 py-3">{usd(m.outstanding)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </PortalShell>
  );
}