"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import PortalShell from "@/components/portal/PortalShell";
import { MANAGEMENT_NAV_ITEMS } from "@/components/portal/managementNav";
import SearchableSelect from "@/components/SearchableSelect";
import { CheckCircle } from "@phosphor-icons/react";

interface Country { id: string; name: string; }

interface Rule {
  id: string;
  country_id: string;
  milestone: string;
  amount: number;
  currency: string;
}

const MILESTONES = [
  { value: "registered", label: "Registered" },
  { value: "qualified", label: "Qualified" },
  { value: "application_submitted", label: "Application Submitted" },
  { value: "work_permit_approved", label: "Work Permit Approved" },
  { value: "visa_approved", label: "Visa Approved" },
  { value: "deployed", label: "Deployed" },
] as const;

// Per-country x per-milestone commission-rule grid (2026-08-29) — a
// missing (country, milestone) row is treated as amount-0 everywhere it's
// read (generateReferralCommissionIfDue), so this grid always shows all 6
// milestones for the selected country, filling in 0 for any row that
// hasn't been explicitly saved yet.
export default function ReferralCommissionRulesPage() {
  const [countries, setCountries] = useState<Country[]>([]);
  const [countryId, setCountryId] = useState("");
  const [rules, setRules] = useState<Record<string, { amount: string; currency: string }>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [savedMilestone, setSavedMilestone] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/admin/countries")
      .then((r) => r.json())
      .then((res) => {
        setCountries(res.data ?? []);
        if (res.data?.[0]) setCountryId(res.data[0].id);
      })
      .catch(() => setError("Failed to load countries."))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!countryId) return;
    fetch(`/api/admin/referral-commission-rules?countryId=${countryId}`)
      .then((r) => r.json())
      .then((res) => {
        const byMilestone: Record<string, { amount: string; currency: string }> = {};
        for (const m of MILESTONES) byMilestone[m.value] = { amount: "0", currency: "USD" };
        for (const rule of (res.data ?? []) as Rule[]) {
          byMilestone[rule.milestone] = { amount: String(rule.amount), currency: rule.currency };
        }
        setRules(byMilestone);
      })
      .catch(() => setError("Failed to load commission rules."));
  }, [countryId]);

  const saveRow = async (milestone: string) => {
    const row = rules[milestone];
    if (!row) return;
    setSaving(milestone);
    setError("");
    setSavedMilestone(null);
    try {
      const res = await fetch("/api/admin/referral-commission-rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ country_id: countryId, milestone, amount: Number(row.amount) || 0, currency: row.currency }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error?.message || "Failed to save commission rule.");
      setSavedMilestone(milestone);
      setTimeout(() => setSavedMilestone((m) => (m === milestone ? null : m)), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save commission rule.");
    } finally {
      setSaving(null);
    }
  };

  const updateRow = (milestone: string, field: "amount" | "currency", value: string) => {
    setRules((prev) => ({ ...prev, [milestone]: { ...prev[milestone], [field]: value } }));
  };

  return (
    <PortalShell roleLabel="Management" navItems={MANAGEMENT_NAV_ITEMS}>
      <div className="flex items-center justify-between mb-2">
        <div>
          <p className="eyebrow mb-3">
            <span className="eyebrow-rule" />
            Referral Agent System
          </p>
          <h1 className="section-title text-3xl md:text-4xl mb-2">Commission Rules.</h1>
        </div>
        <Link href="/management/referral-agents" className="text-sm font-medium text-midnight-900/50 hover:text-gold-600">
          ← Back to Referral Agents
        </Link>
      </div>
      <p className="text-midnight-900/55 font-light mb-8 max-w-2xl">
        Set the commission amount a referral agent earns per milestone, per country. An amount of 0 is a deliberate,
        valid setting — that milestone simply pays nothing for candidates referred to this country.
      </p>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4 text-sm mb-6">{error}</div>}

      {loading ? (
        <p className="text-midnight-900/50">Loading…</p>
      ) : (
        <>
          <div className="max-w-xs mb-6">
            <label className="block text-xs font-medium text-midnight-900/60 mb-1.5">Country</label>
            <SearchableSelect
              value={countryId}
              onChange={setCountryId}
              className="input-field"
              options={countries.map((c) => ({ value: c.id, label: c.name }))}
            />
          </div>

          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-midnight-900/10 text-left text-midnight-900/40 text-xs uppercase tracking-wider">
                  <th className="px-5 py-3 font-semibold">Milestone</th>
                  <th className="px-5 py-3 font-semibold">Amount</th>
                  <th className="px-5 py-3 font-semibold">Currency</th>
                  <th className="px-5 py-3 font-semibold"></th>
                </tr>
              </thead>
              <tbody>
                {MILESTONES.map((m) => {
                  const row = rules[m.value] ?? { amount: "0", currency: "USD" };
                  return (
                    <tr key={m.value} className="border-b border-midnight-900/5 last:border-0">
                      <td className="px-5 py-3 font-medium text-midnight-900">{m.label}</td>
                      <td className="px-5 py-3">
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          value={row.amount}
                          onChange={(e) => updateRow(m.value, "amount", e.target.value)}
                          className="input-field w-32"
                        />
                      </td>
                      <td className="px-5 py-3">
                        <input
                          value={row.currency}
                          onChange={(e) => updateRow(m.value, "currency", e.target.value.toUpperCase())}
                          className="input-field w-20"
                          maxLength={10}
                        />
                      </td>
                      <td className="px-5 py-3">
                        <button
                          onClick={() => saveRow(m.value)}
                          disabled={saving === m.value}
                          className="btn-secondary text-xs px-4 disabled:opacity-60 flex items-center gap-1.5"
                        >
                          {savedMilestone === m.value ? <CheckCircle size={14} weight="fill" className="text-emerald-600" /> : null}
                          {saving === m.value ? "Saving…" : savedMilestone === m.value ? "Saved" : "Save"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </PortalShell>
  );
}
