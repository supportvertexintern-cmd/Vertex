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
import { formatCandidateLifecycleStatus } from "@/lib/candidateLifecycleStatus";
import { CheckCircle, ChatCircleDots, Clock } from "@phosphor-icons/react";

interface SelfApplicationRow {
  id: string;
  full_name: string | null;
  email: string | null;
  lifecycle_status: string;
  created_at: string;
  user: { full_name: string; email: string } | null;
  applications: { job: { title: string; country: string; city: string } | null }[];
  pending_documents_count: number;
  message_count: number;
  awaiting_hr_reply: boolean;
}

const PAGE_SIZE = 15;

const STATUS_STYLES: Record<string, string> = {
  identified: "bg-slate-100 text-slate-700",
  screened: "bg-blue-100 text-blue-700",
  guided_to_apply: "bg-purple-100 text-purple-700",
  submitted: "bg-yellow-100 text-yellow-800",
  approved: "bg-emerald-100 text-emerald-800",
  rejected: "bg-red-100 text-red-700",
};

const STATUS_OPTIONS = [
  { value: "", label: "All statuses" },
  { value: "identified", label: "Identified" },
  { value: "screened", label: "Screened" },
  { value: "guided_to_apply", label: "Guided to Apply" },
  { value: "submitted", label: "Submitted" },
  { value: "approved", label: "Case Created" },
  { value: "rejected", label: "Rejected" },
];

