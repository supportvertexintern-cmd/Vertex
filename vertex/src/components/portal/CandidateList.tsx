"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import DocumentLink from "@/components/DocumentLink";
import CandidateStatusControls from "./CandidateStatusControls";
import CandidateDocumentUpload from "./CandidateDocumentUpload";
import CandidateEditDetails from "./CandidateEditDetails";
import SearchableSelect from "@/components/SearchableSelect";
import Pagination from "@/components/Pagination";
import SortableTh from "@/components/SortableTh";
import FilterBar from "./FilterBar";
import { DEFAULT_PAGE_SIZE } from "@/lib/usePagination";
import { useDebouncedValue } from "@/lib/useDebouncedValue";
import { useUrlListState } from "@/lib/useUrlListState";

const STATUS_STYLES: Record<string, string> = {
  identified: "bg-slate-100 text-slate-700",
  screened: "bg-blue-100 text-blue-700",
  guided_to_apply: "bg-purple-100 text-purple-700",
  submitted: "bg-yellow-100 text-yellow-800",
  reported: "bg-orange-100 text-orange-700",
  verified: "bg-teal-100 text-teal-700",
  approved: "bg-emerald-100 text-emerald-800",
};

const STATUS_OPTIONS = Object.keys(STATUS_STYLES).map((s) => ({ value: s, label: s.replace(/_/g, " ") }));

interface CandidateRow {
  id: string;
  source: string;
  lifecycle_status: string;
  nationality: string | null;
  date_of_birth: string | null;
  passport_number: string | null;
  full_name: string | null;
  phone: string | null;
  email: string | null;
  desired_role: string | null;
  consent_given: boolean;
  return_reason: string | null;
  screening_result: boolean | null;
  created_at: string;
  second_nationality: string | null;
  gender: string | null;
  passport_expiry: string | null;
  current_occupation: string | null;
  highest_education: string | null;
  home_address: string | null;
  whatsapp_number: string | null;
  marital_status: string | null;
  user: { full_name: string; email: string } | null;
  recruiter: { id: string; full_name: string } | null;
  country: { id: string; name: string } | null;
  country_name: string | null;
  partner: { id: string; name: string } | null;
  documents: { id: string; type: string; verification_status: string }[];
  applications: {
    job: { title: string } | null;
    preferred_sector: { name: string } | null;
    preferred_country_1: { name: string } | null;
  }[];
}

/**
 * Shared candidate table for the recruiter/supervisor/management portals —
 * each scoped server-side by role. `canVerify` controls whether the status
 * widget offers verify/return (supervisor-tier) or just advance
 * (recruiter-tier) actions; the API is the real authorization boundary.
 * When `basePath` is set, a row links to `${basePath}/${id}` for the full
 * CIF detail + actions page instead of editing inline in the table.
 */
