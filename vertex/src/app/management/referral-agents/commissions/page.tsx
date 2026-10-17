"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import PortalShell from "@/components/portal/PortalShell";
import { MANAGEMENT_NAV_ITEMS } from "@/components/portal/managementNav";
import SearchableSelect from "@/components/SearchableSelect";
import Pagination from "@/components/Pagination";
import { usePagination } from "@/lib/usePagination";
import { useUrlListState } from "@/lib/useUrlListState";
import { CheckCircle, CurrencyDollar } from "@phosphor-icons/react";

interface Country { id: string; name: string; }

interface CommissionRow {
  id: string;
  milestone: string;
  amount: number;
  currency: string;
  status: string;
  created_at: string;
  referral_agent: { id: string; full_name: string; email: string };
  candidate: { id: string; full_name: string | null; country: { id: string; name: string } | null };
}

const MILESTONE_LABELS: Record<string, string> = {
  registered: "Registered",
  qualified: "Qualified",
  application_submitted: "Application Submitted",
  work_permit_approved: "Work Permit Approved",
  visa_approved: "Visa Approved",
  deployed: "Deployed",
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

export default function ReferralCommissionsPage() {
  // Reads ?countryId= on initial load — the Country Management hub's
  // "View Commission Ledger" link deep-links here with it prefilled
  // (same useUrlListState precedent as HR's self-applications queue).
  const urlState = useUrlListState();
  const [countries, setCountries] = useState<Country[]>([]);
  const [countryFilter, setCountryFilter] = useState(() => urlState.get("countryId"));
  const [statusFilter, setStatusFilter] = useState("pending,approved");
  const [commissions, setCommissions] = useState<CommissionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [actingId, setActingId] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/countries").then((r) => r.json()).then((res) => setCountries(res.data ?? [])).catch(() => {});
  }, []);

  const load = () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (countryFilter) params.set("countryId", countryFilter);
    fetch(`/api/admin/referral-commissions?${params}`)
      .then((r) => r.json())
      .then((res) => setCommissions(res.data ?? []))
      .catch(() => setError("Failed to load commissions."))
      .finally(() => setLoading(false));
  };

  useEffect(load, [countryFilter]);

  const visible = useMemo(() => {
    if (!statusFilter) return commissions;
    const statuses = statusFilter.split(",");
    return commissions.filter((c) => statuses.includes(c.status));
  }, [commissions, statusFilter]);

  const { page, setPage, totalPages, paged, total, pageSize } = usePagination(visible);

  useEffect(() => setPage(1), [statusFilter, countryFilter]);

  const approve = async (id: string) => {
    setActingId(id);
    setError("");
    setNotice("");
    try {
      const res = await fetch(`/api/admin/referral-commissions/${id}/approve`, { method: "POST" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error?.message || "Failed to approve commission.");
      setNotice("Commission approved.");
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to approve commission.");
    } finally {
      setActingId(null);
    }
  };

  const markPaid = async (id: string) => {
    const reference = window.prompt("Payment reference (optional):") || undefined;
    setActingId(id);
    setError("");
    setNotice("");
    try {
      const res = await fetch(`/api/admin/referral-commissions/${id}/mark-paid`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payment_reference: reference }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error?.message || "Failed to mark commission paid.");
      setNotice("Commission marked as paid.");
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to mark commission paid.");
    } finally {
      setActingId(null);
    }
  };

  return (
    <PortalShell roleLabel="Management" navItems={MANAGEMENT_NAV_ITEMS}>
      <div className="flex items-center justify-between mb-2">
        <div>
          <p className="eyebrow mb-3">
            <span className="eyebrow-rule" />
            Referral Agent System
          </p>
          <h1 className="section-title text-3xl md:text-4xl mb-2">Commissions.</h1>
        </div>
        <Link href="/management/referral-agents" className="text-sm font-medium text-midnight-900/50 hover:text-gold-600">
          ← Back to Referral Agents
        </Link>
      </div>
      <p className="text-midnight-900/55 font-light mb-8 max-w-2xl">
        Approve pending commissions, then mark them paid once the payout has actually gone out.
      </p>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4 text-sm mb-6">{error}</div>}
      {notice && <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-lg p-4 text-sm mb-6">{notice}</div>}

      <div className="flex flex-wrap gap-4 mb-6">
        <SearchableSelect value={statusFilter} onChange={setStatusFilter} className="input-field w-72" options={STATUS_FILTER_OPTIONS} />
        <SearchableSelect
          value={countryFilter}
          onChange={setCountryFilter}
          className="input-field w-56"
          options={[{ value: "", label: "All countries" }, ...countries.map((c) => ({ value: c.id, label: c.name }))]}
        />
      </div>

      {loading ? (
        <p className="text-midnight-900/50">Loading…</p>
      ) : visible.length === 0 ? (
        <div className="card p-10 text-center text-midnight-900/50">No commissions match this filter.</div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-midnight-900/10 text-left text-midnight-900/40 text-xs uppercase tracking-wider">
                <th className="px-5 py-3 font-semibold">Agent</th>
                <th className="px-5 py-3 font-semibold">Candidate</th>
                <th className="px-5 py-3 font-semibold">Country</th>
                <th className="px-5 py-3 font-semibold">Milestone</th>
                <th className="px-5 py-3 font-semibold">Amount</th>
                <th className="px-5 py-3 font-semibold">Status</th>
                <th className="px-5 py-3 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {paged.map((c) => (
                <tr key={c.id} className="border-b border-midnight-900/5 last:border-0">
                  <td className="px-5 py-4">
                    <Link href={`/management/referral-agents/${c.referral_agent.id}`} className="font-medium text-midnight-900 hover:text-gold-600">
                      {c.referral_agent.full_name}
                    </Link>
                  </td>
                  <td className="px-5 py-4 text-midnight-900/70">{c.candidate.full_name ?? "— unnamed —"}</td>
                  <td className="px-5 py-4 text-midnight-900/70">{c.candidate.country?.name ?? "—"}</td>
                  <td className="px-5 py-4 text-midnight-900/70">{MILESTONE_LABELS[c.milestone] ?? c.milestone}</td>
                  <td className="px-5 py-4 font-medium text-midnight-900">{new Intl.NumberFormat("en-US", { style: "currency", currency: c.currency }).format(c.amount)}</td>
                  <td className="px-5 py-4">
                    <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold ${STATUS_STYLES[c.status] ?? "bg-slate-100 text-slate-700"}`}>
                      {c.status}
                    </span>
                  </td>
                  <td className="px-5 py-4">
                    {c.status === "pending" && (
                      <button onClick={() => approve(c.id)} disabled={actingId === c.id} className="btn-secondary text-xs px-3 py-1.5 disabled:opacity-60 flex items-center gap-1.5">
                        <CheckCircle size={14} weight="regular" /> Approve
                      </button>
                    )}
                    {c.status === "approved" && (
                      <button onClick={() => markPaid(c.id)} disabled={actingId === c.id} className="btn-primary text-xs px-3 py-1.5 disabled:opacity-60 flex items-center gap-1.5">
                        <CurrencyDollar size={14} weight="bold" /> Mark Paid
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="px-5">
            <Pagination page={page} totalPages={totalPages} onPageChange={setPage} total={total} pageSize={pageSize} />
          </div>
        </div>
      )}
    </PortalShell>
  );
}
