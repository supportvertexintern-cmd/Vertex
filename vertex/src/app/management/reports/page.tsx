"use client";

import { useEffect, useState } from "react";
import PortalShell from "@/components/portal/PortalShell";
import { MANAGEMENT_NAV_ITEMS } from "@/components/portal/managementNav";
import ReportsSection from "@/components/portal/reports/ReportsSection";
import SearchableSelect from "@/components/SearchableSelect";
import Pagination from "@/components/Pagination";
import FilterBar from "@/components/portal/FilterBar";

const METRICS_PAGE_SIZE = 15;
const CADENCES = ["daily", "weekly", "monthly"] as const;

const ROLE_LABELS: Record<string, string> = {
  regional_recruiter: "Recruiter",
  country_supervisor: "Country Supervisor",
};

interface MetricsRow {
  id: string;
  full_name: string;
  role: string;
  country: { id: string; name: string } | null;
  submittedCount: number;
  verifiedCount: number;
  returnedCount: number;
  lastReportAt: string | null;
}

interface CountryOption {
  id: string;
  name: string;
}

function ReportSubmissionMetrics() {
  const [cadence, setCadence] = useState<(typeof CADENCES)[number]>("weekly");
  const [q, setQ] = useState("");
  const [countryId, setCountryId] = useState("");
  const [countries, setCountries] = useState<CountryOption[]>([]);
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<MetricsRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/admin/countries")
      .then((r) => r.json())
      .then((res) => setCountries(res.data ?? []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    setPage(1);
  }, [cadence, q, countryId]);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({ cadence, page: String(page), pageSize: String(METRICS_PAGE_SIZE) });
    if (q) params.set("q", q);
    if (countryId) params.set("country_id", countryId);
    const timeout = setTimeout(() => {
      fetch(`/api/management/report-metrics?${params}`)
        .then((r) => r.json())
        .then((res) => {
          setRows(res.data ?? []);
          setTotal(res.total ?? 0);
        })
        .finally(() => setLoading(false));
    }, 250);
    return () => clearTimeout(timeout);
  }, [cadence, q, countryId, page]);

  const totalPages = Math.max(1, Math.ceil(total / METRICS_PAGE_SIZE));

  return (
    <div>
      <div className="flex flex-wrap items-center gap-1 mb-4">
        {CADENCES.map((c) => (
          <button
            key={c}
            onClick={() => setCadence(c)}
            className={`px-4 py-1.5 rounded-full text-xs font-semibold capitalize transition-colors ${
              cadence === c ? "bg-midnight-950 text-ivory-50" : "bg-ivory-100 text-midnight-900/60"
            }`}
          >
            {c}
          </button>
        ))}
      </div>

      <FilterBar searchValue={q} onSearchChange={setQ} searchPlaceholder="Search by name…">
        <SearchableSelect
          value={countryId}
          onChange={setCountryId}
          placeholder="All countries"
          className="input-field w-52"
          options={[{ value: "", label: "All countries" }, ...countries.map((c) => ({ value: c.id, label: c.name }))]}
        />
      </FilterBar>

      {loading ? (
        <p className="text-midnight-900/50">Loading…</p>
      ) : rows.length === 0 ? (
        <div className="card p-6 text-center text-midnight-900/40">
          No recruiters or country supervisors match your filters.
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-midnight-900/10 text-left text-midnight-900/40 text-xs uppercase tracking-wider">
                <th className="px-5 py-3 font-semibold">Name</th>
                <th className="px-5 py-3 font-semibold">Role</th>
                <th className="px-5 py-3 font-semibold">Country</th>
                <th className="px-5 py-3 font-semibold">Submitted</th>
                <th className="px-5 py-3 font-semibold">Verified</th>
                <th className="px-5 py-3 font-semibold">Returned</th>
                <th className="px-5 py-3 font-semibold">Last Report</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-midnight-900/5 last:border-0">
                  <td className="px-5 py-4 font-medium text-midnight-900">{r.full_name}</td>
                  <td className="px-5 py-4 text-midnight-900/60">{ROLE_LABELS[r.role] ?? r.role}</td>
                  <td className="px-5 py-4 text-midnight-900/60">{r.country?.name ?? "—"}</td>
                  <td className="px-5 py-4 text-midnight-900/70">{r.submittedCount}</td>
                  <td className="px-5 py-4 text-emerald-700">{r.verifiedCount}</td>
                  <td className="px-5 py-4 text-red-600">{r.returnedCount}</td>
                  <td className="px-5 py-4 text-midnight-900/50">
                    {r.lastReportAt ? new Date(r.lastReportAt).toLocaleDateString() : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="px-5">
            <Pagination page={page} totalPages={totalPages} onPageChange={setPage} total={total} pageSize={METRICS_PAGE_SIZE} />
          </div>
        </div>
      )}
    </div>
  );
}

export default function ManagementReportsPage() {
  return (
    <PortalShell roleLabel="Management" navItems={MANAGEMENT_NAV_ITEMS}>
      <p className="eyebrow mb-3">
        <span className="eyebrow-rule" />
        Control
      </p>
      <h1 className="section-title text-3xl md:text-4xl mb-2">Reports.</h1>
      <p className="text-midnight-900/55 font-light mb-8 max-w-2xl">
        Submission metrics for every recruiter and country supervisor, and the actual In-House Supervisor portfolio
        reports submitted to you — recruiter and country-level report content stays In-House&rsquo;s exclusive
        review responsibility.
      </p>

      <h2 className="text-sm font-semibold text-midnight-900/50 uppercase tracking-wider mb-3">
        Report submission metrics
      </h2>
      <div className="mb-10">
        <ReportSubmissionMetrics />
      </div>

      <h2 className="text-sm font-semibold text-midnight-900/50 uppercase tracking-wider mb-3">
        Portfolio reports (In-House → Management)
      </h2>
      <ReportsSection
        scopeLevel="inhouse"
        detailBasePath="/management/reports"
        submitterColumnLabel="In-House Supervisor"
        showCountryFilter
        searchPlaceholder="Search by submitter…"
        typeLabel="portfolio reports"
      />
    </PortalShell>
  );
}
