"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import PortalShell from "@/components/portal/PortalShell";
import { SUPERVISOR_NAV_ITEMS } from "@/components/portal/supervisorNav";
import SearchableSelect from "@/components/SearchableSelect";
import ReportContentForm, { EMPTY_REPORT_CONTENT, type ReportContentValue } from "@/components/portal/reports/ReportContentForm";
import { weekRangeContaining } from "@/lib/reportPeriods";
import { CaretLeft, CheckCircle, Clock, XCircle, MinusCircle } from "@phosphor-icons/react";

interface RosterEntry {
  id: string;
  full_name: string;
  reportId: string | null;
  status: string | null;
}

interface Preview {
  roster: RosterEntry[];
  verifiedReportIds: string[];
  alreadyConsolidated: boolean;
  content: Partial<ReportContentValue>;
}

function RosterStatus({ status }: { status: string | null }) {
  if (status === "verified") return <span className="inline-flex items-center gap-1 text-emerald-600"><CheckCircle size={14} weight="fill" /> Verified</span>;
  if (status === "submitted") return <span className="inline-flex items-center gap-1 text-amber-600"><Clock size={14} weight="fill" /> Awaiting review</span>;
  if (status === "returned") return <span className="inline-flex items-center gap-1 text-red-500"><XCircle size={14} weight="fill" /> Returned</span>;
  if (status) return <span className="text-midnight-900/50 capitalize">{status}</span>;
  return <span className="inline-flex items-center gap-1 text-midnight-900/35"><MinusCircle size={14} weight="regular" /> No report</span>;
}

/**
 * Supervisor-initiated Daily Control Review / Weekly Consolidated /
 * Monthly Country Performance Report (Supervisory Reporting Framework
 * §4.1-4.3). Weekly/monthly preview what the consolidated content would
 * look like from the country's verified recruiter reports for that exact
 * period — the supervisor reviews it, fills in whatever the template
 * needs manually, and submits explicitly. Daily has no consolidation
 * source (§4.1 is filled in directly, not rolled up from anything, same
 * as the in-house Daily Management Exception Report), so it skips
 * straight to the content form. Nothing here writes anything until
 * Certify & Submit; there is no automatic/background submission.
 */
export default function NewCountryReportPage() {
  const router = useRouter();
  const [type, setType] = useState<"daily" | "weekly" | "monthly">("weekly");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [content, setContent] = useState<ReportContentValue>(EMPTY_REPORT_CONTENT);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const isConsolidated = type === "weekly" || type === "monthly";

  useEffect(() => {
    if (!isConsolidated || !periodStart || !periodEnd) {
      setPreview(null);
      return;
    }
    setLoadingPreview(true);
    fetch(`/api/reports/consolidation-preview?type=${type}&period_start=${periodStart}&period_end=${periodEnd}`)
      .then((r) => r.json())
      .then((res) => {
        setPreview(res.data ?? null);
        setContent((c) => ({ ...c, ...(res.data?.content ?? {}) }));
      })
      .catch(() => setError("Failed to load preview."))
      .finally(() => setLoadingPreview(false));
  }, [type, periodStart, periodEnd, isConsolidated]);

  const submit = async () => {
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type,
          period_start: periodStart,
          period_end: periodEnd,
          content,
          child_report_ids: preview?.verifiedReportIds ?? [],
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error?.message ?? "Failed to submit report.");
      router.push("/supervisor/reports");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit report.");
      setSaving(false);
    }
  };

  return (
    <PortalShell roleLabel="Country Supervisor" navItems={SUPERVISOR_NAV_ITEMS}>
      <Link href="/supervisor/reports" className="inline-flex items-center gap-1.5 text-sm text-midnight-900/50 hover:text-gold-600 mb-6">
        <CaretLeft size={14} weight="bold" /> Back to Reports
      </Link>

      <p className="eyebrow mb-3">
        <span className="eyebrow-rule" />
        Agent network
      </p>
      <h1 className="section-title text-2xl md:text-3xl mb-2">Create Country Report</h1>
      <p className="text-midnight-900/55 font-light mb-6 max-w-2xl">
        Pick a type and period — we&rsquo;ll pull in what your recruiters have already verified for it. Review,
        fill in the rest, and submit when ready.
      </p>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4 text-sm mb-6">{error}</div>}

      <div className="card p-6 mb-6 space-y-4">
        <div className="grid sm:grid-cols-2 gap-4">
          <SearchableSelect
            value={type}
            onChange={(v) => {
              setType(v as typeof type);
              setPeriodStart("");
              setPeriodEnd("");
            }}
            options={[
              { value: "daily", label: "Daily Control Review" },
              { value: "weekly", label: "Weekly Consolidated Report" },
              { value: "monthly", label: "Monthly Country Performance Report" },
            ]}
          />
          {type === "daily" ? (
            <input
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
            <div className="grid grid-cols-2 gap-2">
              <input type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} className="input-field" placeholder="Start" />
              <input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} className="input-field" placeholder="End" />
            </div>
          )}
        </div>
      </div>

      {isConsolidated && (!periodStart || !periodEnd) ? (
        <div className="card p-6 text-center text-midnight-900/40">Pick a period above to see what&rsquo;s ready to consolidate.</div>
      ) : loadingPreview ? (
        <p className="text-midnight-900/50">Loading…</p>
      ) : !periodStart ? (
        <div className="card p-6 text-center text-midnight-900/40">Pick a date above to start this report.</div>
      ) : (
        <>
          {isConsolidated && (
            <div className="card p-6 mb-6">
              <h2 className="text-sm font-semibold text-midnight-900/70 uppercase tracking-wider mb-3">Recruiter submissions for this period</h2>
              {preview?.roster.length === 0 ? (
                <p className="text-sm text-midnight-900/40">No recruiters assigned to your country yet.</p>
              ) : (
                <div className="space-y-2">
                  {preview?.roster.map((r) => (
                    <div key={r.id} className="flex items-center justify-between text-sm bg-ivory-100 rounded-lg px-3 py-2">
                      <span className="text-midnight-900/80">{r.full_name}</span>
                      <RosterStatus status={r.status} />
                    </div>
                  ))}
                </div>
              )}
              {preview && preview.verifiedReportIds.length === 0 && (
                <p className="text-xs text-amber-600 mt-3">No verified recruiter reports for this period yet — you can still submit a note-only report.</p>
              )}
              {preview?.alreadyConsolidated && (
                <p className="text-xs text-red-500 mt-3">A country report for this exact period has already been submitted.</p>
              )}
            </div>
          )}

          <div className="card p-6 space-y-4">
            <ReportContentForm role="country_supervisor" cycle={type} value={content} onChange={setContent} />
            <button
              onClick={submit}
              disabled={saving || !content.certified || preview?.alreadyConsolidated}
              className="btn-primary text-xs disabled:opacity-60"
            >
              {saving ? "Submitting…" : "Certify & Submit Country Report"}
            </button>
          </div>
        </>
      )}
    </PortalShell>
  );
}