// HR's review queue for public website submissions (2026-07-31, HR-owned
// self-submission routing) — these no longer get farmed out to a
// recruiter by country; HR screens the CIF, approves the candidate for
// account creation, then approves again once they've completed their own
// documentation, opening the Case. The summary tiles + per-row signals
// mirror the Partner Submissions queue (`/hr`), added because HR had no
// way to tell a candidate had come back from screening (account created,
// documents uploaded, auto-advanced to "submitted") without reopening
// every candidate individually to check.
export default function HrSelfApplicationsPage() {
  const urlState = useUrlListState();
  const [rows, setRows] = useState<SelfApplicationRow[]>([]);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState({ ready_for_approval_count: 0, awaiting_reply_count: 0 });
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState(() => urlState.get("q"));
  const [status, setStatus] = useState(() => urlState.get("status"));
  const [page, setPage] = useState(() => urlState.getNumber("page", 1));
  const [error, setError] = useState("");
  const [sortBy, setSortBy] = useState(() => urlState.get("sortBy", "created_at"));
  const [sortDir, setSortDir] = useState<"asc" | "desc">(() => (urlState.get("sortDir") === "asc" ? "asc" : "desc"));
  const isFirstRun = useRef(true);

  const handleSort = (key: string) => {
    if (sortBy === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortBy(key); setSortDir("asc"); }
  };

  const load = () => {
    setLoading(true);
    const params = new URLSearchParams({
      source: "self_registered",
      signals: "true",
      page: String(page),
      pageSize: String(PAGE_SIZE),
      sortBy,
      sortDir,
    });
    if (q) params.set("q", q);
    if (status) params.set("status", status);
    fetch(`/api/candidates?${params}`)
      .then((r) => r.json())
      .then((res) => {
        setRows(res.data ?? []);
        setTotal(res.total ?? 0);
        setSummary(res.summary ?? { ready_for_approval_count: 0, awaiting_reply_count: 0 });
      })
      .catch(() => setError("Failed to load self applications."))
      .finally(() => setLoading(false));
  };

  // Skipped on first mount so restoring page from the URL (returning from
  // a detail page) doesn't get immediately reset back to 1.
  useEffect(() => {
    if (isFirstRun.current) return;
    setPage(1);
  }, [q, status]);

  useEffect(() => {
    urlState.set({ page, q, status, sortBy, sortDir });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, q, status, sortBy, sortDir]);

  useEffect(() => {
    const timeout = setTimeout(load, 250);
    isFirstRun.current = false;
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, status, page, sortBy, sortDir]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <PortalShell roleLabel="Human Resources" navItems={HR_NAV_ITEMS}>
      <p className="eyebrow mb-3">
        <span className="eyebrow-rule" />
        Public Website
      </p>
      <h1 className="section-title text-3xl md:text-4xl mb-2">Self Applications.</h1>
      <p className="text-midnight-900/55 font-light mb-8 max-w-2xl">
        Candidates who submitted the Candidate Information Form themselves at{" "}
        <span className="font-medium">/apply</span>, with no recruiter or partner involved. Open a submission to
        review it, approve it for account creation, and — once they've completed their own documentation — approve
        it again to open the Case.
      </p>

      <div className="grid sm:grid-cols-2 gap-4 mb-8">
        <div className="card p-5 flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
            <CheckCircle size={18} weight="fill" />
          </div>
          <div>
            <div className="text-2xl font-semibold text-midnight-900">{summary.ready_for_approval_count}</div>
            <div className="text-xs text-midnight-900/50">
              candidate{summary.ready_for_approval_count === 1 ? "" : "s"} submitted their documents — ready for your approval
            </div>
          </div>
        </div>
        <div className="card p-5 flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-red-100 text-red-600 flex items-center justify-center shrink-0">
            <ChatCircleDots size={18} weight="fill" />
          </div>
          <div>
            <div className="text-2xl font-semibold text-midnight-900">{summary.awaiting_reply_count}</div>
            <div className="text-xs text-midnight-900/50">candidate{summary.awaiting_reply_count === 1 ? "" : "s"} waiting on a reply from us</div>
          </div>
        </div>
      </div>

      <FilterBar searchValue={q} onSearchChange={setQ} searchPlaceholder="Search by candidate name or email…">
        <SearchableSelect value={status} onChange={setStatus} className="input-field w-56" options={STATUS_OPTIONS} />
      </FilterBar>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4 text-sm mb-6">{error}</div>}

      {loading ? (
        <p className="text-midnight-900/50">Loading…</p>
      ) : rows.length === 0 ? (
        <div className="card p-10 text-center text-midnight-900/50">
          {q || status ? "No submissions match your filters." : "No self-submitted applications yet."}
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-midnight-900/10 text-left text-midnight-900/40 text-xs uppercase tracking-wider">
                <SortableTh label="Candidate" sortKey="full_name" activeSort={sortBy} activeDir={sortDir} onSort={handleSort} />
                <th className="px-5 py-3 font-semibold">Opportunity</th>
                <th className="px-5 py-3 font-semibold">Documents</th>
                <th className="px-5 py-3 font-semibold">Messages</th>
                <SortableTh label="Submitted" sortKey="created_at" activeSort={sortBy} activeDir={sortDir} onSort={handleSort} />
                <SortableTh label="Status" sortKey="lifecycle_status" activeSort={sortBy} activeDir={sortDir} onSort={handleSort} />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const name = row.user?.full_name ?? row.full_name ?? "— unnamed —";
                const contact = row.user?.email ?? row.email ?? "";
                const job = row.applications[0]?.job ?? null;
                return (
                  <tr key={row.id} className="border-b border-midnight-900/5 last:border-0">
                    <td className="px-5 py-4">
                      <Link href={`/hr/self-applications/${row.id}`} className="block">
                        <div className="font-medium text-midnight-900 hover:text-gold-600">{name}</div>
                        <div className="text-xs text-midnight-900/45">{contact}</div>
                      </Link>
                    </td>
                    <td className="px-5 py-4 text-midnight-900/70">
                      {job?.title ?? "—"}
                      <div className="text-xs text-midnight-900/40">{job ? `${job.city}, ${job.country}` : ""}</div>
                    </td>
                    <td className="px-5 py-4">
                      {row.pending_documents_count > 0 ? (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-blue-700">
                          <Clock size={13} weight="fill" /> {row.pending_documents_count} awaiting review
                        </span>
                      ) : (
                        <span className="text-xs text-midnight-900/35">—</span>
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
                    <td className="px-5 py-4 text-xs text-midnight-900/50 whitespace-nowrap">{new Date(row.created_at).toLocaleDateString()}</td>
                    <td className="px-5 py-4">
                      <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold ${STATUS_STYLES[row.lifecycle_status] ?? "bg-slate-100 text-slate-700"}`}>
                        {formatCandidateLifecycleStatus(row.lifecycle_status)}
                      </span>
                      {row.lifecycle_status === "submitted" && (
                        <div className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 mt-1.5 ml-1">
                          <CheckCircle size={12} weight="fill" /> Ready for your approval
                        </div>
                      )}
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
