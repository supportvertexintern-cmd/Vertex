"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import PortalShell from "@/components/portal/PortalShell";
import { RECRUITER_NAV_ITEMS } from "@/components/portal/recruiterNav";
import SearchableSelect from "@/components/SearchableSelect";
import Pagination from "@/components/Pagination";
import { DEFAULT_PAGE_SIZE } from "@/lib/usePagination";
import ReportContentForm, { EMPTY_REPORT_CONTENT, type ReportContentValue } from "@/components/portal/reports/ReportContentForm";
import type { KpiRow } from "@/components/portal/reports/ReportKpiTable";
import { weekRangeContaining } from "@/lib/reportPeriods";
import { Plus, Target, ArrowRight } from "@phosphor-icons/react";

interface ReportRow {
  id: string;
  type: string;
  status: string;
  period_start: string;
  period_end: string;
  return_reason: string | null;
  content: Partial<ReportContentValue>;
  created_at: string;
}

interface CandidateForReport {
  id: string;
  full_name: string | null;
  user: { full_name: string; email: string } | null;
  email: string | null;
  phone: string | null;
  desired_role: string | null;
  screening_result: boolean | null;
  lifecycle_status: string;
  created_at: string;
  country: { id: string; name: string; region: { id: string; name: string } | null } | null;
}

interface TargetProgress {
  recruiterTargetId: string;
  metric: string;
  campaignName: string;
  targetValue: number;
  actualValue: number;
}

const STATUS_STYLES: Record<string, string> = {
  draft: "bg-slate-100 text-slate-700",
  submitted: "bg-yellow-100 text-yellow-800",
  verified: "bg-emerald-100 text-emerald-800",
  approved: "bg-emerald-100 text-emerald-800",
  returned: "bg-red-100 text-red-700",
  consolidated: "bg-blue-100 text-blue-700",
  escalated: "bg-orange-100 text-orange-800",
  closed: "bg-slate-100 text-slate-700",
};

const METRIC_LABELS: Record<string, string> = {
  agent_signups: "Agent Sign-ups",
  applicant_flow: "Applicant Flow",
  conversion_rate: "Conversion Rate (%)",
};

function TargetProgressList({ progress }: { progress: TargetProgress[] }) {
  if (progress.length === 0) {
    return <p className="text-xs text-midnight-900/40">No target has been set for you yet — your country supervisor sets this under Team Targets.</p>;
  }
  return (
    <div className="space-y-2">
      {progress.map((p) => (
        <div key={p.recruiterTargetId} className="flex items-center justify-between text-sm bg-ivory-100 rounded-lg px-3 py-2">
          <span className="text-midnight-900/70 flex items-center gap-1.5">
            <Target size={13} weight="bold" className="text-gold-600" />
            {METRIC_LABELS[p.metric] ?? p.metric} <span className="text-midnight-900/40 text-xs">({p.campaignName})</span>
          </span>
          <span className="font-semibold text-midnight-900">
            {p.actualValue} / {p.targetValue}
            {p.metric === "conversion_rate" ? "%" : ""}
          </span>
        </div>
      ))}
    </div>
  );
}

// Fills in `actual` for whichever KPI labels have a directly computable
// source from the period's candidate list — target and any KPI without a
// clean computed source (CRM quality, reporting timeliness, etc.) stay
// for the recruiter to fill in manually.
function autoKpis(type: "daily" | "weekly" | "monthly", candidates: CandidateForReport[]): KpiRow[] {
  if (type === "daily") return [];
  const screeningEvaluated = candidates.filter((c) => c.screening_result !== null).length;
  const screened = candidates.filter((c) => c.screening_result === true).length;
  const submittedOrBeyond = candidates.filter((c) => ["submitted", "reported", "verified", "approved"].includes(c.lifecycle_status)).length;
  const verifiedOrBeyond = candidates.filter((c) => ["verified", "approved"].includes(c.lifecycle_status)).length;
  const passRate = screeningEvaluated === 0 ? undefined : Math.round((screened / screeningEvaluated) * 1000) / 10;

  if (type === "weekly") {
    return [
      { label: "Candidate identification", actual: candidates.length },
      { label: "Screening completion", actual: screeningEvaluated },
      { label: "Screening pass rate", actual: passRate },
      { label: "Application submission", actual: submittedOrBeyond },
    ];
  }
  return [
    { label: "Candidates identified", actual: candidates.length },
    { label: "Candidates screened", actual: screeningEvaluated },
    { label: "Qualified candidates", actual: screened },
    { label: "Applications submitted", actual: submittedOrBeyond },
    { label: "Verified candidates", actual: verifiedOrBeyond },
  ];
}

