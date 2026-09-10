"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import PortalShell from "@/components/portal/PortalShell";
import { SUPERVISOR_NAV_ITEMS } from "@/components/portal/supervisorNav";
import SortableTh from "@/components/SortableTh";
import Pagination from "@/components/Pagination";
import { usePagination } from "@/lib/usePagination";
import { CaretRight, MagnifyingGlass } from "@phosphor-icons/react";

interface RecruiterRow {
  id: string;
  full_name: string;
  email: string;
  candidatesTotal: number;
  conversionRate: number;
  lastReportAt: string | null;
}

type SortKey = "full_name" | "candidatesTotal" | "conversionRate" | "lastReportAt";

export default function SupervisorRecruitersPage() {
  const [recruiters, setRecruiters] = useState<RecruiterRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [sortBy, setSortBy] = useState<SortKey>("full_name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const handleSort = (key: string) => {
    if (sortBy === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortBy(key as SortKey); setSortDir("asc"); }
  };

  useEffect(() => {
    setLoading(true);
    fetch("/api/supervisor/recruiters")
      .then((r) => r.json())
      .then((res) => setRecruiters(res.data ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const visibleRecruiters = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const rows = needle
      ? recruiters.filter((r) => r.full_name.toLowerCase().includes(needle) || r.email.toLowerCase().includes(needle))
      : recruiters;
    return [...rows].sort((a, b) => {
      let diff: number;
      if (sortBy === "full_name") diff = a.full_name.localeCompare(b.full_name);
      else if (sortBy === "lastReportAt") diff = new Date(a.lastReportAt ?? 0).getTime() - new Date(b.lastReportAt ?? 0).getTime();
      else diff = a[sortBy] - b[sortBy];
      return sortDir === "asc" ? diff : -diff;
    });
  }, [recruiters, q, sortBy, sortDir]);

  const { page, setPage, totalPages, paged, total, pageSize } = usePagination(visibleRecruiters);

  return (
    <PortalShell roleLabel="Country Supervisor" navItems={SUPERVISOR_NAV_ITEMS}>
      <p className="eyebrow mb-3">
        <span className="eyebrow-rule" />
        Agent network
      </p>
      <h1 className="section-title text-3xl md:text-4xl mb-2">Recruiters.</h1>
      <p className="text-midnight-900/55 font-light mb-8 max-w-2xl">
        Every recruiter under you, all-time candidates sourced, and conversion rate. Click into a recruiter
        to set their target, review their reports, and leave them a note.
      </p>

      {!loading && recruiters.length > 0 && (
        <div className="relative mb-6 max-w-md">
          <MagnifyingGlass size={16} weight="regular" className="absolute left-4 top-1/2 -translate-y-1/2 text-midnight-900/30" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by name or email…"
            className="input-field pl-11"
          />
        </div>
      )}

      {loading ? (
        <p className="text-midnight-900/50">Loading…</p>
      ) : recruiters.length === 0 ? (
        <div className="card p-10 text-center text-midnight-900/50">No recruiters assigned to you yet.</div>
      ) : visibleRecruiters.length === 0 ? (
        <div className="card p-10 text-center text-midnight-900/50">No recruiters match your search.</div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-midnight-900/10 text-left text-midnight-900/40 text-xs uppercase tracking-wider">
                <SortableTh label="Name" sortKey="full_name" activeSort={sortBy} activeDir={sortDir} onSort={handleSort} />
                <th className="px-5 py-3 font-semibold">Email</th>
                <SortableTh label="Candidates (all time)" sortKey="candidatesTotal" activeSort={sortBy} activeDir={sortDir} onSort={handleSort} />
                <SortableTh label="Conversion rate" sortKey="conversionRate" activeSort={sortBy} activeDir={sortDir} onSort={handleSort} />
                <SortableTh label="Last report" sortKey="lastReportAt" activeSort={sortBy} activeDir={sortDir} onSort={handleSort} />
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody>
              {paged.map((r) => (
                <tr key={r.id} className="border-b border-midnight-900/5 last:border-0 hover:bg-ivory-100/60">
                  <td className="px-5 py-4">
                    <Link href={`/supervisor/recruiters/${r.id}`} className="font-medium text-midnight-900 hover:underline">
                      {r.full_name}
                    </Link>
                  </td>
                  <td className="px-5 py-4 text-midnight-900/60">{r.email}</td>
                  <td className="px-5 py-4 text-midnight-900/70">{r.candidatesTotal}</td>
                  <td className="px-5 py-4 text-midnight-900/70">{r.conversionRate}%</td>
                  <td className="px-5 py-4 text-midnight-900/60">
                    {r.lastReportAt ? new Date(r.lastReportAt).toLocaleDateString() : "—"}
                  </td>
                  <td className="px-5 py-4">
                    <Link href={`/supervisor/recruiters/${r.id}`} className="text-gold-600 inline-flex items-center gap-1 text-xs font-semibold hover:underline">
                      View <CaretRight size={12} weight="bold" />
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
