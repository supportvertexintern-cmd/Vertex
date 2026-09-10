"use client";

import { useEffect, useState } from "react";
import SearchableSelect from "@/components/SearchableSelect";
import ReportsTable, { type ReportTableRow } from "./ReportsTable";
import FilterBar from "@/components/portal/FilterBar";

const PAGE_SIZE = 15;
const TYPES = ["daily", "weekly", "monthly"] as const;

const STATUS_OPTIONS = [
  { value: "", label: "All statuses" },
  { value: "submitted", label: "Submitted" },
  { value: "verified", label: "Verified" },
  { value: "approved", label: "Approved" },
  { value: "returned", label: "Returned" },
  { value: "consolidated", label: "Consolidated" },
];

interface CountryOption {
  id: string;
  name: string;
}

interface Props {
  scopeLevel: "recruiter" | "country" | "inhouse";
  detailBasePath: string;
  submitterColumnLabel?: string;
  countryColumn?: boolean;
  searchPlaceholder: string;
  typeLabel: string; // e.g. "reports" for the empty-state message
  refreshKey?: number; // bump from a parent to force a reload after an external action
  // Adds a country dropdown filter alongside search/status — matches
  // against the report's own country_id for recruiter/country-scope
  // reports, or the submitter's assigned countries for inhouse-scope
  // ones (see GET /api/reports' country_id handling). Off by default
  // since it's not meaningful for a caller already scoped to one country
  // (e.g. a Country Supervisor's own recruiter-reports table).
  showCountryFilter?: boolean;
}

// Owns the Daily/Weekly/Monthly tabs + search + status filter + real
// server-side pagination for one scope_level slice of /api/reports —
// used for both of a supervisor's/in-house's two report tables (reports
// awaiting their review, and their own submissions), rather than the
// old approach of fetching pageSize=200 and slicing/grouping client-side.
export default function ReportsSection({
  scopeLevel,
  detailBasePath,
  submitterColumnLabel,
  countryColumn,
  searchPlaceholder,
  typeLabel,
  refreshKey,
  showCountryFilter,
}: Props) {
  const [type, setType] = useState<(typeof TYPES)[number]>("daily");
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [countryId, setCountryId] = useState("");
  const [countries, setCountries] = useState<CountryOption[]>([]);
  const [page, setPage] = useState(1);
  const [reports, setReports] = useState<ReportTableRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!showCountryFilter) return;
    fetch("/api/admin/countries")
      .then((r) => r.json())
      .then((res) => setCountries(res.data ?? []))
      .catch(() => {});
  }, [showCountryFilter]);

  useEffect(() => {
    setPage(1);
  }, [type, status, q, countryId]);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({ scope_level: scopeLevel, type, page: String(page), pageSize: String(PAGE_SIZE) });
    if (q) params.set("q", q);
    if (status) params.set("status", status);
    if (countryId) params.set("country_id", countryId);
    const timeout = setTimeout(() => {
      fetch(`/api/reports?${params}`)
        .then((r) => r.json())
        .then((res) => {
          setReports(res.data ?? []);
          setTotal(res.total ?? 0);
        })
        .finally(() => setLoading(false));
    }, 250); // debounced search-as-you-type, same as admin/users
    return () => clearTimeout(timeout);
  }, [scopeLevel, type, status, q, countryId, page, refreshKey]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div>
      <div className="flex flex-wrap items-center gap-1 mb-4">
        {TYPES.map((t) => (
          <button
            key={t}
            onClick={() => setType(t)}
            className={`px-4 py-1.5 rounded-full text-xs font-semibold capitalize transition-colors ${
              type === t ? "bg-midnight-950 text-ivory-50" : "bg-ivory-100 text-midnight-900/60"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      <FilterBar searchValue={q} onSearchChange={setQ} searchPlaceholder={searchPlaceholder}>
        <SearchableSelect value={status} onChange={setStatus} className="input-field w-52" options={STATUS_OPTIONS} />
        {showCountryFilter && (
          <SearchableSelect
            value={countryId}
            onChange={setCountryId}
            placeholder="All countries"
            className="input-field w-52"
            options={[{ value: "", label: "All countries" }, ...countries.map((c) => ({ value: c.id, label: c.name }))]}
          />
        )}
      </FilterBar>

      {loading ? (
        <p className="text-midnight-900/50">Loading…</p>
      ) : (
        <ReportsTable
          rows={reports}
          detailBasePath={detailBasePath}
          submitterColumnLabel={submitterColumnLabel}
          countryColumn={countryColumn}
          emptyLabel={`No ${type} ${typeLabel}${q || status ? " matching your filters" : ""}.`}
          page={page}
          totalPages={totalPages}
          onPageChange={setPage}
          total={total}
          pageSize={PAGE_SIZE}
        />
      )}
    </div>
  );
}
