"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import PortalShell from "@/components/portal/PortalShell";
import { FINANCE_NAV_ITEMS } from "@/components/portal/financeNav";
import SearchableSelect from "@/components/SearchableSelect";
import Pagination from "@/components/Pagination";
import SortableTh from "@/components/SortableTh";
import FilterBar from "@/components/portal/FilterBar";
import { CASE_STAGE_ORDER, CASE_STAGE_LABELS, type CaseStageKey } from "@/components/portal/caseStages";
import OpsReviewBadge from "@/components/portal/OpsReviewBadge";
import { ArrowRight } from "@phosphor-icons/react";
import { useUrlListState } from "@/lib/useUrlListState";

interface CaseRow {
  id: string;
  current_stage: CaseStageKey;
  created_at: string;
  updated_at: string;
  status: "active" | "rejected";
  ops_review_status: "pending" | "confirmed" | "rejected";
  contract: { status: string } | null;
  retention_follow_up: { due_at: string; completed_at: string | null } | null;
  payments: { status: string; sent_to_email: string | null }[];
  application: {
    candidate: {
      full_name: string | null;
      user: { full_name: string; email: string } | null;
      country: { id: string; name: string } | null;
      partner: { name: string } | null;
    };
    job: { title: string; country: string; city: string } | null;
    preferred_country_1: { name: string } | null;
    preferred_sector: { name: string } | null;
  };
}

interface Partner {
  id: string;
  name: string;
}

const PAGE_SIZE = 15;

const STAGE_OPTIONS = [
  { value: "", label: "All stages" },
  ...CASE_STAGE_ORDER.map((s) => ({ value: s, label: CASE_STAGE_LABELS[s] })),
];

// Rejected cases don't show by default (GET /api/cases' own default).
const CASE_STATUS_OPTIONS = [
  { value: "active", label: "Active cases" },
  { value: "rejected", label: "Rejected cases" },
  { value: "all", label: "All cases" },
];

// Application type = Candidate.source (2026-08-18).
const SOURCE_OPTIONS = [
  { value: "", label: "All application types" },
  { value: "self_registered", label: "Self-Submitted" },
  { value: "recruiter_sourced", label: "Recruiter-Sourced" },
  { value: "partner_sourced", label: "Partner-Sourced" },
];

// Derived from the case's own milestone payments — no schema change
// needed, CasePayment.status/sent_to_email already carry this (CRM
// Comments item 9/13, 2026-08-10).
function paymentStatusLabel(payments: { status: string; sent_to_email: string | null }[]): { label: string; className: string } {
  if (payments.length === 0) return { label: "Awaiting Payment", className: "bg-slate-100 text-slate-600" };
  if (payments.every((p) => p.status === "collected")) return { label: "Fully Collected", className: "bg-emerald-100 text-emerald-800" };
  if (payments.some((p) => p.status === "collected")) return { label: "Partially Collected", className: "bg-blue-100 text-blue-700" };
  if (payments.some((p) => p.status === "pending" && p.sent_to_email)) return { label: "Payment Link Sent", className: "bg-amber-100 text-amber-800" };
  return { label: "Awaiting Payment", className: "bg-slate-100 text-slate-600" };
}

