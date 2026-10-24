"use client";

import { useEffect, useState } from "react";
import PortalShell from "@/components/portal/PortalShell";
import { MANAGEMENT_NAV_ITEMS } from "@/components/portal/managementNav";
import SearchableSelect from "@/components/SearchableSelect";
import Pagination from "@/components/Pagination";
import { usePagination } from "@/lib/usePagination";
import { describeApiError } from "@/lib/apiError";

interface FeePolicy {
  id: string;
  country_id: string | null;
  country: { name: string } | null;
  enabled: boolean;
  documentation_amount: number | null;
  permit_amount: number | null;
  visa_amount: number | null;
  currency: string;
  updated_at: string;
}

interface Country { id: string; name: string; }

export default function FeePolicyPage() {
  const [policies, setPolicies] = useState<FeePolicy[]>([]);
  const [countries, setCountries] = useState<Country[]>([]);
  const [loading, setLoading] = useState(true);

  const [countryId, setCountryId] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [documentationAmount, setDocumentationAmount] = useState("");
  const [permitAmount, setPermitAmount] = useState("");
  const [visaAmount, setVisaAmount] = useState("");
  const [currency, setCurrency] = useState("USD");

  const load = () => {
    Promise.all([
      fetch("/api/fee-policy").then((r) => r.json()),
      fetch("/api/admin/countries").then((r) => r.json()),
    ]).then(([feeRes, countryRes]) => {
      setPolicies(feeRes.data ?? []);
      setCountries(countryRes.data ?? []);
      setLoading(false);
    });
  };

  useEffect(load, []);

  const { page, setPage, totalPages, paged, total, pageSize } = usePagination(policies);

  const save = async () => {
    const res = await fetch("/api/fee-policy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        country_id: countryId || null,
        enabled,
        documentation_amount: documentationAmount ? Number(documentationAmount) : null,
        permit_amount: permitAmount ? Number(permitAmount) : null,
        visa_amount: visaAmount ? Number(visaAmount) : null,
        currency,
      }),
    });
    const json = await res.json();
    if (!res.ok) { alert(describeApiError(json, "Failed to save.")); return; }
    setCountryId(""); setEnabled(false); setDocumentationAmount(""); setPermitAmount(""); setVisaAmount(""); setCurrency("USD");
    load();
  };

  return (
    <PortalShell roleLabel="Management" navItems={MANAGEMENT_NAV_ITEMS}>
      <p className="eyebrow mb-3">
        <span className="eyebrow-rule" />
        Mobility Lifecycle
      </p>
      <h1 className="section-title text-3xl md:text-4xl mb-2">Fee policy.</h1>
      <p className="text-midnight-900/55 font-light mb-8 max-w-2xl">
        SRS FR-4.5 — milestone-payment recording defaults off. Turn it on globally or per destination country, and
        set the three stage amounts (documentation · 25%, work permit · 25%, visa · 50%) whenever the business is ready.
      </p>

      {loading ? (
        <p className="text-midnight-900/50">Loading…</p>
      ) : (
        <>
          <div className="card p-6 mb-6">
            <h2 className="text-sm font-semibold text-midnight-900/70 uppercase tracking-wider mb-4">Set a policy</h2>
            <div className="grid sm:grid-cols-3 lg:grid-cols-6 gap-3 items-end">
              <div>
                <label className="block text-xs font-medium text-midnight-900/60 mb-1">Country</label>
                <SearchableSelect
                  value={countryId}
                  onChange={setCountryId}
                  placeholder="Global default"
                  className="input-field text-sm"
                  options={[{ value: "", label: "Global default" }, ...countries.map((c) => ({ value: c.id, label: c.name }))]}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-midnight-900/60 mb-1">Documentation (Stage 1 · 25%)</label>
                <input type="number" min="0" value={documentationAmount} onChange={(e) => setDocumentationAmount(e.target.value)} className="input-field text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-midnight-900/60 mb-1">Work Permit (Stage 2 · 25%)</label>
                <input type="number" min="0" value={permitAmount} onChange={(e) => setPermitAmount(e.target.value)} className="input-field text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-midnight-900/60 mb-1">Visa (Stage 3 · 50%)</label>
                <input type="number" min="0" value={visaAmount} onChange={(e) => setVisaAmount(e.target.value)} className="input-field text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-midnight-900/60 mb-1">Currency</label>
                <input value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} maxLength={3} className="input-field text-sm" />
              </div>
              <label className="flex items-center gap-2 text-sm text-midnight-900/70 pb-2.5">
                <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
                Enabled
              </label>
            </div>
            <button onClick={save} className="btn-primary text-xs mt-4">Save Policy</button>
          </div>

          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-midnight-900/10 text-left text-midnight-900/40 text-xs uppercase tracking-wider">
                  <th className="px-5 py-3 font-semibold">Scope</th>
                  <th className="px-5 py-3 font-semibold">Enabled</th>
                  <th className="px-5 py-3 font-semibold">Documentation</th>
                  <th className="px-5 py-3 font-semibold">Work Permit</th>
                  <th className="px-5 py-3 font-semibold">Visa</th>
                  <th className="px-5 py-3 font-semibold">Updated</th>
                </tr>
              </thead>
              <tbody>
                {policies.length === 0 && (
                  <tr><td colSpan={6} className="px-5 py-8 text-center text-midnight-900/40">No policies set yet — milestone payments are disabled everywhere by default.</td></tr>
                )}
                {paged.map((p) => (
                  <tr key={p.id} className="border-b border-midnight-900/5 last:border-0">
                    <td className="px-5 py-4 font-medium text-midnight-900">{p.country?.name ?? "Global default"}</td>
                    <td className="px-5 py-4">{p.enabled ? <span className="badge-approved">Enabled</span> : <span className="badge-closed">Disabled</span>}</td>
                    <td className="px-5 py-4 text-midnight-900/70">{p.documentation_amount ? `${p.currency} ${p.documentation_amount}` : "—"}</td>
                    <td className="px-5 py-4 text-midnight-900/70">{p.permit_amount ? `${p.currency} ${p.permit_amount}` : "—"}</td>
                    <td className="px-5 py-4 text-midnight-900/70">{p.visa_amount ? `${p.currency} ${p.visa_amount}` : "—"}</td>
                    <td className="px-5 py-4 text-midnight-900/45">{new Date(p.updated_at).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="px-5">
              <Pagination page={page} totalPages={totalPages} onPageChange={setPage} total={total} pageSize={pageSize} />
            </div>
          </div>
        </>
      )}
    </PortalShell>
  );
}
