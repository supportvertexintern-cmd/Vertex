"use client";

import { useEffect, useState } from "react";
import PortalShell from "@/components/portal/PortalShell";
import { MANAGEMENT_NAV_ITEMS } from "@/components/portal/managementNav";
import SearchableSelect from "@/components/SearchableSelect";

// Vertex's own administrative fees ledger (doc §6) — view-only. Recorded
// separately from partner commissions; filters by partner / fee type /
// status. Mark-paid/export flows can be layered on later if Finance needs
// them — the schema and APIs already carry status + payer fields.

interface PartnerOption { id: string; name: string; }
interface AdminFeeRow {
  id: string;
  fee_type: "application" | "deployment_monthly";
  period: string;
  amount: number;
  currency: string;
  status: "pending" | "approved" | "paid" | "rejected";
  created_at: string;
  partner: { id: string; name: string };
  candidate: { id: string; full_name: string | null };
}

const FEE_LABELS: Record<string, string> = {
  application: "Application (USD 10)",
  deployment_monthly: "Monthly (deployment, USD 40)",
};

const STATUS_STYLES: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-800",
  approved: "bg-blue-100 text-blue-700",
  paid: "bg-emerald-100 text-emerald-800",
  rejected: "bg-red-100 text-red-700",
};

export default function AdminFeesPage() {
  const [partners, setPartners] = useState<PartnerOption[]>([]);
  const [partnerFilter, setPartnerFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("pending");
  const [fees, setFees] = useState<AdminFeeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/admin/partners").then((r) => r.json()).then((res) => setPartners(res.data ?? [])).catch(() => {});
  }, []);

  const load = () => {
    const params = new URLSearchParams();
    if (partnerFilter) params.set("partnerId", partnerFilter);
    if (statusFilter) params.set("status", statusFilter);
    fetch(`/api/admin/admin-fees?${params}`)
      .then((r) => r.json())
      .then((res) => {
        setError("");
        setFees(res.data ?? []);
      })
      .catch(() => setError("Failed to load admin fees."))
      .finally(() => setLoading(false));
  };

  useEffect(load, [partnerFilter, statusFilter]);

  return (
    <PortalShell roleLabel="Management" navItems={MANAGEMENT_NAV_ITEMS}>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-midnight-900">Admin Fees</h1>
        <p className="text-sm text-midnight-900/50 mt-1">Vertex&apos;s separate fee ledger — USD 10 per application (except 100% financed programmes) and USD 40 per deployed candidate per month for six months.</p>
      </div>

      <div className="card p-4 mb-6 flex flex-col md:flex-row gap-3 md:items-center">
        <div className="w-full md:w-64">
          <SearchableSelect
            id="partner-filter"
            value={partnerFilter}
            onChange={setPartnerFilter}
            options={[{ value: "", label: "All partners" }, ...partners.map((p) => ({ value: p.id, label: p.name }))]}
          />
        </div>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="input-field w-full md:w-64">
          <option value="pending">Pending only</option>
          <option value="paid">Paid</option>
          <option value="">All</option>
        </select>
      </div>

      {error && <div className="card p-4 mb-6 border-l-4 border-red-400 text-red-700 text-sm">{error}</div>}

      <div className="card overflow-x-auto">
        {loading ? (
          <div className="p-10 text-center text-midnight-900/50">Loading fees…</div>
        ) : fees.length === 0 ? (
          <div className="p-10 text-center text-midnight-900/50">No admin fees match this filter.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-midnight-900/10 text-left text-midnight-900/40 text-xs uppercase tracking-wider">
                <th className="px-4 py-3">Partner</th>
                <th className="px-4 py-3">Candidate</th>
                <th className="px-4 py-3">Fee</th>
                <th className="px-4 py-3">Period</th>
                <th className="px-4 py-3">Amount</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Recorded</th>
              </tr>
            </thead>
            <tbody>
              {fees.map((f) => (
                <tr key={f.id} className="border-b border-midnight-900/5">
                  <td className="px-4 py-3">{f.partner.name}</td>
                  <td className="px-4 py-3">{f.candidate.full_name ?? "—"}</td>
                  <td className="px-4 py-3">{FEE_LABELS[f.fee_type] ?? f.fee_type}</td>
                  <td className="px-4 py-3">{f.fee_type === "application" ? "Application" : f.period}</td>
                  <td className="px-4 py-3 font-semibold">{f.currency} {f.amount.toLocaleString()}</td>
                  <td className="px-4 py-3"><span className={`badge ${STATUS_STYLES[f.status] ?? ""}`}>{f.status}</span></td>
                  <td className="px-4 py-3">{new Date(f.created_at).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </PortalShell>
  );
}