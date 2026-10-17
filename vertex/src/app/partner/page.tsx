"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import PortalShell from "@/components/portal/PortalShell";
import { PARTNER_NAV_ITEMS } from "@/components/portal/partnerNav";
import PartnerCandidateForm from "@/components/portal/PartnerCandidateForm";
import Pagination from "@/components/Pagination";
import SearchableSelect from "@/components/SearchableSelect";
import FilterBar from "@/components/portal/FilterBar";
import SortableTh from "@/components/SortableTh";
import { usePagination } from "@/lib/usePagination";
import { formatPartnerCandidateStatus } from "@/lib/partnerCandidateStatus";
import { Plus, X, WarningCircle, ChatCircleDots, Trash } from "@phosphor-icons/react";

const STATUS_FILTER_OPTIONS = [
  { value: "", label: "All statuses" },
  { value: "draft", label: "Draft" },
  { value: "submitted", label: "Submitted" },
  { value: "under_review", label: "Under Review" },
  { value: "job_assigned", label: "Case Created" },
  { value: "rejected", label: "Rejected" },
];

const STATUS_STYLES: Record<string, string> = {
  draft: "bg-slate-100 text-slate-600",
  submitted: "bg-blue-100 text-blue-700",
  under_review: "bg-yellow-100 text-yellow-800",
  job_assigned: "bg-emerald-100 text-emerald-800",
  rejected: "bg-red-100 text-red-700",
};

interface PartnerCandidateRow {
  id: string;
  // Nullable (2026-09-09) — a draft can be saved before a name is even
  // typed in.
  full_name: string | null;
  email: string | null;
  status: string;
  // Null while still a draft (2026-10-14) — drafted_at is set instead.
  submitted_at: string | null;
  drafted_at: string | null;
  job: { title: string; country: string; city: string } | null;
  has_rejected_document: boolean;
  awaiting_partner_reply: boolean;
}