export default function CandidateList({
  emptyLabel,
  canVerify = false,
  canApprove = false,
  showStatusControls = true,
  refreshKey = 0,
  basePath,
  source,
}: {
  emptyLabel: string;
  canVerify?: boolean;
  canApprove?: boolean;
  showStatusControls?: boolean;
  refreshKey?: number;
  basePath?: string;
  source?: string;
}) {
  const urlState = useUrlListState();
  const [candidates, setCandidates] = useState<CandidateRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [q, setQ] = useState(() => urlState.get("q"));
  const [statusFilter, setStatusFilter] = useState(() => urlState.get("status"));
  const [page, setPage] = useState(() => urlState.getNumber("page", 1));
  const [sortBy, setSortBy] = useState(() => urlState.get("sortBy") || "created_at");
  const [sortDir, setSortDir] = useState<"asc" | "desc">(() => (urlState.get("sortDir") === "asc" ? "asc" : "desc"));
  const [total, setTotal] = useState(0);
  const pageSize = DEFAULT_PAGE_SIZE;
  const debouncedQ = useDebouncedValue(q);

  const handleSort = (key: string) => {
    if (sortBy === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortBy(key); setSortDir("asc"); }
  };

  // Search/filter changes reset back to page 1 — staying on, say, page 4
  // of an unfiltered list makes no sense once a filter narrows the set.
  // Skipped on first mount so restoring page from the URL (e.g. after
  // returning from a detail page, CRM Comments follow-up 2026-08-12)
  // doesn't immediately get reset back to 1 by this same effect.
  const isFirstRun = useRef(true);
  useEffect(() => {
    if (isFirstRun.current) { isFirstRun.current = false; return; }
    setPage(1);
  }, [debouncedQ, statusFilter]);

  // Mirror page/search/filter/sort into the URL so the browser's Back
  // button (or a detail page's "← Back" link, now router.back()) restores
  // this exact view instead of resetting to page 1.
  useEffect(() => {
    urlState.set({ page, q: debouncedQ, status: statusFilter, sortBy, sortDir });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, debouncedQ, statusFilter, sortBy, sortDir]);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize), sortBy, sortDir });
    if (debouncedQ) params.set("q", debouncedQ);
    if (statusFilter) params.set("status", statusFilter);
    if (source) params.set("source", source);
    fetch(`/api/candidates?${params}`)
      .then((r) => r.json())
      .then((res) => {
        setCandidates(res.data ?? []);
        setTotal(res.total ?? 0);
      })
      .catch(() => setError("Failed to load candidates."))
      .finally(() => setLoading(false));
  }, [refreshKey, page, pageSize, debouncedQ, statusFilter, sortBy, sortDir, source]);

  const recordConsent = async (id: string) => {
    const res = await fetch(`/api/candidates/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ consent_given: true }),
    });
    if (res.ok) {
      setCandidates((prev) => prev.map((row) => (row.id === id ? { ...row, consent_given: true } : row)));
    }
  };

  const refetchDocuments = async (id: string) => {
    const res = await fetch(`/api/candidates/${id}`);
    if (!res.ok) return;
    const body = await res.json();
    setCandidates((prev) => prev.map((row) => (row.id === id ? { ...row, documents: body.data.documents } : row)));
  };

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const hasFilter = Boolean(q.trim() || statusFilter);

  if (loading) return <p className="text-midnight-900/50">Loading…</p>;
  if (error) return <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4 text-sm">{error}</div>;
  if (total === 0 && !hasFilter) return <div className="card p-10 text-center text-midnight-900/50">{emptyLabel}</div>;

  return (
    <div>
      <FilterBar searchValue={q} onSearchChange={setQ} searchPlaceholder="Search by name or contact…">
        <SearchableSelect
          value={statusFilter}
          onChange={setStatusFilter}
          placeholder="All statuses"
          className="input-field w-56"
          options={[{ value: "", label: "All statuses" }, ...STATUS_OPTIONS]}
        />
      </FilterBar>

      {candidates.length === 0 ? (
        <div className="card p-10 text-center text-midnight-900/50">No candidates match your search.</div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-midnight-900/10 text-left text-midnight-900/40 text-xs uppercase tracking-wider">
                <SortableTh label="Candidate" sortKey="full_name" activeSort={sortBy} activeDir={sortDir} onSort={handleSort} />
                <th className="px-5 py-3 font-semibold">Programme</th>
                <th className="px-5 py-3 font-semibold">Preferred Country</th>
                <th className="px-5 py-3 font-semibold">Country</th>
                <th className="px-5 py-3 font-semibold">Recruiter</th>
                <SortableTh label="Submitted" sortKey="created_at" activeSort={sortBy} activeDir={sortDir} onSort={handleSort} />
                <SortableTh label="Status" sortKey="lifecycle_status" activeSort={sortBy} activeDir={sortDir} onSort={handleSort} />
                <th className="px-5 py-3 font-semibold">Documents</th>
              </tr>
            </thead>
            <tbody>
              {candidates.map((c) => {
                const name = c.user?.full_name ?? c.full_name ?? "— unnamed lead —";
                const contact = c.user?.email ?? c.email ?? c.phone ?? "";
                const app = c.applications[0];
                const programme = app?.job?.title ?? app?.preferred_sector?.name ?? "General Programme";
                return (
                  <tr key={c.id} className="border-b border-midnight-900/5 last:border-0 align-top">
                    <td className="px-5 py-4">
                      {basePath ? (
                        <Link href={`${basePath}/${c.id}`} className="font-medium text-midnight-900 hover:text-gold-600">
                          {name}
                        </Link>
                      ) : (
                        <div className="font-medium text-midnight-900">{name}</div>
                      )}
                      <div className="text-xs text-midnight-900/45">{contact || c.nationality || ""}</div>
                      {!c.consent_given && !basePath && (
                        <button
                          type="button"
                          onClick={() => recordConsent(c.id)}
                          className="text-[10px] text-red-500 uppercase tracking-wide mt-1 hover:underline"
                        >
                          No consent on file — record it
                        </button>
                      )}
                      {!c.consent_given && basePath && (
                        <div className="text-[10px] text-red-500 uppercase tracking-wide mt-1">No consent on file</div>
                      )}
                      {showStatusControls && !basePath && (
                        <div className="mt-1">
                          <CandidateEditDetails
                            candidateId={c.id}
                            initial={{
                              full_name: c.full_name,
                              nationality: c.nationality,
                              phone: c.phone,
                              date_of_birth: c.date_of_birth,
                              passport_number: c.passport_number,
                              email: c.email,
                              desired_role: c.desired_role,
                              second_nationality: c.second_nationality,
                              gender: c.gender,
                              passport_expiry: c.passport_expiry,
                              current_occupation: c.current_occupation,
                              highest_education: c.highest_education,
                              home_address: c.home_address,
                              whatsapp_number: c.whatsapp_number,
                              marital_status: c.marital_status,
                            }}
                            onSaved={(data) =>
                              setCandidates((prev) => prev.map((row) => (row.id === c.id ? { ...row, ...data } : row)))
                            }
                          />
                        </div>
                      )}
                    </td>
                    <td className="px-5 py-4 text-midnight-900/70">{programme}</td>
                    <td className="px-5 py-4 text-midnight-900/70">{app?.preferred_country_1?.name ?? "—"}</td>
                    <td className="px-5 py-4 text-midnight-900/70">{c.country?.name ?? c.country_name ?? "—"}</td>
                    <td className="px-5 py-4 text-midnight-900/70">
                      {c.recruiter?.full_name ?? "—"}
                      {c.source === "partner_sourced" && c.partner && (
                        <div className="text-[10px] uppercase tracking-wide text-gold-600 mt-0.5">via {c.partner.name}</div>
                      )}
                    </td>
                    <td className="px-5 py-4 text-xs text-midnight-900/50 whitespace-nowrap">{new Date(c.created_at).toLocaleDateString()}</td>
                    <td className="px-5 py-4">
                      <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold ${STATUS_STYLES[c.lifecycle_status] ?? "bg-slate-100 text-slate-700"}`}>
                        {c.lifecycle_status.replace(/_/g, " ")}
                      </span>
                      {c.screening_result !== null && (
                        <div className={`text-[11px] mt-1 font-medium ${c.screening_result ? "text-emerald-600" : "text-red-500"}`}>
                          Screening: {c.screening_result ? "Passed" : "Failed"}
                        </div>
                      )}
                      {c.return_reason && (
                        <div className="text-xs text-red-500 mt-1.5 max-w-[220px]">
                          <span className="font-semibold">Returned:</span> {c.return_reason}
                        </div>
                      )}
                      {showStatusControls && !basePath && (
                        <div className="mt-2">
                          <CandidateStatusControls
                            candidateId={c.id}
                            status={c.lifecycle_status as never}
                            canVerify={canVerify}
                            canApprove={canApprove}
                            onChanged={(next) =>
                              setCandidates((prev) =>
                                prev.map((row) =>
                                  row.id === c.id
                                    ? { ...row, lifecycle_status: next.lifecycle_status, return_reason: next.return_reason }
                                    : row
                                )
                              )
                            }
                          />
                        </div>
                      )}
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex flex-col gap-1.5 items-start">
                        {c.documents.length === 0 && <span className="text-xs text-midnight-900/35">None</span>}
                        {c.documents.map((d) => (
                          <DocumentLink key={d.id} documentId={d.id} label={d.type} className="text-xs text-gold-600 hover:underline capitalize" />
                        ))}
                        {showStatusControls && !basePath && (
                          <div className="flex flex-col gap-1 mt-1">
                            <CandidateDocumentUpload candidateId={c.id} type="cv" onUploaded={() => refetchDocuments(c.id)} />
                            <CandidateDocumentUpload candidateId={c.id} type="passport" onUploaded={() => refetchDocuments(c.id)} />
                          </div>
                        )}
                      </div>
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
    </div>
  );
}
