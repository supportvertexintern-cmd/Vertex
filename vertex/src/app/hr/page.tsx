"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import PortalShell from "@/components/portal/PortalShell";
import { HR_NAV_ITEMS } from "@/components/portal/hrNav";
import SearchableSelect from "@/components/SearchableSelect";
import Pagination from "@/components/Pagination";
import SortableTh from "@/components/SortableTh";
import FilterBar from "@/components/portal/FilterBar";
import { useUrlListState } from "@/lib/useUrlListState";
import { formatPartnerCandidateStatus } from "@/lib/partnerCandidateStatus";
import { CheckCircle, WarningCircle, ChatCircleDots, Clock } from "@phosphor-icons/react";

interface PartnerCandidateRow {
  id: string;
  full_name: string;
  email: string | null;
  status: string;
  submitted_at: string;
  updated_at: string;
  bridged_candidate_id: string | null;
  partner: { id: string; name: string; contact_email: string };
  job: { title: string; country: string; city: string } | null;
  document_completeness: { complete: boolean; missingTypes: string[] } | null;
  pending_documents_count: number;
  message_count: number;
  awaiting_hr_reply: boolean;
}

const PAGE_SIZE = 15;

const STATUS_STYLES: Record<string, string> = {
  submitted: "bg-blue-100 text-blue-700",
  under_review: "bg-yellow-100 text-yellow-800",
  job_assigned: "bg-emerald-100 text-emerald-800",
  rejected: "bg-red-100 text-red-700",
};

const STATUS_OPTIONS = [
  { value: "", label: "All statuses" },
  { value: "submitted", label: "submitted" },
  { value: "under_review", label: "under review" },
  { value: "job_assigned", label: "Case Created" },
  { value: "rejected", label: "rejected" },
];

