"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import PortalShell from "@/components/portal/PortalShell";
import { MANAGEMENT_NAV_ITEMS } from "@/components/portal/managementNav";
import SearchableSelect from "@/components/SearchableSelect";
import SortableTh from "@/components/SortableTh";
import Pagination from "@/components/Pagination";
import FilterBar from "@/components/portal/FilterBar";
import { usePagination } from "@/lib/usePagination";
import { ShareNetwork } from "@phosphor-icons/react";

const STATUS_STYLES: Record<string, string> = {
  pending_approval: "bg-yellow-100 text-yellow-800",
  active: "bg-emerald-100 text-emerald-800",
  suspended: "bg-red-100 text-red-700",
  rejected: "bg-slate-100 text-slate-600",
};

const STATUS_FILTER_OPTIONS = [
  { value: "", label: "All statuses" },
  { value: "pending_approval", label: "Pending Approval" },
  { value: "active", label: "Active" },
  { value: "suspended", label: "Suspended" },
  { value: "rejected", label: "Rejected" },
];

interface ReferralAgentRow {
  id: string;
  full_name: string;
  email: string;
  country: string;
  status: string;
  referral_code: string;
  email_verified: boolean;
  countryRef: { id: string; name: string } | null;
  _count: { candidates: number; commissions: number };
}

// Director/Management's view of the Referral Agent System (2026-08-29) —
// mirrors management/partners/page.tsx exactly. No "Add" affordance here:
// agents register themselves publicly at /become-a-referral-agent, staff
// only review/approve/reject/suspend.
export default function ReferralAgentsPage() {
  const [agents, setAgents] = useState<ReferralAgentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const load = () => {
    setLoading(true);
    fetch("/api/admin/referral-agents")
      .then((r) => r.json())
      .then((res) => setAgents(res.data ?? []))
      .catch(() => setError("Failed to load referral agents."))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const [sortBy, setSortBy] = useState<"candidates" | "status">("candidates");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const handleSort = (key: string) => {
    if (sortBy === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortBy(key as "candidates" | "status"); setSortDir("asc"); }
  };

  const filteredAgents = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const rows = agents.filter((a) => {
      if (statusFilter && a.status !== statusFilter) return false;
      if (!needle) return true;
      return (
        a.full_name.toLowerCase().includes(needle) ||
        a.email.toLowerCase().includes(needle) ||
        a.referral_code.toLowerCase().includes(needle) ||
        a.country.toLowerCase().includes(needle)
      );
    });
    return [...rows].sort((a, b) => {
      const diff = sortBy === "status" ? a.status.localeCompare(b.status) : a._count.candidates - b._count.candidates;
      return sortDir === "asc" ? diff : -diff;
    });
  }, [agents, q, statusFilter, sortBy, sortDir]);

  const { page, setPage, totalPages, paged, total, pageSize } = usePagination(filteredAgents);

  useEffect(() => setPage(1), [q, statusFilter]);

  return (
    <PortalShell roleLabel="Management" navItems={MANAGEMENT_NAV_ITEMS}>
      <div className="flex items-center justify-between mb-2">
        <div>
          <p className="eyebrow mb-3">
            <span className="eyebrow-rule" />
            Referral Agent System
          </p>
          <h1 className="section-title text-3xl md:text-4xl mb-2">Referral Agents.</h1>
        </div>
        <div className="flex items-center gap-4 text-sm font-medium">
          <Link href="/management/referral-agents/commission-rules" className="text-midnight-900/60 hover:text-gold-600">Commission Rules</Link>
          <Link href="/management/referral-agents/commissions" className="text-midnight-900/60 hover:text-gold-600">Commissions</Link>
          <Link href="/management/referral-agents/performance" className="text-midnight-900/60 hover:text-gold-600">Performance</Link>
          <Link href="/management/referral-agents/countries" className="text-midnight-900/60 hover:text-gold-600">Countries</Link>
        </div>
      </div>
      <p className="text-midnight-900/55 font-light mb-8 max-w-2xl">
        People who registered publicly to refer candidates and earn a milestone-based commission. Review, approve,
        reject, or suspend applications here.
      </p>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4 text-sm mb-8">{error}</div>}

      {agents.length > 0 && (
        <FilterBar searchValue={q} onSearchChange={setQ} searchPlaceholder="Search by name, email, code, or country…">
          <SearchableSelect value={statusFilter} onChange={setStatusFilter} className="input-field w-56" options={STATUS_FILTER_OPTIONS} />
        </FilterBar>
      )}

      {loading ? (
        <p className="text-midnight-900/50">Loading…</p>
      ) : agents.length === 0 ? (
        <div className="card p-10 text-center text-midnight-900/50">No referral agent applications yet.</div>
      ) : filteredAgents.length === 0 ? (
        <div className="card p-10 text-center text-midnight-900/50">No agents match your filters.</div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-midnight-900/10 text-left text-midnight-900/40 text-xs uppercase tracking-wider">
                <th className="px-5 py-3 font-semibold">Agent</th>
                <th className="px-5 py-3 font-semibold">Country</th>
                <th className="px-5 py-3 font-semibold">Code</th>
                <SortableTh label="Status" sortKey="status" activeSort={sortBy} activeDir={sortDir} onSort={handleSort} />
                <SortableTh label="Candidates" sortKey="candidates" activeSort={sortBy} activeDir={sortDir} onSort={handleSort} />
              </tr>
            </thead>
            <tbody>
              {paged.map((a) => (
                <tr key={a.id} className="border-b border-midnight-900/5 last:border-0">
                  <td className="px-5 py-4">
                    <Link href={`/management/referral-agents/${a.id}`} className="font-medium text-midnight-900 hover:text-gold-600 flex items-center gap-2">
                      <ShareNetwork size={15} weight="regular" className="text-gold-600 shrink-0" />
                      {a.full_name}
                    </Link>
                    <div className="text-xs text-midnight-900/45 mt-0.5">{a.email}{!a.email_verified && " · email unverified"}</div>
                  </td>
                  <td className="px-5 py-4 text-midnight-900/70">{a.countryRef?.name ?? a.country}</td>
                  <td className="px-5 py-4 text-midnight-900/70 font-mono text-xs">{a.referral_code}</td>
                  <td className="px-5 py-4">
                    <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold ${STATUS_STYLES[a.status] ?? "bg-slate-100 text-slate-700"}`}>
                      {a.status.replace(/_/g, " ")}
                    </span>
                  </td>
                  <td className="px-5 py-4 text-midnight-900/70">{a._count.candidates}</td>
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