// Finance's own case list — every case regardless of source, same
// unrestricted scope as Operations/HR (2026-07-31, per the Operational
// Workflow SOP's confirmed global-access decision). The Payments Due
// dashboard is the day-to-day worklist; this is for looking up a specific
// candidate's case directly.
export default function FinanceCasesPage() {
  const { get, getNumber, set: setUrlState } = useUrlListState();
  const [cases, setCases] = useState<CaseRow[]>([]);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState(() => get("q"));
  const [stage, setStage] = useState(() => get("stage"));
  const [partnerId, setPartnerId] = useState(() => get("partner_id"));
  const [sourceFilter, setSourceFilter] = useState(() => get("source"));
  const [caseStatus, setCaseStatus] = useState(() => get("status", "active"));
  const [page, setPage] = useState(() => getNumber("page", 1));
  const [sortBy, setSortBy] = useState(() => get("sortBy") || "updated_at");
  const [sortDir, setSortDir] = useState<"asc" | "desc">(() => (get("sortDir") === "asc" ? "asc" : "desc"));
  const [hasInitializedFromUrl, setHasInitializedFromUrl] = useState(false);

  const handleSort = (key: string) => {
    if (sortBy === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortBy(key); setSortDir("asc"); }
  };

  useEffect(() => {
    fetch("/api/admin/partners")
      .then((r) => r.json())
      .then((res) => setPartners(res.data ?? []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!hasInitializedFromUrl) return;
    setPage(1);
  }, [q, stage, partnerId, sourceFilter, caseStatus, hasInitializedFromUrl]);

  useEffect(() => {
    if (!hasInitializedFromUrl) {
      setHasInitializedFromUrl(true);
      return;
    }
    // Only update URL if values have changed from what's in the URL
    const currentParams = new URLSearchParams();
    if (page > 1) currentParams.set("page", String(page));
    if (q) currentParams.set("q", q);
    if (stage) currentParams.set("stage", stage);
    if (partnerId) currentParams.set("partner_id", partnerId);
    if (sourceFilter) currentParams.set("source", sourceFilter);
    if (caseStatus !== "active") currentParams.set("status", caseStatus);
    if (sortBy !== "updated_at") currentParams.set("sortBy", sortBy);
    if (sortDir !== "desc") currentParams.set("sortDir", sortDir);
    
    const currentUrl = currentParams.toString();
    if (currentUrl !== window.location.search.slice(1)) {
      setUrlState({ page, q, stage, partner_id: partnerId, source: sourceFilter, status: caseStatus, sortBy, sortDir });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, q, stage, partnerId, sourceFilter, caseStatus, sortBy, sortDir, hasInitializedFromUrl]);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE), sortBy, sortDir, status: caseStatus });
    if (q) params.set("q", q);
    if (stage) params.set("stage", stage);
    if (partnerId) params.set("partner_id", partnerId);
    if (sourceFilter) params.set("source", sourceFilter);
    const timeout = setTimeout(() => {
      fetch(`/api/cases?${params}`)
        .then((r) => r.json())
        .then((res) => {
          setCases(res.data ?? []);
          setTotal(res.total ?? 0);
        })
        .finally(() => setLoading(false));
    }, 250);
    return () => clearTimeout(timeout);
  }, [q, stage, partnerId, sourceFilter, caseStatus, page, sortBy, sortDir]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Build the current URL with all state for back navigation
  const currentUrl = (() => {
    const params = new URLSearchParams();
    if (page > 1) params.set("page", String(page));
    if (q) params.set("q", q);
    if (stage) params.set("stage", stage);
    if (partnerId) params.set("partner_id", partnerId);
    if (sourceFilter) params.set("source", sourceFilter);
    if (caseStatus !== "active") params.set("status", caseStatus);
    if (sortBy !== "updated_at") params.set("sortBy", sortBy);
    if (sortDir !== "desc") params.set("sortDir", sortDir);
    const qs = params.toString();
    return qs ? `/finance/cases?${qs}` : "/finance/cases";
  })();

  return (
    <PortalShell roleLabel="Finance" navItems={FINANCE_NAV_ITEMS}>
      <p className="eyebrow mb-3">
        <span className="eyebrow-rule" />
        Mobility Lifecycle
      </p>
      <h1 className="section-title text-3xl md:text-4xl mb-2">Cases.</h1>
      <p className="text-midnight-900/55 font-light mb-8 max-w-2xl">
        Every active case — open one to issue a payment link or record a payment. Stage and document updates are
        Operations' own lane.
      </p>

      <FilterBar searchValue={q} onSearchChange={setQ} searchPlaceholder="Search by candidate name or email…">
        <SearchableSelect value={stage} onChange={setStage} className="input-field w-56" options={STAGE_OPTIONS} />
        <SearchableSelect
          value={partnerId}
          onChange={setPartnerId}
          placeholder="All partners"
          className="input-field w-52"
          options={[{ value: "", label: "All partners" }, ...partners.map((p) => ({ value: p.id, label: p.name }))]}
        />
        <SearchableSelect value={sourceFilter} onChange={setSourceFilter} className="input-field w-56" options={SOURCE_OPTIONS} />
        <SearchableSelect value={caseStatus} onChange={setCaseStatus} className="input-field w-48" options={CASE_STATUS_OPTIONS} />
      </FilterBar>

      {loading ? (
        <p className="text-midnight-900/50">Loading…</p>
      ) : cases.length === 0 ? (
        <div className="card p-10 text-center text-midnight-900/50">
          {q || stage || partnerId || sourceFilter ? "No cases match your filters." : "No active cases yet."}
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-midnight-900/10 text-left text-midnight-900/40 text-xs uppercase tracking-wider">
                <th className="px-5 py-3 font-semibold">Candidate</th>
                <th className="px-5 py-3 font-semibold">Country</th>
                <th className="px-5 py-3 font-semibold">Partner</th>
                <SortableTh label="Created" sortKey="created_at" activeSort={sortBy} activeDir={sortDir} onSort={handleSort} />
                <th className="px-5 py-3 font-semibold">Updated</th>
                <SortableTh label="Stage" sortKey="current_stage" activeSort={sortBy} activeDir={sortDir} onSort={handleSort} />
                <th className="px-5 py-3 font-semibold">Documentation</th>
                <th className="px-5 py-3 font-semibold">Status</th>
                <th className="px-5 py-3 font-semibold">Payment</th>
                <th className="px-5 py-3 font-semibold"></th>
              </tr>
            </thead>
            <tbody>
              {cases.map((c) => {
                const name = c.application.candidate.user?.full_name ?? c.application.candidate.full_name ?? "— unnamed —";
                const country = c.application.candidate.country?.name ?? c.application.preferred_country_1?.name ?? "—";
                const paymentStatus = paymentStatusLabel(c.payments ?? []);
                return (
                  <tr key={c.id} className="border-b border-midnight-900/5 last:border-0 hover:bg-ivory-100/60">
                    <td className="px-5 py-4">
                      <Link href={`/finance/cases/${c.id}?returnTo=${encodeURIComponent(currentUrl)}`} className="font-medium text-midnight-900 hover:underline">
                        {name}
                      </Link>
                      <div className="text-xs text-midnight-900/40">
                        {c.application.job ? c.application.job.title : c.application.preferred_sector?.name ?? "General Programme"}
                      </div>
                    </td>
                    <td className="px-5 py-4 text-midnight-900/70">{country}</td>
                    <td className="px-5 py-4 text-midnight-900/60">{c.application.candidate.partner?.name ?? "—"}</td>
                    <td className="px-5 py-4 text-xs text-midnight-900/50 whitespace-nowrap">{new Date(c.created_at).toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
                    <td className="px-5 py-4 text-xs text-midnight-900/50 whitespace-nowrap">{new Date(c.updated_at).toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
                    <td className="px-5 py-4 text-midnight-900/70 whitespace-nowrap">
                      Stage {CASE_STAGE_ORDER.indexOf(c.current_stage) + 1} of {CASE_STAGE_ORDER.length}: {CASE_STAGE_LABELS[c.current_stage]}
                    </td>
                    <td className="px-5 py-4"><OpsReviewBadge status={c.ops_review_status} /></td>
                    <td className="px-5 py-4">
                      {c.status === "rejected" ? (
                        <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-red-100 text-red-700">Rejected</span>
                      ) : (
                        <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800">Active</span>
                      )}
                    </td>
                    <td className="px-5 py-4">
                      <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold whitespace-nowrap ${paymentStatus.className}`}>
                        {paymentStatus.label}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-right">
                      <Link
                        href={`/finance/cases/${c.id}`}
                        className="inline-flex items-center gap-1 text-xs font-semibold text-gold-600 hover:underline"
                      >
                        View <ArrowRight size={11} weight="bold" />
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="px-5">
            <Pagination page={page} totalPages={totalPages} onPageChange={setPage} total={total} pageSize={PAGE_SIZE} />
          </div>
        </div>
      )}
    </PortalShell>
  );
}
