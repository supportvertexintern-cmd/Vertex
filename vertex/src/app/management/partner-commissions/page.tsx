"use client";

import { useEffect, useState } from "react";
import PortalShell from "@/components/portal/PortalShell";
import { MANAGEMENT_NAV_ITEMS } from "@/components/portal/managementNav";
import SearchableSelect from "@/components/SearchableSelect";

// Management payout queue for partner commissions (Phase 6 §3C). Two-step
// lifecycle mirrors the referral commissions queue: pending -> approved
// (director/admin) -> paid (with optional payment reference/method).
// Money movement, so the page lives under /management (director/admin
// portal); the API additionally guards approve/mark-paid to
// director/admin only.

interface PartnerOption { id: string; name: string; }
interface CommissionRow {
  id: string;
  rule_type: "registration" | "monthly_deployment";
  period: string;
  amount: number;
  currency: string;
  status: "pending" | "approved" | "paid" | "rejected";
  created_at: string;
  partner: { id: string; name: string; contact_email: string };
  candidate: { id: string; full_name: string | null };
}

const RULE_LABELS: Record<string, string> = {
  registration: "Registration",
  monthly_deployment: "Monthly (deployment)",
};

const STATUS_STYLES: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-800",
  approved: "bg-blue-100 text-blue-700",
  paid: "bg-emerald-100 text-emerald-800",
  rejected: "bg-red-100 text-red-700",
};

const STATUS_FILTER_OPTIONS = [
  { value: "pending,approved", label: "Pending & Approved (payout queue)" },
  { value: "pending", label: "Pending only" },
  { value: "approved", label: "Approved only" },
  { value: "paid", label: "Paid" },
  { value: "", label: "All" },
];

export default function PartnerCommissionsPage() {
  const [partners, setPartners] = useState<PartnerOption[]>([]);
  const [partnerFilter, setPartnerFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("pending,approved");
  const [commissions, setCommissions] = useState<CommissionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [actingId, setActingId] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/partners").then((r) => r.json()).then((res) => setPartners(res.data ?? [])).catch(() => {});
  }, []);

  const load = () => {
    const params = new URLSearchParams();
    if (partnerFilter) params.set("partnerId", partnerFilter);
    if (statusFilter) params.set("status", statusFilter);
    fetch(`/api/admin/partner-commissions?${params}`)
      .then((r) => r.json())
      .then((res) => {
        setError("");
        setCommissions(res.data ?? []);
      })
      .catch(() => setError("Failed to load commissions."))
      .finally(() => setLoading(false));
  };

  useEffect(load, [partnerFilter, statusFilter]);

  const handleAction = async (id: string, action: "approve" | "mark-paid") => {
    setActingId(id);
    const body = action === "mark-paid"
      ? JSON.stringify({ payment_reference: "", payment_method: "" })
      : undefined;
    const res = await fetch(`/api/admin/partner-commissions/${id}/${action}`, {
      method: "POST",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body,
    });
    const payload = await res.json().catch(() => ({}));
    setActingId(null);
    if (!res.ok) {
      setError(payload?.error?.message ?? "Action failed.");
      return;
    }
    setError("");
    setNotice(action === "approve" ? "Commission approved." : "Commission marked as paid.");
    load();
  };

  return (
    <PortalShell roleLabel="Management" navItems={MANAGEMENT_NAV_ITEMS}>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-midnight-900">Partner Commissions</h1>
        <p className="text-sm text-midnight-900/50 mt-1">Registration (USD 10) and post-deployment monthly (USD 40 × 6) commissions across all partners.</p>
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
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="input-field w-full md:w-64"
        >
          {STATUS_FILTER_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      {error && <div className="card p-4 mb-6 border-l-4 border-red-400 text-red-700 text-sm">{error}</div>}
      {notice && <div className="card p-4 mb-6 border-l-4 border-emerald-400 text-emerald-700 text-sm">{notice}</div>}

      <div className="card overflow-x-auto">
        {loading ? (
          <div className="p-10 text-center text-midnight-900/50">Loading commissions…</div>
        ) : commissions.length === 0 ? (
          <div className="p-10 text-center text-midnight-900/50">No commissions match this filter.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-midnight-900/10 text-left text-midnight-900/40 text-xs uppercase tracking-wider">
                <th className="px-4 py-3">Partner</th>
                <th className="px-4 py-3">Candidate</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Period</th>
                <th className="px-4 py-3">Amount</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Created</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {commissions.map((c) => (
                <tr key={c.id} className="border-b border-midnight-900/5">
                  <td className="px-4 py-3">{c.partner.name}</td>
                  <td className="px-4 py-3">{c.candidate.full_name ?? "—"}</td>
                  <td className="px-4 py-3">{RULE_LABELS[c.rule_type] ?? c.rule_type}</td>
                  <td className="px-4 py-3">{c.rule_type === "registration" ? "Registration" : c.period}</td>
                  <td className="px-4 py-3 font-semibold">{c.currency} {c.amount.toLocaleString()}</td>
                  <td className="px-4 py-3"><span className={`badge ${STATUS_STYLES[c.status] ?? ""}`}>{c.status}</span></td>
                  <td className="px-4 py-3">{new Date(c.created_at).toLocaleDateString()}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    {c.status === "pending" && (
                      <button
                        onClick={() => handleAction(c.id, "approve")}
                        disabled={actingId === c.id}
                        className="btn-secondary text-xs mr-2"
                      >
                        {actingId === c.id ? "…" : "Approve"}
                      </button>
                    )}
                    {c.status === "approved" && (
                      <button
                        onClick={() => handleAction(c.id, "mark-paid")}
                        disabled={actingId === c.id}
                        className="btn-primary text-xs"
                      >
                        {actingId === c.id ? "…" : "Mark Paid"}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </PortalShell>
  );
}