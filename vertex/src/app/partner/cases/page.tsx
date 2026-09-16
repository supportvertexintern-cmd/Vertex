"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import PortalShell from "@/components/portal/PortalShell";
import { PARTNER_NAV_ITEMS } from "@/components/portal/partnerNav";
import Pagination from "@/components/Pagination";
import SearchableSelect from "@/components/SearchableSelect";
import SortableTh from "@/components/SortableTh";
import { usePagination } from "@/lib/usePagination";
import { CASE_STAGE_ORDER, CASE_STAGE_LABELS, type CaseStageKey } from "@/components/portal/caseStages";
import OpsReviewBadge from "@/components/portal/OpsReviewBadge";
import FilterBar from "@/components/portal/FilterBar";
import { ArrowRight } from "@phosphor-icons/react";

const STAGE_OPTIONS = [
  { value: "", label: "All stages" },
  ...CASE_STAGE_ORDER.map((s) => ({ value: s, label: CASE_STAGE_LABELS[s] })),
];

const STATUS_OPTIONS = [
  { value: "", label: "All cases" },
  { value: "active", label: "Active cases" },
  { value: "rejected", label: "Rejected cases" },
];

interface CaseRow {
  id: string;
  current_stage: CaseStageKey;
  created_at: string;
  updated_at: string;
  ops_review_status: "pending" | "confirmed" | "rejected";
  status: "active" | "rejected";
  application: {
    candidate: { full_name: string | null };
    job: { title: string; country: string; city: string } | null;
  };
}

// A partner's own view of cases opened for its approved candidates (SRS
// FR-5.1, 2026-07-31 per the Operational Workflow SOP) — scoped
// automatically to the partner's own candidates by GET /api/cases'
// existing partner branch (server/scope.ts). A submission still under
// HR review has no case yet, so it won't show here until approved.
export default function PartnerCasesPage() {
  const [cases, setCases] = useState<CaseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [stage, setStage] = useState("");
  const [status, setStatus] = useState("");
  const [sortBy, setSortBy] = useState<"stage" | "status">("stage");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const handleSort = (key: string) => {
    if (sortBy === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortBy(key as "stage" | "status"); setSortDir("asc"); }
  };

  useEffect(() => {
    fetch("/api/cases?status=all")
      .then((r) => r.json())
      .then((res) => setCases(res.data ?? []))
      .catch(() => setError("Failed to load cases."))
      .finally(() => setLoading(false));
  }, []);

  // Client-side search/filter/sort — this list is fetched in full (no
  // server pagination), so it all operates over the whole dataset.
  const visibleCases = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const rows = cases.filter((c) => {
      if (stage && c.current_stage !== stage) return false;
      if (status && c.status !== status) return false;
      if (!needle) return true;
      return (
        (c.application.candidate.full_name ?? "").toLowerCase().includes(needle) ||
        (c.application.job?.title ?? "").toLowerCase().includes(needle)
      );
    });
    return [...rows].sort((a, b) => {
      const diff =
        sortBy === "status" ? a.status.localeCompare(b.status) : CASE_STAGE_ORDER.indexOf(a.current_stage) - CASE_STAGE_ORDER.indexOf(b.current_stage);
      return sortDir === "asc" ? diff : -diff;
    });
  }, [cases, q, stage, status, sortBy, sortDir]);

  const { page, setPage, totalPages, paged, total, pageSize } = usePagination(visibleCases);

  return (
    <PortalShell roleLabel="Partner" navItems={PARTNER_NAV_ITEMS}>
      <p className="eyebrow mb-3">
        <span className="eyebrow-rule" />
        Partner Portal
      </p>
      <h1 className="section-title text-3xl md:text-4xl mb-2">Cases.</h1>
      <p className="text-midnight-900/55 font-light mb-8 max-w-2xl">
        Status of your approved candidates — case stage, documents, and payments in progress.
      </p>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4 text-sm mb-6">{error}</div>}

      {!loading && cases.length > 0 && (
        <FilterBar searchValue={q} onSearchChange={setQ} searchPlaceholder="Search by candidate or programme…">
          <SearchableSelect value={stage} onChange={setStage} className="input-field w-56" options={STAGE_OPTIONS} />
          <SearchableSelect value={status} onChange={setStatus} className="input-field w-44" options={STATUS_OPTIONS} />
        </FilterBar>
      )}

      {loading ? (
        <p className="text-midnight-900/50">Loading…</p>
      ) : cases.length === 0 ? (
        <div className="card p-10 text-center text-midnight-900/50">No cases yet — a case opens once a submission is approved.</div>
      ) : visibleCases.length === 0 ? (
        <div className="card p-10 text-center text-midnight-900/50">No cases match your search.</div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-midnight-900/10 text-left text-midnight-900/40 text-xs uppercase tracking-wider">
                <th className="px-5 py-3 font-semibold">Candidate</th>
                <th className="px-5 py-3 font-semibold">Programme</th>
                <SortableTh label="Stage" sortKey="stage" activeSort={sortBy} activeDir={sortDir} onSort={handleSort} />
                <SortableTh label="Status" sortKey="status" activeSort={sortBy} activeDir={sortDir} onSort={handleSort} />
                <th className="px-5 py-3 font-semibold">Documentation</th>
                <th className="px-5 py-3 font-semibold">Created</th>
                <th className="px-5 py-3 font-semibold">Updated</th>
                <th className="px-5 py-3 font-semibold"></th>
              </tr>
            </thead>
            <tbody>
              {paged.map((c) => (
                <tr key={c.id} className="border-b border-midnight-900/5 last:border-0 hover:bg-ivory-100/60">
                  <td className="px-5 py-4 font-medium text-midnight-900">{c.application.candidate.full_name ?? "— unnamed —"}</td>
                  <td className="px-5 py-4 text-midnight-900/70">{c.application.job?.title ?? "—"}</td>
                  <td className="px-5 py-4 text-midnight-900/70 whitespace-nowrap">
                    Stage {CASE_STAGE_ORDER.indexOf(c.current_stage) + 1} of {CASE_STAGE_ORDER.length}: {CASE_STAGE_LABELS[c.current_stage]}
                  </td>
                  <td className="px-5 py-4">
                    {c.status === "rejected" ? (
                      <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-red-100 text-red-700">Rejected</span>
                    ) : (
                      <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800">Active</span>
                    )}
                  </td>
                  <td className="px-5 py-4"><OpsReviewBadge status={c.ops_review_status} /></td>
                  <td className="px-5 py-4 text-xs text-midnight-900/50 whitespace-nowrap">{new Date(c.created_at).toLocaleDateString()}</td>
                  <td className="px-5 py-4 text-xs text-midnight-900/50 whitespace-nowrap">{new Date(c.updated_at).toLocaleDateString()}</td>
                  <td className="px-5 py-4 text-right">
                    <Link href={`/partner/cases/${c.id}`} className="inline-flex items-center gap-1 text-xs font-semibold text-gold-600 hover:underline">
                      View <ArrowRight size={11} weight="bold" />
                    </Link>
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
