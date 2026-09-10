"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import PortalShell from "@/components/portal/PortalShell";
import { MANAGEMENT_NAV_ITEMS } from "@/components/portal/managementNav";
import ReportContentView from "@/components/portal/reports/ReportContentView";
import type { ReportContentValue } from "@/components/portal/reports/ReportContentForm";
import { CaretLeft, CheckCircle, ArrowRight } from "@phosphor-icons/react";

interface ReportDetail {
  id: string;
  type: "daily" | "weekly" | "monthly";
  scope_level: string;
  status: string;
  period_start: string;
  period_end: string;
  return_reason: string | null;
  content: Partial<ReportContentValue>;
  submitter: { id: string; full_name: string };
  child_reports: { id: string; status: string; submitter: { full_name: string } }[];
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

// Director/Management only ever reviews scope_level "inhouse" (portfolio)
// reports (2026-07-25, confirmed with the business — everything below
// that tier is In-House's exclusive review responsibility, surfaced to
// Management as aggregate metrics instead, see /management/reports'
// Report Submission Metrics table). So unlike the recruiter/supervisor/
// inhouse detail pages, this one has no "is this my own report" branch —
// it's always the reviewer view.
export default function ManagementReportDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [report, setReport] = useState<ReportDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [returnReason, setReturnReason] = useState("");
  const [saving, setSaving] = useState(false);

  const load = () => {
    setLoading(true);
    fetch(`/api/reports/${id}`)
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body.error?.message ?? "Failed to load report.");
        return body.data;
      })
      .then(setReport)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load report."))
      .finally(() => setLoading(false));
  };

  useEffect(load, [id]);

  const approve = async () => {
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/reports/${id}/verify`, { method: "PATCH" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error?.message ?? "Failed to approve report.");
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to approve report.");
    } finally {
      setSaving(false);
    }
  };

  const returnReport = async () => {
    if (returnReason.trim().length < 5) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/reports/${id}/return`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ return_reason: returnReason }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error?.message ?? "Failed to return report.");
      setReturnReason("");
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to return report.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <PortalShell roleLabel="Management" navItems={MANAGEMENT_NAV_ITEMS}>
      <Link href="/management/reports" className="inline-flex items-center gap-1.5 text-sm text-midnight-900/50 hover:text-gold-600 mb-6">
        <CaretLeft size={14} weight="bold" /> Back to Reports
      </Link>

      {loading ? (
        <p className="text-midnight-900/50">Loading…</p>
      ) : !report ? (
        <div className="card p-10 text-center text-midnight-900/50">{error || "Report not found."}</div>
      ) : (
        <>
          <div className="flex items-start justify-between gap-6 mb-6">
            <div>
              <p className="eyebrow mb-3">
                <span className="eyebrow-rule" />
                Control
              </p>
              <h1 className="section-title text-2xl md:text-3xl capitalize">{report.type} Portfolio Report</h1>
              <p className="text-midnight-900/50 text-sm mt-1">
                {report.submitter.full_name} · {new Date(report.period_start).toLocaleDateString()} –{" "}
                {new Date(report.period_end).toLocaleDateString()}
              </p>
            </div>
            <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold shrink-0 ${STATUS_STYLES[report.status]}`}>
              {report.status}
            </span>
          </div>

          {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4 text-sm mb-6">{error}</div>}

          {report.status === "returned" && report.return_reason && (
            <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4 text-sm mb-6">
              <span className="font-semibold">Returned:</span> {report.return_reason}
            </div>
          )}

          {report.status === "submitted" && (
            <div className="card p-5 mb-6 space-y-3">
              <div className="flex items-center gap-2">
                <button onClick={approve} disabled={saving} className="btn-primary text-xs disabled:opacity-60">
                  <CheckCircle size={14} weight="bold" /> Approve
                </button>
              </div>
              <div className="flex items-center gap-2">
                <textarea
                  placeholder="Reason for return…"
                  value={returnReason}
                  onChange={(e) => setReturnReason(e.target.value)}
                  rows={1}
                  className="input-field text-xs flex-1"
                />
                <button onClick={returnReport} disabled={saving} className="btn-secondary py-2 px-3 text-xs shrink-0 disabled:opacity-60">
                  Return
                </button>
              </div>
            </div>
          )}

          {report.child_reports.length > 0 && (
            <div className="bg-ivory-100 rounded-lg p-4 mb-6 space-y-2">
              <div className="text-xs font-semibold text-midnight-900/50 uppercase tracking-wider mb-1">
                {report.child_reports.length} country report{report.child_reports.length === 1 ? "" : "s"} consolidated
              </div>
              {report.child_reports.map((c) => (
                <div key={c.id} className="flex items-center gap-2 text-xs text-midnight-900/60">
                  <span className="font-medium">{c.submitter.full_name}</span>
                  <ArrowRight size={11} weight="bold" />
                  <span>{report.submitter.full_name}</span>
                  <ArrowRight size={11} weight="bold" />
                  <span>You</span>
                  <span className={`ml-auto inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${STATUS_STYLES[c.status]}`}>{c.status}</span>
                </div>
              ))}
            </div>
          )}

          <div className="card p-6">
            <ReportContentView content={report.content} />
          </div>
        </>
      )}
    </PortalShell>
  );
}
