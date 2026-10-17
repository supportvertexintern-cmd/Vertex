"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import PortalShell, { type PortalNavItem } from "@/components/portal/PortalShell";
import Pagination from "@/components/Pagination";
import { usePagination } from "@/lib/usePagination";

const MAX_REASON_LENGTH = 50;

interface RejectedSubmission {
  id: string;
  type: "Partner submission" | "Self submission" | "Case";
  name: string;
  partner: string | null;
  opportunity: string | null;
  rejected_at: string;
  reason: string | null;
  status: string;
}

function getDetailHref(row: RejectedSubmission, portal: string): string | null {
  if (row.type === "Partner submission") {
    if (portal === "hr" || portal === "admin") return `/hr/${row.id}`;
    if (portal === "operations") return `/operations/partner-candidates/${row.id}`;
    return null;
  }
  if (row.type === "Self submission") {
    return portal === "hr" || portal === "admin" ? `/hr/self-applications/${row.id}` : null;
  }
  const casePortal = portal === "admin" ? "management" : portal;
  return casePortal === "operations" ? `/operations/${row.id}` : `/${casePortal}/cases/${row.id}`;
}

export default function RejectedSubmissionsPage({
  roleLabel,
  navItems,
}: {
  roleLabel: string;
  navItems: PortalNavItem[];
}) {
  const pathname = usePathname();
  const portal = pathname.split("/")[1] ?? "management";
  const [rows, setRows] = useState<RejectedSubmission[]>([]);
  const [query, setQuery] = useState("");
  const [sourceFilter, setSourceFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetch("/api/rejected-submissions")
      .then((response) => response.json())
      .then((result) => {
        if (!result || !Array.isArray(result.data)) throw new Error("Failed to load rejected submissions.");
        setRows(result.data);
      })
      .catch(() => setError("Failed to load rejected submissions."))
      .finally(() => setLoading(false));
  }, []);

  const filteredRows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (sourceFilter && row.type !== sourceFilter) return false;
      if (!needle) return true;
      return [row.name, row.partner, row.opportunity, row.reason, row.type]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(needle));
    });
  }, [rows, query, sourceFilter]);

  const { page, setPage, totalPages, paged, total, pageSize } = usePagination(filteredRows);

  return (
    <PortalShell roleLabel={roleLabel} navItems={navItems}>
      <p className="eyebrow mb-3">
        <span className="eyebrow-rule" />
        Review Queue
      </p>
      <h1 className="section-title text-3xl md:text-4xl mb-2">Rejected Submissions.</h1>
      <p className="text-midnight-900/55 font-light mb-8 max-w-2xl">
        Rejected partner and self submissions, plus rejected cases, in one review list.
      </p>

      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <label className="sr-only" htmlFor="rejected-search">Search rejected submissions</label>
        <input
          id="rejected-search"
          type="search"
          value={query}
          onChange={(event) => { setQuery(event.target.value); setPage(1); }}
          placeholder="Search candidate, partner, opportunity, or reason…"
          className="input-field w-full sm:max-w-md"
        />
        <label className="sr-only" htmlFor="rejected-source">Submission type</label>
        <select
          id="rejected-source"
          value={sourceFilter}
          onChange={(event) => { setSourceFilter(event.target.value); setPage(1); }}
          className="input-field w-full sm:w-56"
        >
          <option value="">All rejected records</option>
          <option value="Partner submission">Partner submissions</option>
          <option value="Self submission">Self submissions</option>
          <option value="Case">Cases</option>
        </select>
      </div>

      {error ? (
        <div role="alert" className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4 text-sm">{error}</div>
      ) : loading ? (
        <p className="text-midnight-900/50">Loading rejected submissions…</p>
      ) : filteredRows.length === 0 ? (
        <div className="card p-10 text-center text-midnight-900/50">
          {rows.length ? "No rejected submissions match your search." : "No rejected submissions."}
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-midnight-900/10 text-left text-midnight-900/40 text-xs uppercase tracking-wider">
                <th className="px-5 py-3 font-semibold">Type</th>
                <th className="px-5 py-3 font-semibold">Candidate / Partner</th>
                <th className="px-5 py-3 font-semibold">Opportunity</th>
                <th className="px-5 py-3 font-semibold">Rejection reason</th>
                <th className="px-5 py-3 font-semibold">Rejected on</th>
                <th className="px-5 py-3 font-semibold">Current status</th>
              </tr>
            </thead>
            <tbody>
              {paged.map((row) => {
                const href = getDetailHref(row, portal);
                return (
                  <tr key={`${row.type}:${row.id}`} className="border-b border-midnight-900/5 last:border-0">
                    <td className="px-5 py-4 text-xs text-midnight-900/65 whitespace-nowrap">{row.type}</td>
                    <td className="px-5 py-4">
                      {href ? (
                        <Link href={href} className="font-medium text-midnight-900 hover:text-gold-600 hover:underline">
                          {row.name}
                        </Link>
                      ) : (
                        <span className="font-medium text-midnight-900">{row.name}</span>
                      )}
                      {row.partner && <div className="text-xs text-midnight-900/45">{row.partner}</div>}
                    </td>
                    <td className="px-5 py-4 text-midnight-900/70">{row.opportunity ?? "—"}</td>
                    <td className="px-5 py-4 text-midnight-900/70 max-w-md">{row.reason || "No rejection reason recorded."}</td>
                    <td className="px-5 py-4 text-xs text-midnight-900/55 whitespace-nowrap">
                      {new Date(row.rejected_at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}
                    </td>
                    <td className="px-5 py-4">
                      <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-red-100 text-red-700">
                        {row.status.replace(/_/g, " ")}
                      </span>
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
    </PortalShell>
  );
}