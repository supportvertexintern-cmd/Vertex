"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import PortalShell from "@/components/portal/PortalShell";
import { HR_NAV_ITEMS } from "@/components/portal/hrNav";
import SearchableSelect from "@/components/SearchableSelect";
import Pagination from "@/components/Pagination";
import SortableTh from "@/components/SortableTh";
import FilterBar from "@/components/portal/FilterBar";
import OpportunityFilters, { EMPTY_OPPORTUNITY_FILTER_OPTIONS, type OpportunityFilterOptions } from "@/components/portal/OpportunityFilters";
import { CASE_STAGE_ORDER, CASE_STAGE_LABELS, type CaseStageKey } from "@/components/portal/caseStages";
import OpsReviewBadge from "@/components/portal/OpsReviewBadge";
import ExpandableStageText from "@/components/portal/ExpandableStageText";
import { ArrowRight } from "@phosphor-icons/react";
import { useUrlListState } from "@/lib/useUrlListState";

interface CaseRow {
  id: string;
  current_stage: CaseStageKey;
  created_at: string;
  updated_at: string;
  status: "active" | "rejected";
  ops_review_status: "pending" | "confirmed" | "rejected";
  application: {
    candidate: {
      full_name: string | null;
      user: { full_name: string; email: string } | null;
      recruiter: { full_name: string } | null;
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

// Rejected cases don't show by default (GET /api/cases' own default) —
// this lets HR opt back in to find one it (or Operations/Director)
// already rejected.
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

// HR's own case list (2026-08-16) — a direct view of every case it's
// handed off, so finding one doesn't mean digging back through the
// Candidates/Partner Submissions queues that created it. Same unscoped
// access as Operations (server/scope.ts's "hr" branch), read-only here
// except Reject Case on the detail page (/hr/cases/[id]).
export default function HrCasesPage() {
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
  const [country, setCountry] = useState(() => get("country"));
  const [programme, setProgramme] = useState(() => get("programme"));
  const [programmeCountry, setProgrammeCountry] = useState(() => get("programmeCountry"));
  const [filterOptions, setFilterOptions] = useState<OpportunityFilterOptions>(EMPTY_OPPORTUNITY_FILTER_OPTIONS);
  const [page, setPage] = useState(() => getNumber("page", 1));
  const [sortBy, setSortBy] = useState(() => get("sortBy") || "created_at");
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
  }, [q, stage, partnerId, sourceFilter, caseStatus, country, programme, programmeCountry, hasInitializedFromUrl]);

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
    if (country) currentParams.set("country", country);
    if (programme) currentParams.set("programme", programme);
    if (programmeCountry) currentParams.set("programmeCountry", programmeCountry);
    if (sortBy !== "created_at") currentParams.set("sortBy", sortBy);
    if (sortDir !== "desc") currentParams.set("sortDir", sortDir);
    
    const currentUrl = currentParams.toString();
    if (currentUrl !== window.location.search.slice(1)) {
      setUrlState({ page, q, stage, partner_id: partnerId, source: sourceFilter, status: caseStatus, country, programme, programmeCountry, sortBy, sortDir });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, q, stage, partnerId, sourceFilter, caseStatus, country, programme, programmeCountry, sortBy, sortDir, hasInitializedFromUrl]);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE), sortBy, sortDir, status: caseStatus, filterOptions: "true" });
    if (q) params.set("q", q);
    if (stage) params.set("stage", stage);
    if (partnerId) params.set("partner_id", partnerId);
    if (sourceFilter) params.set("source", sourceFilter);
    if (country) params.set("country", country);
    if (programme) params.set("programme", programme);
    if (programmeCountry) params.set("programmeCountry", programmeCountry);
    const timeout = setTimeout(() => {
      fetch(`/api/cases?${params}`)
        .then((r) => r.json())
        .then((res) => {
          setCases(res.data ?? []);
          setTotal(res.total ?? 0);
          if (res.filter_options) setFilterOptions(res.filter_options);
        })
        .finally(() => setLoading(false));
    }, 250);
    return () => clearTimeout(timeout);
  }, [q, stage, partnerId, sourceFilter, caseStatus, country, programme, programmeCountry, page, sortBy, sortDir]);

  const hasClearableFilters = Boolean(q || country || programme || programmeCountry);
  const clearFilters = () => {
    setQ("");
    setCountry("");
    setProgramme("");
    setProgrammeCountry("");
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Build the current URL with all state for back navigation
  const currentUrl = (() => {
    const params = new URLSearchParams();
    if (page > 1) params.set("page", String(page));
    if (q) params.set("q", q);
    if (stage) params.set("stage", stage);
    if (partnerId) params.set("partner_id", partnerId);
    if (sourceFilter) params.set("source", sourceFilter);
    if (country) params.set("country", country);
    if (programme) params.set("programme", programme);
    if (programmeCountry) params.set("programmeCountry", programmeCountry);
    if (caseStatus !== "active") params.set("status", caseStatus);
    if (sortBy !== "created_at") params.set("sortBy", sortBy);
    if (sortDir !== "desc") params.set("sortDir", sortDir);
    const qs = params.toString();
    return qs ? `/hr/cases?${qs}` : "/hr/cases";
  })();

  return (
    <PortalShell roleLabel="Human Resources" navItems={HR_NAV_ITEMS} wideContent>
      <p className="eyebrow mb-3">
        <span className="eyebrow-rule" />
        Mobility Lifecycle
      </p>
      <h1 className="section-title text-3xl md:text-4xl mb-2">Cases.</h1>
      <p className="text-midnight-900/55 font-light mb-8 max-w-2xl">
        Every case handed off from your review queues — read-only, with Reject Case available on a case you
        created by mistake. Stage and document updates are Operations' own lane.
      </p>

      <FilterBar searchValue={q} onSearchChange={setQ} searchPlaceholder="Search by candidate, email, partner, or programme…">
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
        <OpportunityFilters
          options={filterOptions}
          country={country}
          onCountryChange={setCountry}
          programme={programme}
          onProgrammeChange={setProgramme}
          programmeCountry={programmeCountry}
          onProgrammeCountryChange={setProgrammeCountry}
          onClear={clearFilters}
          clearDisabled={!hasClearableFilters}
        />
      </FilterBar>

      {loading ? (
        <p className="text-midnight-900/50">Loading…</p>
      ) : cases.length === 0 ? (
        <div className="card p-10 text-center text-midnight-900/50">
          {q || stage || partnerId || sourceFilter || country || programme || programmeCountry ? "No cases match your filters." : "No active cases yet."}
        </div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full table-fixed text-xs sm:text-sm">
            <thead>
              <tr className="border-b border-midnight-900/10 text-left text-midnight-900/40 text-xs uppercase tracking-wider">
                <th className="px-2 sm:px-3 lg:px-5 py-3 font-semibold">Candidate</th>
                <th className="hidden md:table-cell px-2 sm:px-3 lg:px-5 py-3 font-semibold">Country</th>
                <th className="hidden xl:table-cell px-2 sm:px-3 lg:px-5 py-3 font-semibold">Source</th>
                <th className="hidden xl:table-cell px-2 sm:px-3 lg:px-5 py-3 font-semibold">Partner</th>
                <SortableTh label="Submitted" sortKey="created_at" activeSort={sortBy} activeDir={sortDir} onSort={handleSort} className="hidden 2xl:table-cell" />
                <SortableTh label="Updated" sortKey="updated_at" activeSort={sortBy} activeDir={sortDir} onSort={handleSort} className="hidden 2xl:table-cell" />
                <SortableTh label="Stage" sortKey="current_stage" activeSort={sortBy} activeDir={sortDir} onSort={handleSort} className="w-[30%] md:w-[24%] xl:w-[18%] 2xl:w-[16%] px-2 sm:px-3 lg:px-5" />
                <th className="hidden md:table-cell px-2 sm:px-3 lg:px-5 py-3 font-semibold">Documentation</th>
                <th className="px-2 sm:px-3 lg:px-5 py-3 font-semibold">Status</th>
                <th className="px-2 sm:px-3 lg:px-5 py-3 font-semibold"></th>
              </tr>
            </thead>
            <tbody>
              {cases.map((c) => {
                const name = c.application.candidate.user?.full_name ?? c.application.candidate.full_name ?? "— unnamed —";
                const country = c.application.candidate.country?.name ?? c.application.preferred_country_1?.name ?? "—";
                const source = c.application.candidate.partner?.name ?? c.application.candidate.recruiter?.full_name ?? "Self-submitted";
                return (
                  <tr key={c.id} className="border-b border-midnight-900/5 last:border-0 hover:bg-ivory-100/60">
                    <td className="px-2 sm:px-3 lg:px-5 py-3 sm:py-4 wrap-break-word">
                      <Link href={`/hr/cases/${c.id}?returnTo=${encodeURIComponent(currentUrl)}`} className="font-medium text-midnight-900 hover:underline">
                        {name}
                      </Link>
                      <div className="text-xs text-midnight-900/40">
                        {c.application.job ? c.application.job.title : c.application.preferred_sector?.name ?? "General Programme"}
                      </div>
                    </td>
                    <td className="hidden md:table-cell px-2 sm:px-3 lg:px-5 py-3 sm:py-4 wrap-break-word text-midnight-900/70">{country}</td>
                    <td className="hidden xl:table-cell px-2 sm:px-3 lg:px-5 py-3 sm:py-4 wrap-break-word text-midnight-900/60">{source}</td>
                    <td className="hidden xl:table-cell px-2 sm:px-3 lg:px-5 py-3 sm:py-4 wrap-break-word text-midnight-900/60">{c.application.candidate.partner?.name ?? "—"}</td>
                    <td className="hidden 2xl:table-cell px-2 sm:px-3 lg:px-5 py-3 sm:py-4 text-xs text-midnight-900/50 whitespace-nowrap">{new Date(c.created_at).toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
                    <td className="hidden 2xl:table-cell px-2 sm:px-3 lg:px-5 py-3 sm:py-4 text-xs text-midnight-900/50 whitespace-nowrap">{new Date(c.updated_at).toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
                    <td className="px-2 sm:px-3 lg:px-5 py-3 sm:py-4 text-midnight-900/70 wrap-break-word">
                      <ExpandableStageText text={`Stage ${CASE_STAGE_ORDER.indexOf(c.current_stage) + 1} of ${CASE_STAGE_ORDER.length}: ${CASE_STAGE_LABELS[c.current_stage]}`} />
                    </td>
                    <td className="hidden md:table-cell px-2 sm:px-3 lg:px-5 py-3 sm:py-4"><OpsReviewBadge status={c.ops_review_status} /></td>
                    <td className="px-2 sm:px-3 lg:px-5 py-3 sm:py-4">
                      {c.status === "rejected" ? (
                        <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-red-100 text-red-700">Rejected</span>
                      ) : (
                        <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800">Active</span>
                      )}
                    </td>
                    <td className="px-2 sm:px-3 lg:px-5 py-3 sm:py-4 text-right">
                      <Link
                        href={`/hr/cases/${c.id}`}
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
