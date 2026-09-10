"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import PortalShell from "@/components/portal/PortalShell";
import { INHOUSE_NAV_ITEMS } from "@/components/portal/inhouseNav";
import SortableTh from "@/components/SortableTh";
import Pagination from "@/components/Pagination";
import FilterBar from "@/components/portal/FilterBar";
import { usePagination } from "@/lib/usePagination";
import { CaretRight } from "@phosphor-icons/react";

interface SupervisorRow {
  id: string;
  full_name: string;
  email: string;
  country: { id: string; name: string } | null;
  candidatesTotal: number;
  conversionRate: number;
  lastReportAt: string | null;
}

type SortKey = "full_name" | "candidatesTotal" | "conversionRate" | "lastReportAt";

export default function InhouseSupervisorsPage() {
  const [supervisors, setSupervisors] = useState<SupervisorRow[]>([]);
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
    fetch("/api/inhouse/supervisors")
      .then((r) => r.json())
      .then((res) => setSupervisors(res.data ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const visibleSupervisors = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let rows = supervisors;
    if (needle) rows = rows.filter((s) => s.full_name.toLowerCase().includes(needle) || s.email.toLowerCase().includes(needle));
    return [...rows].sort((a, b) => {
      let diff: number;
      if (sortBy === "full_name") diff = a.full_name.localeCompare(b.full_name);
      else if (sortBy === "lastReportAt") diff = new Date(a.lastReportAt ?? 0).getTime() - new Date(b.lastReportAt ?? 0).getTime();
      else diff = a[sortBy] - b[sortBy];
      return sortDir === "asc" ? diff : -diff;
    });
  }, [supervisors, q, sortBy, sortDir]);

  const { page, setPage, totalPages, paged, total, pageSize } = usePagination(visibleSupervisors);

  return (
    <PortalShell roleLabel="In-House Supervisor" navItems={INHOUSE_NAV_ITEMS}>
      <p className="eyebrow mb-3">
        <span className="eyebrow-rule" />
        Operations
      </p>
      <h1 className="section-title text-3xl md:text-4xl mb-2">Country Supervisors.</h1>
      <p className="text-midnight-900/55 font-light mb-8 max-w-2xl">
        Every Country Supervisor across your assigned countries. Click into one to set their KPI targets.
      </p>

      {!loading && supervisors.length > 0 && (
        <FilterBar searchValue={q} onSearchChange={setQ} searchPlaceholder="Search by name or email…" />
      )}

      {loading ? (
        <p className="text-midnight-900/50">Loading…</p>
      ) : supervisors.length === 0 ? (
        <div className="card p-10 text-center text-midnight-900/50">No Country Supervisors in your assigned countries yet.</div>
      ) : visibleSupervisors.length === 0 ? (
        <div className="card p-10 text-center text-midnight-900/50">No supervisors match your filters.</div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-midnight-900/10 text-left text-midnight-900/40 text-xs uppercase tracking-wider">
                <SortableTh label="Name" sortKey="full_name" activeSort={sortBy} activeDir={sortDir} onSort={handleSort} />
                <th className="px-5 py-3 font-semibold">Country</th>
                <SortableTh label="Candidates (all time)" sortKey="candidatesTotal" activeSort={sortBy} activeDir={sortDir} onSort={handleSort} />
                <SortableTh label="Conversion rate" sortKey="conversionRate" activeSort={sortBy} activeDir={sortDir} onSort={handleSort} />
                <SortableTh label="Last report" sortKey="lastReportAt" activeSort={sortBy} activeDir={sortDir} onSort={handleSort} />
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody>
              {paged.map((s) => (
                <tr key={s.id} className="border-b border-midnight-900/5 last:border-0 hover:bg-ivory-100/60">
                  <td className="px-5 py-4">
                    <Link href={`/inhouse/supervisors/${s.id}`} className="font-medium text-midnight-900 hover:underline">
                      {s.full_name}
                    </Link>
                  </td>
                  <td className="px-5 py-4 text-midnight-900/60">{s.country?.name ?? "—"}</td>
                  <td className="px-5 py-4 text-midnight-900/70">{s.candidatesTotal}</td>
                  <td className="px-5 py-4 text-midnight-900/70">{s.conversionRate}%</td>
                  <td className="px-5 py-4 text-midnight-900/60">{s.lastReportAt ? new Date(s.lastReportAt).toLocaleDateString() : "—"}</td>
                  <td className="px-5 py-4">
                    <Link href={`/inhouse/supervisors/${s.id}`} className="text-gold-600 inline-flex items-center gap-1 text-xs font-semibold hover:underline">
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
