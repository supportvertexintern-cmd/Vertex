"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import PortalShell from "@/components/portal/PortalShell";
import { RECRUITER_NAV_ITEMS } from "@/components/portal/recruiterNav";
import ReportContentForm, { EMPTY_REPORT_CONTENT, type ReportContentValue } from "@/components/portal/reports/ReportContentForm";
import ReportContentView from "@/components/portal/reports/ReportContentView";
import { CaretLeft, PencilSimple, PaperPlaneTilt } from "@phosphor-icons/react";

interface ReportDetail {
  id: string;
  type: "daily" | "weekly" | "monthly";
  status: string;
  period_start: string;
  period_end: string;
  return_reason: string | null;
  content: Partial<ReportContentValue>;
  created_at: string;
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

export default function RecruiterReportDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [report, setReport] = useState<ReportDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState<ReportContentValue>(EMPTY_REPORT_CONTENT);
  const [saving, setSaving] = useState(false);

  const load = () => {
    setLoading(true);
    fetch(`/api/reports/${id}`)
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body.error?.message ?? "Failed to load report.");
        return body.data;
      })
      .then((data) => {
        setReport(data);
        setEditContent({ ...EMPTY_REPORT_CONTENT, ...data.content });
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load report."))
      .finally(() => setLoading(false));
  };

  useEffect(load, [id]);

  const resubmit = async () => {
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/reports/${id}/resubmit`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: editContent }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error?.message ?? "Failed to resubmit report.");
      setEditing(false);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to resubmit report.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <PortalShell roleLabel="Regional Recruiter" navItems={RECRUITER_NAV_ITEMS}>
      <Link href="/recruiter/reports" className="inline-flex items-center gap-1.5 text-sm text-midnight-900/50 hover:text-gold-600 mb-6">
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
                Agent network
              </p>
              <h1 className="section-title text-2xl md:text-3xl capitalize">{report.type} Report</h1>
              <p className="text-midnight-900/50 text-sm mt-1">
                {new Date(report.period_start).toLocaleDateString()} – {new Date(report.period_end).toLocaleDateString()}
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

          {report.status === "returned" && !editing && (
            <button onClick={() => setEditing(true)} className="btn-primary text-xs mb-6">
              <PencilSimple size={14} weight="bold" /> Edit &amp; Resubmit
            </button>
          )}

          <div className="card p-6">
            {editing ? (
              <div className="space-y-4">
                <ReportContentForm role="regional_recruiter" cycle={report.type} value={editContent} onChange={setEditContent} />
                <div className="flex items-center gap-2 pt-2">
                  <button onClick={resubmit} disabled={saving || !editContent.certified} className="btn-primary text-xs disabled:opacity-60">
                    {saving ? "Resubmitting…" : <><PaperPlaneTilt size={14} weight="bold" /> Certify &amp; Resubmit</>}
                  </button>
                  <button onClick={() => setEditing(false)} className="btn-secondary text-xs">
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <ReportContentView content={report.content} />
            )}
          </div>
        </>
      )}
    </PortalShell>
  );
}
