"use client";

import { useEffect, useState } from "react";
import PortalShell from "@/components/portal/PortalShell";
import { MANAGEMENT_NAV_ITEMS } from "@/components/portal/managementNav";

// The Phase 6 partner commission rules grid — exactly two global rows
// (registration USD 10, monthly_deployment USD 40 by default). Amounts are
// rolled into generatePartnerCommissionsIfDue on the next event; rules
// rows are an override surface, and a missing row falls back to the doc
// defaults.

interface RuleRow {
  id: string | null;
  rule_type: "registration" | "monthly_deployment";
  amount: string;
  currency: string;
}

const RULE_DEFAULTS: Record<string, number> = { registration: 10, monthly_deployment: 40 };

const RULE_META: Record<string, { label: string; description: string }> = {
  registration: {
    label: "Registration (per registered candidate)",
    description: "USD 10 — earned once when a partner submission bridges a candidate into the system.",
  },
  monthly_deployment: {
    label: "Monthly deployment (per deployed candidate)",
    description: "USD 40 — six auto-generated monthly rows from the deployment month.",
  },
};

export default function PartnerCommissionRulesPage() {
  const [rules, setRules] = useState<RuleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = () => {
    fetch("/api/admin/partner-commission-rules")
      .then((r) => r.json())
      .then((res) => {
        const existing = res.data ?? [];
        const rows: RuleRow[] = (["registration", "monthly_deployment"] as const).map((t) => {
          const found = existing.find((r: { rule_type: string }) => r.rule_type === t);
          return {
            id: found?.id ?? null,
            rule_type: t,
            amount: String(found?.amount ?? RULE_DEFAULTS[t]),
            currency: found?.currency ?? "USD",
          };
        });
        setRules(rows);
      })
      .catch(() => setError("Failed to load commission rules."))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const updateAmount = (rule_type: string, amount: string) => {
    setRules((prev) => prev.map((r) => (r.rule_type === rule_type ? { ...r, amount } : r)));
  };

  const save = async (rule: RuleRow) => {
    setSaving(true);
    setError("");
    setNotice("");
    const res = await fetch("/api/admin/partner-commission-rules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rule_type: rule.rule_type, amount: Number(rule.amount), currency: rule.currency }),
    });
    const payload = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) {
      setError(payload?.error?.message ?? "Failed to save rule.");
      return;
    }
    setNotice(`${RULE_META[rule.rule_type].label} updated — applies to commissions generated from now on.`);
    load();
  };

  return (
    <PortalShell roleLabel="Management" navItems={MANAGEMENT_NAV_ITEMS}>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-midnight-900">Partner Commission Rules</h1>
        <p className="text-sm text-midnight-900/50 mt-1">Amounts paid to partners per event. Changing a rule affects only commissions generated afterwards — existing ledger rows keep their snapshotted amount.</p>
      </div>

      {error && <div className="card p-4 mb-6 border-l-4 border-red-400 text-red-700 text-sm">{error}</div>}
      {notice && <div className="card p-4 mb-6 border-l-4 border-emerald-400 text-emerald-700 text-sm">{notice}</div>}

      <div className="space-y-4 max-w-2xl">
        {loading ? (
          <div className="card p-10 text-center text-midnight-900/50">Loading rules…</div>
        ) : (
          rules.map((rule) => (
            <div key={rule.rule_type} className="card p-6">
              <h3 className="font-semibold text-midnight-900">{RULE_META[rule.rule_type].label}</h3>
              <p className="text-xs text-midnight-900/50 mt-1 mb-4">{RULE_META[rule.rule_type].description}</p>
              <div className="flex items-end gap-3">
                <div>
                  <label className="block text-xs font-semibold text-midnight-900/50 uppercase tracking-wider mb-1">Amount (USD)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={rule.amount}
                    disabled={saving}
                    onChange={(e) => updateAmount(rule.rule_type, e.target.value)}
                    className="input-field w-40"
                  />
                </div>
                <button onClick={() => save(rule)} disabled={saving} className="btn-primary">
                  {saving ? "Saving…" : "Save"}
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </PortalShell>
  );
}