// HR's review queue for partner-submitted candidates (SRS FR-5.1,
// 2026-07-31 per the Operational Workflow SOP). A partner has already
// screened/verified these themselves, so this is the one place a real
// Case gets opened for them — clicking a row goes to the full review
// detail (message thread, reject, create case), not an inline action here.
export default function HrPartnerSubmissionsPage() {
  const urlState = useUrlListState();
  const [rows, setRows] = useState<PartnerCandidateRow[]>([]);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState({ pending_review_count: 0, awaiting_reply_count: 0 });
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState(() => urlState.get("q"));
  const [status, setStatus] = useState(() => urlState.get("status"));
  const [page, setPage] = useState(() => urlState.getNumber("page", 1));
  const [error, setError] = useState("");
  const [sortBy, setSortBy] = useState(() => urlState.get("sortBy", "updated_at"));
  const [sortDir, setSortDir] = useState<"asc" | "desc">(() => (urlState.get("sortDir") === "asc" ? "asc" : "desc"));
  const isFirstRun = useRef(true);
  const hasInitializedFromUrl = useRef(false);

  const handleSort = (key: string) => {
    if (sortBy === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortBy(key); setSortDir("asc"); }
  };

  const load = () => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE), sortBy, sortDir });
    if (q) params.set("q", q);
    if (status) params.set("status", status);
    fetch(`/api/partner-candidates?${params}`)
      .then((r) => r.json())
      .then((res) => {
        setRows(res.data ?? []);
        setTotal(res.total ?? 0);
        setSummary(res.summary ?? { pending_review_count: 0, awaiting_reply_count: 0 });
      })
      .catch(() => setError("Failed to load partner submissions."))
      .finally(() => setLoading(false));
  };

  // Skipped on first mount so restoring page from the URL (returning from
  // a detail page) doesn't get immediately reset back to 1.
  useEffect(() => {
    if (isFirstRun.current) return;
    setPage(1);
  }, [q, status]);

  useEffect(() => {
    if (!hasInitializedFromUrl.current) {
      hasInitializedFromUrl.current = true;
      return;
    }
    urlState.set({ page, q, status, sortBy, sortDir });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, q, status, sortBy, sortDir]);

  useEffect(() => {
    const timeout = setTimeout(load, 250);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, status, page, sortBy, sortDir]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Build the current URL with all state for back navigation
  const currentUrl = (() => {
    const params = new URLSearchParams();
    if (page > 1) params.set("page", String(page));
    if (q) params.set("q", q);
    if (status) params.set("status", status);
    if (sortBy !== "updated_at") params.set("sortBy", sortBy);
    if (sortDir !== "desc") params.set("sortDir", sortDir);
    const qs = params.toString();
    return qs ? `/hr?${qs}` : "/hr";
  })();

  return (
    <PortalShell roleLabel="Human Resources" navItems={HR_NAV_ITEMS}>
      <p className="eyebrow mb-3">
        <span className="eyebrow-rule" />
        Partner Network
      </p>
      <div className="flex items-start justify-between gap-4 mb-2">
        <h1 className="section-title text-3xl md:text-4xl">Partner Submissions.</h1>
        <Link href="/hr/partner-candidates/new" className="btn-primary text-xs px-4 py-2 whitespace-nowrap">
          + Add on Behalf of Partner
        </Link>
      </div>
      <p className="text-midnight-900/55 font-light mb-8 max-w-2xl">
        Candidates submitted directly by partner agencies (SRS FR-5.1) — partners have already screened and verified
        these themselves. Open a submission to review documents, message the partner, and create the Case that hands
        off to Operations.
      </p>

      <div className="grid sm:grid-cols-2 gap-4 mb-8">
        <div className="card p-5 flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center shrink-0">
            <Clock size={18} weight="fill" />
          </div>
          <div>
            <div className="text-2xl font-semibold text-midnight-900">{summary.pending_review_count}</div>
            <div className="text-xs text-midnight-900/50">submission{summary.pending_review_count === 1 ? "" : "s"} with documents awaiting review</div>
          </div>
        </div>
        <div className="card p-5 flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-red-100 text-red-600 flex items-center justify-center shrink-0">
            <ChatCircleDots size={18} weight="fill" />
          </div>
          <div>
            <div className="text-2xl font-semibold text-midnight-900">{summary.awaiting_reply_count}</div>
            <div className="text-xs text-midnight-900/50">submission{summary.awaiting_reply_count === 1 ? "" : "s"} waiting on a reply from us</div>
          </div>
        </div>
      </div>

      <FilterBar searchValue={q} onSearchChange={setQ} searchPlaceholder="Search by candidate or partner name…">
        <SearchableSelect value={status} onChange={setStatus} className="input-field w-56" options={STATUS_OPTIONS} />
      </FilterBar>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4 text-sm mb-6">{error}</div>}

      {loading ? (
        <p className="text-midnight-900/50">Loading…</p>
      ) : rows.length === 0 ? (
        <div className="card p-10 text-center text-midnight-900/50">
          {q || status ? "No submissions match your filters." : "No partner submissions yet."}
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-midnight-900/10 text-left text-midnight-900/40 text-xs uppercase tracking-wider">
                <SortableTh label="Candidate" sortKey="full_name" activeSort={sortBy} activeDir={sortDir} onSort={handleSort} />
                <SortableTh label="Partner" sortKey="partner" activeSort={sortBy} activeDir={sortDir} onSort={handleSort} />
                <th className="px-5 py-3 font-semibold">Opportunity</th>
                <th className="px-5 py-3 font-semibold">Documents</th>
                <th className="px-5 py-3 font-semibold">Messages</th>
                <SortableTh label="Submitted" sortKey="submitted_at" activeSort={sortBy} activeDir={sortDir} onSort={handleSort} />
                <SortableTh label="Updated" sortKey="updated_at" activeSort={sortBy} activeDir={sortDir} onSort={handleSort} />
                <SortableTh label="Status" sortKey="status" activeSort={sortBy} activeDir={sortDir} onSort={handleSort} />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-midnight-900/5 last:border-0">
                  <td className="px-5 py-4">
                    <Link href={`/hr/${row.id}?back=${encodeURIComponent(currentUrl)}`} className="block">
                      <div className="font-medium text-midnight-900 hover:text-gold-600">{row.full_name}</div>
                      {row.email && <div className="text-xs text-midnight-900/45">{row.email}</div>}
                    </Link>
                  </td>
                  <td className="px-5 py-4 text-midnight-900/70">{row.partner.name}</td>
                  <td className="px-5 py-4 text-midnight-900/70">
                    {row.job?.title ?? "—"}
                    <div className="text-xs text-midnight-900/40">{row.job ? `${row.job.city}, ${row.job.country}` : ""}</div>
                  </td>
                  <td className="px-5 py-4 space-y-1">
                    {row.document_completeness === null ? (
                      <span className="text-xs text-midnight-900/35">—</span>
                    ) : row.document_completeness.complete ? (
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700">
                        <CheckCircle size={13} weight="fill" /> Complete
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-700" title={row.document_completeness.missingTypes.join(", ")}>
                        <WarningCircle size={13} weight="fill" /> {row.document_completeness.missingTypes.length} missing
                      </span>
                    )}
                    {row.pending_documents_count > 0 && (
                      <div className="inline-flex items-center gap-1 text-xs font-semibold text-blue-700">
                        <Clock size={13} weight="fill" /> {row.pending_documents_count} awaiting review
                      </div>
                    )}
                  </td>
                  <td className="px-5 py-4">
                    {row.message_count === 0 ? (
                      <span className="text-xs text-midnight-900/35">—</span>
                    ) : (
                      <span className={`inline-flex items-center gap-1 text-xs font-semibold ${row.awaiting_hr_reply ? "text-red-600" : "text-midnight-900/50"}`}>
                        <ChatCircleDots size={13} weight={row.awaiting_hr_reply ? "fill" : "regular"} /> {row.message_count}
                        {row.awaiting_hr_reply && " · reply needed"}
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-4 text-xs text-midnight-900/50 whitespace-nowrap">{new Date(row.submitted_at).toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
                  <td className="px-5 py-4 text-xs text-midnight-900/50 whitespace-nowrap">{new Date(row.updated_at).toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
                  <td className="px-5 py-4">
                    <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold ${STATUS_STYLES[row.status] ?? "bg-slate-100 text-slate-700"}`}>
                      {formatPartnerCandidateStatus(row.status)}
                    </span>
                  </td>
                </tr>
              ))}
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