export default function RecruiterReportsPage() {
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [type, setType] = useState<"daily" | "weekly" | "monthly">("daily");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [content, setContent] = useState<ReportContentValue>(EMPTY_REPORT_CONTENT);

  const [periodCandidates, setPeriodCandidates] = useState<CandidateForReport[]>([]);
  const [targetProgress, setTargetProgress] = useState<TargetProgress[]>([]);
  const [loadingPeriodData, setLoadingPeriodData] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const pageSize = DEFAULT_PAGE_SIZE;

  const load = (pageOverride?: number) => {
    setLoading(true);
    fetch(`/api/reports?page=${pageOverride ?? page}&pageSize=${pageSize}`)
      .then((r) => r.json())
      .then((res) => {
        setReports(res.data ?? []);
        setTotal(res.total ?? 0);
      })
      .catch(() => setError("Failed to load reports."))
      .finally(() => setLoading(false));
  };

  useEffect(() => load(), [page]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const isDateDrivenType = type === "weekly" || type === "monthly";

  useEffect(() => {
    if (!isDateDrivenType || !periodStart || !periodEnd) {
      setPeriodCandidates([]);
      setTargetProgress([]);
      return;
    }
    setLoadingPeriodData(true);
    const params = new URLSearchParams({ period_start: periodStart, period_end: periodEnd });
    Promise.all([
      fetch(`/api/candidates?${params}`).then((r) => r.json()),
      fetch(`/api/recruiter-targets/progress?${params}`).then((r) => r.json()),
    ])
      .then(([candidatesRes, progressRes]) => {
        setPeriodCandidates(candidatesRes.data ?? []);
        setTargetProgress(progressRes.data ?? []);
      })
      .catch(() => {})
      .finally(() => setLoadingPeriodData(false));
  }, [isDateDrivenType, type, periodStart, periodEnd]);

  // Re-derive the auto-computable KPI actuals whenever the period's
  // candidate list changes, without clobbering anything the recruiter has
  // already typed into target/comment for those same rows.
  useEffect(() => {
    if (!isDateDrivenType) return;
    const computed = autoKpis(type, periodCandidates);
    setContent((c) => ({
      ...c,
      kpis: computed.map((row) => {
        const existing = c.kpis.find((k) => k.label === row.label);
        return { ...row, target: existing?.target, comment: existing?.comment };
      }),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodCandidates, type, isDateDrivenType]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, period_start: periodStart, period_end: periodEnd, content }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error?.message ?? "Failed to submit report.");
      setType("daily");
      setPeriodStart("");
      setPeriodEnd("");
      setContent(EMPTY_REPORT_CONTENT);
      setShowForm(false);
      setPage(1);
      load(1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit report.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <PortalShell roleLabel="Regional Recruiter" navItems={RECRUITER_NAV_ITEMS}>
      <div className="flex items-start justify-between gap-6 mb-2">
        <div>
          <p className="eyebrow mb-3">
            <span className="eyebrow-rule" />
            Agent network
          </p>
          <h1 className="section-title text-3xl md:text-4xl">Reports</h1>
        </div>
        <button onClick={() => setShowForm((v) => !v)} className="btn-primary text-xs shrink-0">
          <Plus size={16} weight="bold" /> Submit Report
        </button>
      </div>
      <p className="text-midnight-900/55 font-light mb-8 max-w-2xl">
        Daily, weekly, and monthly reports follow the Supervisory Reporting Framework — weekly/monthly KPI
        actuals auto-populate from the candidates you sourced in the period you pick.
      </p>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4 text-sm mb-6">{error}</div>}

      {showForm && (
        <form onSubmit={submit} className="card p-6 mb-6 space-y-4">
          <h3 className="font-semibold text-midnight-900">New report</h3>
          <div className={`grid gap-4 ${type === "monthly" ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
            <SearchableSelect
              value={type}
              onChange={(value) => setType(value as typeof type)}
              options={[
                { value: "daily", label: "Daily Activity Report" },
                { value: "weekly", label: "Weekly Performance Report" },
                { value: "monthly", label: "Monthly Performance Summary" },
              ]}
            />
            {type === "daily" ? (
              <input
                required
                type="date"
                value={periodStart}
                onChange={(e) => {
                  setPeriodStart(e.target.value);
                  setPeriodEnd(e.target.value);
                }}
                className="input-field"
              />
            ) : type === "weekly" ? (
              <div>
                <input
                  required
                  type="date"
                  value={periodStart}
                  onChange={(e) => {
                    const { start, end } = weekRangeContaining(e.target.value);
                    setPeriodStart(start);
                    setPeriodEnd(end);
                  }}
                  className="input-field w-full"
                />
                {periodStart && periodEnd && (
                  <p className="text-[11px] text-midnight-900/40 mt-1">
                    Week: {new Date(periodStart).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })} –{" "}
                    {new Date(periodEnd).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}
                  </p>
                )}
              </div>
            ) : (
              <>
                <input required type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} className="input-field" />
                <input required type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} className="input-field" />
              </>
            )}
          </div>

          {isDateDrivenType && (!periodStart || !periodEnd) && (
            <p className="text-xs text-midnight-900/40">Pick a period above to auto-populate this report.</p>
          )}
          {isDateDrivenType && periodStart && periodEnd && loadingPeriodData && <p className="text-xs text-midnight-900/40">Loading…</p>}

          {(!isDateDrivenType || (periodStart && periodEnd && !loadingPeriodData)) && (
            <>
              <ReportContentForm role="regional_recruiter" cycle={type} value={content} onChange={setContent} />
              {isDateDrivenType && (
                <div>
                  <div className="text-xs font-semibold text-midnight-900/50 uppercase tracking-wider mb-2">Progress vs Target</div>
                  <TargetProgressList progress={targetProgress} />
                </div>
              )}
            </>
          )}

          <button type="submit" disabled={saving || !content.certified} className="btn-primary text-xs disabled:opacity-60">
            {saving ? "Submitting…" : "Certify & Submit"}
          </button>
        </form>
      )}

      {loading ? (
        <p className="text-midnight-900/50">Loading…</p>
      ) : total === 0 ? (
        <div className="card p-10 text-center text-midnight-900/50">No reports submitted yet.</div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-midnight-900/10 text-left text-midnight-900/40 text-xs uppercase tracking-wider">
                <th className="px-5 py-3 font-semibold">Period</th>
                <th className="px-5 py-3 font-semibold">Type</th>
                <th className="px-5 py-3 font-semibold">Status</th>
                <th className="px-5 py-3 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {reports.map((r) => (
                <tr key={r.id} className="border-b border-midnight-900/5 last:border-0">
                  <td className="px-5 py-4 text-midnight-900/70 whitespace-nowrap">
                    {new Date(r.period_start).toLocaleDateString()} – {new Date(r.period_end).toLocaleDateString()}
                  </td>
                  <td className="px-5 py-4 text-midnight-900/70 capitalize">{r.type}</td>
                  <td className="px-5 py-4">
                    <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold ${STATUS_STYLES[r.status]}`}>{r.status}</span>
                  </td>
                  <td className="px-5 py-4 text-right">
                    <Link
                      href={`/recruiter/reports/${r.id}`}
                      className="inline-flex items-center gap-1.5 text-xs font-semibold text-gold-600 hover:underline"
                    >
                      {r.status === "returned" ? "View & Resubmit" : "View"} <ArrowRight size={12} weight="bold" />
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
