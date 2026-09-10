"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { WarningCircle } from "@phosphor-icons/react";
import { CASE_STAGE_ORDER, CASE_STAGE_LABELS, type CaseStageKey } from "./caseStages";
import CaseStageProgress from "./CaseStageProgress";
import OpsReviewBadge from "./OpsReviewBadge";
import SearchableSelect from "@/components/SearchableSelect";
import Pagination from "@/components/Pagination";
import FilterBar from "./FilterBar";
import { usePagination } from "@/lib/usePagination";

interface CaseRow {
  id: string;
  current_stage: CaseStageKey;
  stage_deadline: string | null;
  created_at: string;
  status: "active" | "rejected";
  ops_review_status: "pending" | "confirmed" | "rejected";
  contract: { status: string } | null;
  retention_follow_up: { due_at: string; completed_at: string | null } | null;
  application: {
    candidate: {
      full_name: string | null;
      user: { full_name: string; email: string } | null;
      recruiter: { full_name: string } | null;
    };
    job: { title: string; country: string; city: string } | null;
    preferred_country_1: { name: string } | null;
    preferred_sector: { name: string } | null;
  };
}

const STAGE_OPTIONS = [
  { value: "", label: "All stages" },
  ...CASE_STAGE_ORDER.map((s) => ({ value: s, label: CASE_STAGE_LABELS[s] })),
];

const CASE_STATUS_OPTIONS = [
  { value: "active", label: "Active cases" },
  { value: "rejected", label: "Rejected cases" },
  { value: "all", label: "All cases" },
];

function DeadlineBadge({ deadline }: { deadline: string | null }) {
  if (!deadline) return null;
  const days = Math.ceil((new Date(deadline).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  if (days < 0) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-semibold text-red-700">
        <WarningCircle size={13} weight="fill" /> Overdue {Math.abs(days)}d
      </span>
    );
  }
  if (days <= 7) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-700">
        <WarningCircle size={13} weight="fill" /> Due in {days}d
      </span>
    );
  }
  return <span className="text-xs text-midnight-900/40">Due {new Date(deadline).toLocaleDateString()}</span>;
}

// Fetches the full (already role-scoped, so naturally small) case set
// unfiltered, then searches/filters/sorts/paginates client-side — same
// lightweight pattern as the Partner Portal's own case list
// (partner/cases/page.tsx), appropriate at recruiter/supervisor/in-house
// scale (one recruiter's own candidates, one country, one team), unlike
// Operations' server-paginated global list.
export default function CaseList({ emptyLabel, basePath }: { emptyLabel: string; basePath: string }) {
  const [cases, setCases] = useState<CaseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [stage, setStage] = useState("");
  const [status, setStatus] = useState("active");
  const [sortBy, setSortBy] = useState<"updated" | "deadline" | "name">("updated");

  useEffect(() => {
    fetch("/api/cases?status=all")
      .then((r) => r.json())
      .then((res) => setCases(res.data ?? []))
      .finally(() => setLoading(false));
  }, []);

  const visibleCases = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let rows = cases.filter((c) => {
      if (status !== "all" && c.status !== status) return false;
      if (stage && c.current_stage !== stage) return false;
      if (!needle) return true;
      const name = (c.application.candidate.user?.full_name ?? c.application.candidate.full_name ?? "").toLowerCase();
      const programme = (c.application.job?.title ?? c.application.preferred_sector?.name ?? "").toLowerCase();
      return name.includes(needle) || programme.includes(needle);
    });
    rows = [...rows].sort((a, b) => {
      if (sortBy === "name") {
        const an = a.application.candidate.user?.full_name ?? a.application.candidate.full_name ?? "";
        const bn = b.application.candidate.user?.full_name ?? b.application.candidate.full_name ?? "";
        return an.localeCompare(bn);
      }
      if (sortBy === "deadline") {
        if (!a.stage_deadline) return 1;
        if (!b.stage_deadline) return -1;
        return new Date(a.stage_deadline).getTime() - new Date(b.stage_deadline).getTime();
      }
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
    return rows;
  }, [cases, q, stage, status, sortBy]);

  const { page, setPage, totalPages, paged, total, pageSize } = usePagination(visibleCases);

  if (loading) return <p className="text-midnight-900/50">Loading…</p>;
  if (cases.length === 0) return <div className="card p-10 text-center text-midnight-900/50">{emptyLabel}</div>;

  return (
    <div className="space-y-3">
      <FilterBar searchValue={q} onSearchChange={setQ} searchPlaceholder="Search by candidate or programme…">
        <SearchableSelect value={stage} onChange={setStage} className="input-field w-56" options={STAGE_OPTIONS} />
        <SearchableSelect value={status} onChange={setStatus} className="input-field w-48" options={CASE_STATUS_OPTIONS} />
        <SearchableSelect
          value={sortBy}
          onChange={(v) => setSortBy(v as "updated" | "deadline" | "name")}
          className="input-field w-52"
          options={[
            { value: "updated", label: "Sort: Recently Opened" },
            { value: "deadline", label: "Sort: Deadline" },
            { value: "name", label: "Sort: Candidate Name" },
          ]}
        />
      </FilterBar>

      {visibleCases.length === 0 ? (
        <div className="card p-10 text-center text-midnight-900/50">No cases match your filters.</div>
      ) : (
        <>
          {paged.map((c) => {
            const name = c.application.candidate.user?.full_name ?? c.application.candidate.full_name ?? "— unnamed —";
            return (
              <Link
                key={c.id}
                href={`${basePath}/${c.id}`}
                className="card p-5 flex items-center justify-between gap-6 hover:shadow-md transition-shadow"
              >
                <div className="min-w-0">
                  <div className="font-medium text-midnight-900">{name}</div>
                  <div className="text-xs text-midnight-900/45 mb-3">
                    {c.application.job
                      ? <>{c.application.job.title} · {c.application.job.city}, {c.application.job.country}</>
                      : <>{c.application.preferred_sector?.name ?? "General Programme"}{c.application.preferred_country_1 && <> · {c.application.preferred_country_1.name}</>}</>}
                    {c.application.candidate.recruiter && <> · {c.application.candidate.recruiter.full_name}</>}
                  </div>
                  <div className="w-72 max-w-full">
                    <CaseStageProgress stage={c.current_stage} />
                  </div>
                </div>
                <div className="shrink-0 text-right space-y-1.5">
                  {c.status === "rejected" && (
                    <div className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-red-100 text-red-700">Rejected</div>
                  )}
                  <DeadlineBadge deadline={c.stage_deadline} />
                  {c.ops_review_status !== "pending" && <OpsReviewBadge status={c.ops_review_status} />}
                  {c.contract && <div className="text-xs text-midnight-900/40 capitalize">Contract: {c.contract.status}</div>}
                  {c.retention_follow_up && !c.retention_follow_up.completed_at && (
                    <div className="text-xs text-amber-700 font-semibold">Retention follow-up due</div>
                  )}
                </div>
              </Link>
            );
          })}
          <Pagination page={page} totalPages={totalPages} onPageChange={setPage} total={total} pageSize={pageSize} />
        </>
      )}
    </div>
  );
}
