"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import PortalShell from "@/components/portal/PortalShell";
import { MANAGEMENT_NAV_ITEMS } from "@/components/portal/managementNav";
import SearchableSelect from "@/components/SearchableSelect";
import { Trophy } from "@phosphor-icons/react";

interface Country { id: string; name: string; }

interface PerformanceRow {
  referralAgentId: string;
  referralAgentName: string;
  countryName: string | null;
  totalReferrals: number;
  qualified: number;
  deployed: number;
  totalCommissionEarned: number;
  currency: string;
}

// Live performance ranking (2026-08-29) — no stored cache, same shape as
// Partner Performance. Sorted by total referrals, highest first.
export default function ReferralAgentPerformancePage() {
  const [countries, setCountries] = useState<Country[]>([]);
  const [countryId, setCountryId] = useState("");
  const [rows, setRows] = useState<PerformanceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/admin/countries").then((r) => r.json()).then((res) => setCountries(res.data ?? [])).catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (countryId) params.set("countryId", countryId);
    fetch(`/api/admin/referral-agents/performance?${params}`)
      .then((r) => r.json())
      .then((res) => setRows((res.data ?? []).sort((a: PerformanceRow, b: PerformanceRow) => b.totalReferrals - a.totalReferrals)))
      .catch(() => setError("Failed to load performance data."))
      .finally(() => setLoading(false));
  }, [countryId]);

  return (
    <PortalShell roleLabel="Management" navItems={MANAGEMENT_NAV_ITEMS}>
      <div className="flex items-center justify-between mb-2">
        <div>
          <p className="eyebrow mb-3">
            <span className="eyebrow-rule" />
            Referral Agent System
          </p>
          <h1 className="section-title text-3xl md:text-4xl mb-2">Performance.</h1>
        </div>
        <Link href="/management/referral-agents" className="text-sm font-medium text-midnight-900/50 hover:text-gold-600">
          ← Back to Referral Agents
        </Link>
      </div>
      <p className="text-midnight-900/55 font-light mb-8 max-w-2xl">Active referral agents ranked by total referrals.</p>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4 text-sm mb-6">{error}</div>}

      <div className="max-w-xs mb-6">
        <SearchableSelect
          value={countryId}
          onChange={setCountryId}
          className="input-field"
          options={[{ value: "", label: "All countries" }, ...countries.map((c) => ({ value: c.id, label: c.name }))]}
        />
      </div>

      {loading ? (
        <p className="text-midnight-900/50">Loading…</p>
      ) : rows.length === 0 ? (
        <div className="card p-10 text-center text-midnight-900/50">No active referral agents to rank yet.</div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-midnight-900/10 text-left text-midnight-900/40 text-xs uppercase tracking-wider">
                <th className="px-5 py-3 font-semibold">Rank</th>
                <th className="px-5 py-3 font-semibold">Agent</th>
                <th className="px-5 py-3 font-semibold">Country</th>
                <th className="px-5 py-3 font-semibold">Total Referrals</th>
                <th className="px-5 py-3 font-semibold">Qualified</th>
                <th className="px-5 py-3 font-semibold">Deployed</th>
                <th className="px-5 py-3 font-semibold">Commission Earned</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.referralAgentId} className="border-b border-midnight-900/5 last:border-0">
                  <td className="px-5 py-4 text-midnight-900/60">
                    {i === 0 ? <Trophy size={16} weight="fill" className="text-gold-500" /> : `#${i + 1}`}
                  </td>
                  <td className="px-5 py-4">
                    <Link href={`/management/referral-agents/${r.referralAgentId}`} className="font-medium text-midnight-900 hover:text-gold-600">
                      {r.referralAgentName}
                    </Link>
                  </td>
                  <td className="px-5 py-4 text-midnight-900/70">{r.countryName ?? "—"}</td>
                  <td className="px-5 py-4 text-midnight-900/70">{r.totalReferrals}</td>
                  <td className="px-5 py-4 text-midnight-900/70">{r.qualified}</td>
                  <td className="px-5 py-4 text-midnight-900/70">{r.deployed}</td>
                  <td className="px-5 py-4 font-medium text-midnight-900">
                    {new Intl.NumberFormat("en-US", { style: "currency", currency: r.currency }).format(r.totalCommissionEarned)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </PortalShell>
  );
}