// A partner's own candidate submissions (SRS FR-5.1) — this never shows
// Vertex's internal recruiter/screening pipeline, since these candidates
// don't go through it; the partner already handled that themselves.
export default function PartnerPortalPage() {
  const [candidates, setCandidates] = useState<PartnerCandidateRow[]>([]);
  const [needsAttentionCount, setNeedsAttentionCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [resumeDraftId, setResumeDraftId] = useState<string | undefined>(undefined);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    fetch("/api/partner/candidates")
      .then((r) => r.json())
      .then((res) => {
        setCandidates(res.data ?? []);
        setNeedsAttentionCount(res.summary?.needs_attention_count ?? 0);
      })
      .catch(() => setError("Failed to load candidates."))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  // Client-side search + filter — this list is fetched in full (no server
  // pagination), so both operate over the whole dataset (CRM Comments
  // follow-up, 2026-08-10).
  const [sortBy, setSortBy] = useState<"submitted_at" | "status">("submitted_at");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const handleSort = (key: string) => {
    if (sortBy === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortBy(key as "submitted_at" | "status"); setSortDir("asc"); }
  };

  const visibleCandidates = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const rows = candidates.filter((c) => {
      if (status && c.status !== status) return false;
      if (!needle) return true;
      return (
        (c.full_name ?? "").toLowerCase().includes(needle) ||
        (c.email ?? "").toLowerCase().includes(needle) ||
        (c.job?.title ?? "").toLowerCase().includes(needle)
      );
    });
    return [...rows].sort((a, b) => {
      const diff =
        sortBy === "status" ? a.status.localeCompare(b.status) : new Date(a.submitted_at ?? a.drafted_at ?? 0).getTime() - new Date(b.submitted_at ?? b.drafted_at ?? 0).getTime();
      return sortDir === "asc" ? diff : -diff;
    });
  }, [candidates, q, status, sortBy, sortDir]);

  const { page, setPage, totalPages, paged, total, pageSize } = usePagination(visibleCandidates);

  return (
    <PortalShell roleLabel="Partner" navItems={PARTNER_NAV_ITEMS}>
      <div className="flex items-center justify-between mb-2">
        <div>
          <p className="eyebrow mb-3">
            <span className="eyebrow-rule" />
            Partner Portal
          </p>
          <h1 className="section-title text-3xl md:text-4xl mb-2">My Candidates.</h1>
        </div>
        <button
          onClick={() => {
            setResumeDraftId(undefined);
            setShowForm(true);
          }}
          className="btn-primary text-xs"
        >
          <Plus size={16} weight="bold" /> Submit Candidate
        </button>
      </div>
      <p className="text-midnight-900/55 font-light mb-8 max-w-2xl">
        Submit a candidate for a work permit and visa application. We review for completeness and confirm the
        programme/offer within 48 hours.
      </p>

      {needsAttentionCount > 0 && (
        <div className="card p-5 mb-8 flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-red-100 text-red-600 flex items-center justify-center shrink-0">
            <WarningCircle size={18} weight="fill" />
          </div>
          <div>
            <div className="text-2xl font-semibold text-midnight-900">{needsAttentionCount}</div>
            <div className="text-xs text-midnight-900/50">
              candidate{needsAttentionCount === 1 ? "" : "s"} need{needsAttentionCount === 1 ? "s" : ""} your attention — a rejected document or an unanswered message
            </div>
          </div>
        </div>
      )}

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4 text-sm mb-8">{error}</div>}

      {!loading && candidates.length > 0 && (
        <FilterBar searchValue={q} onSearchChange={setQ} searchPlaceholder="Search by candidate name, email, or programme…">
          <SearchableSelect value={status} onChange={setStatus} className="input-field w-56" options={STATUS_FILTER_OPTIONS} />
        </FilterBar>
      )}

      {loading ? (
        <p className="text-midnight-900/50">Loading…</p>
      ) : candidates.length === 0 ? (
        <div className="card p-10 text-center text-midnight-900/50">No candidates submitted yet — submit one above.</div>
      ) : visibleCandidates.length === 0 ? (
        <div className="card p-10 text-center text-midnight-900/50">No candidates match your search.</div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-midnight-900/10 text-left text-midnight-900/40 text-xs uppercase tracking-wider">
                <th className="px-5 py-3 font-semibold">Candidate</th>
                <th className="px-5 py-3 font-semibold">Opportunity</th>
                <SortableTh label="Status" sortKey="status" activeSort={sortBy} activeDir={sortDir} onSort={handleSort} />
                <th className="px-5 py-3 font-semibold">Attention</th>
                <SortableTh label="Submitted" sortKey="submitted_at" activeSort={sortBy} activeDir={sortDir} onSort={handleSort} />
                <th className="px-5 py-3 font-semibold" />
              </tr>
            </thead>
            <tbody>
              {paged.map((c) => {
                const isDraft = c.status === "draft";
                const nameCell = (
                  <>
                    <div className="font-medium text-midnight-900 group-hover:text-gold-600">
                      {c.full_name || <span className="italic text-midnight-900/40">Untitled draft</span>}
                    </div>
                    {c.email && <div className="text-xs text-midnight-900/45">{c.email}</div>}
                  </>
                );
                return (
                  <tr key={c.id} className="border-b border-midnight-900/5 last:border-0 hover:bg-ivory-100/60">
                    <td className="px-5 py-4">
                      {isDraft ? (
                        <button
                          type="button"
                          className="block text-left group"
                          onClick={() => {
                            setResumeDraftId(c.id);
                            setShowForm(true);
                          }}
                        >
                          {nameCell}
                        </button>
                      ) : (
                        <Link href={`/partner/candidates/${c.id}`} className="block group">
                          {nameCell}
                        </Link>
                      )}
                    </td>
                    <td className="px-5 py-4 text-midnight-900/70">
                      {c.job?.title ?? "—"}
                      <div className="text-xs text-midnight-900/40">{c.job ? `${c.job.city}, ${c.job.country}` : ""}</div>
                    </td>
                    <td className="px-5 py-4">
                      <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold ${STATUS_STYLES[c.status] ?? "bg-slate-100 text-slate-700"}`}>
                        {formatPartnerCandidateStatus(c.status)}
                      </span>
                    </td>
                    <td className="px-5 py-4">
                      {!c.has_rejected_document && !c.awaiting_partner_reply ? (
                        <span className="text-xs text-midnight-900/35">—</span>
                      ) : (
                        <div className="flex flex-col gap-0.5">
                          {c.has_rejected_document && (
                            <span className="inline-flex items-center gap-1 text-xs font-semibold text-red-600">
                              <WarningCircle size={13} weight="fill" /> Document rejected
                            </span>
                          )}
                          {c.awaiting_partner_reply && (
                            <span className="inline-flex items-center gap-1 text-xs font-semibold text-red-600">
                              <ChatCircleDots size={13} weight="fill" /> New message
                            </span>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="px-5 py-4 text-midnight-900/60">
                      {c.submitted_at ? (
                        new Date(c.submitted_at).toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
                      ) : c.drafted_at ? (
                        <span className="text-midnight-900/40">Draft saved {new Date(c.drafted_at).toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-5 py-4">
                      {isDraft && (
                        <button
                          type="button"
                          title="Delete draft"
                          disabled={deletingId === c.id}
                          onClick={async () => {
                            if (!confirm("Delete this draft? This can't be undone.")) return;
                            setDeletingId(c.id);
                            try {
                              await fetch(`/api/partner/candidates/${c.id}`, { method: "DELETE" });
                              load();
                            } finally {
                              setDeletingId(null);
                            }
                          }}
                          className="text-midnight-900/35 hover:text-red-600 disabled:opacity-50"
                        >
                          <Trash size={16} weight="regular" />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="px-5">
            <Pagination page={page} totalPages={totalPages} onPageChange={setPage} total={total} pageSize={pageSize} />
          </div>
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 z-[200] bg-midnight-950/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white max-w-2xl w-full max-h-[90vh] overflow-y-auto rounded-2xl shadow-2xl p-6 sm:p-8 relative">
            <button
              type="button"
              onClick={() => {
                setShowForm(false);
                setResumeDraftId(undefined);
                load();
              }}
              className="absolute top-4 right-4 text-midnight-900/40 hover:text-midnight-900"
            >
              <X size={20} weight="bold" />
            </button>
            <h2 className="text-xl font-black text-midnight-900 mb-1">{resumeDraftId ? "Continue Draft" : "Submit a Candidate"}</h2>
            <p className="text-sm text-midnight-900/50 mb-6">Every detail is checked against the candidate's passport and supporting documents.</p>
            <PartnerCandidateForm
              draftId={resumeDraftId}
              onDraftSaved={load}
              onSubmitted={() => {
                setShowForm(false);
                setResumeDraftId(undefined);
                load();
              }}
            />
          </div>
        </div>
      )}
    </PortalShell>
  );
}
