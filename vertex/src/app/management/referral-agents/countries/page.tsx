"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import PortalShell from "@/components/portal/PortalShell";
import { MANAGEMENT_NAV_ITEMS } from "@/components/portal/managementNav";
import { Globe } from "@phosphor-icons/react";

interface CountryRow {
  id: string;
  name: string;
  activeAgents: number;
  candidatesReferred: number;
  pendingCommissionTotal: number;
}

// Country Management hub — list (§7.6 of the approved plan). Country/
// Region CRUD itself is unchanged and still lives at /admin/regions; this
// is a new, additive per-country aggregate view across the Referral Agent
// System's own data only.
export default function ReferralAgentCountriesPage() {
  const [countries, setCountries] = useState<CountryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/admin/referral-agents/countries")
      .then((r) => r.json())
      .then((res) => setCountries(res.data ?? []))
      .catch(() => setError("Failed to load countries."))
      .finally(() => setLoading(false));
  }, []);

  return (
    <PortalShell roleLabel="Management" navItems={MANAGEMENT_NAV_ITEMS}>
      <div className="flex items-center justify-between mb-2">
        <div>
          <p className="eyebrow mb-3">
            <span className="eyebrow-rule" />
            Referral Agent System
          </p>
          <h1 className="section-title text-3xl md:text-4xl mb-2">Country Management.</h1>
        </div>
        <Link href="/management/referral-agents" className="text-sm font-medium text-midnight-900/50 hover:text-gold-600">
          ← Back to Referral Agents
        </Link>
      </div>
      <p className="text-midnight-900/55 font-light mb-8 max-w-2xl">
        Which countries have real referral activity, at a glance. Open a country for its agents, referred
        candidates, programmes, commission rules/ledger, and performance in one place.
      </p>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4 text-sm mb-6">{error}</div>}

      {loading ? (
        <p className="text-midnight-900/50">Loading…</p>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-midnight-900/10 text-left text-midnight-900/40 text-xs uppercase tracking-wider">
                <th className="px-5 py-3 font-semibold">Country</th>
                <th className="px-5 py-3 font-semibold">Active Agents</th>
                <th className="px-5 py-3 font-semibold">Candidates Referred</th>
                <th className="px-5 py-3 font-semibold">Pending Commission</th>
              </tr>
            </thead>
            <tbody>
              {countries.map((c) => (
                <tr key={c.id} className="border-b border-midnight-900/5 last:border-0">
                  <td className="px-5 py-4">
                    <Link href={`/management/referral-agents/countries/${c.id}`} className="font-medium text-midnight-900 hover:text-gold-600 flex items-center gap-2">
                      <Globe size={15} weight="regular" className="text-gold-600 shrink-0" />
                      {c.name}
                    </Link>
                  </td>
                  <td className="px-5 py-4 text-midnight-900/70">{c.activeAgents}</td>
                  <td className="px-5 py-4 text-midnight-900/70">{c.candidatesReferred}</td>
                  <td className="px-5 py-4 text-midnight-900/70">{c.pendingCommissionTotal > 0 ? `$${c.pendingCommissionTotal.toLocaleString()}` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </PortalShell>
  );
}
