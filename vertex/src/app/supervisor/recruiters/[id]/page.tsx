"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import PortalShell from "@/components/portal/PortalShell";
import { SUPERVISOR_NAV_ITEMS } from "@/components/portal/supervisorNav";
import StaffScorecardPanel from "@/components/portal/StaffScorecardPanel";
import StaffKpiTargetPanel from "@/components/portal/StaffKpiTargetPanel";
import { CaretLeft, Target, FileText, ChatCircleText, PaperPlaneTilt } from "@phosphor-icons/react";

interface TargetProgress {
  recruiterTargetId: string;
  metric: string;
  campaignName: string;
  targetValue: number;
  actualValue: number;
}

interface CampaignTargetRow {
  id: string;
  metric: string;
  target_value: number;
  campaign: { id: string; name: string; start_date: string; end_date: string };
}

interface Allocation {
  id: string;
  campaign_target_id: string;
  recruiter_id: string;
  target_value: number;
}

interface RecruiterDetail {
  recruiter: { id: string; full_name: string; email: string };
  candidatesTotal: number;
  conversionRate: number;
  targetProgress: TargetProgress[];
  campaignTargets: CampaignTargetRow[];
  allocations: Allocation[];
}

interface ReportRow {
  id: string;
  type: string;
  status: string;
  period_start: string;
  period_end: string;
  return_reason: string | null;
  content: { notes?: string; executive_summary?: string };
}

interface NoteRow {
  id: string;
  message: string;
  created_at: string;
  author: { full_name: string };
}

const METRIC_LABELS: Record<string, string> = {
  agent_signups: "Agent Sign-ups",
  applicant_flow: "Applicant Flow",
  conversion_rate: "Conversion Rate (%)",
};

const STATUS_STYLES: Record<string, string> = {
  draft: "bg-slate-100 text-slate-700",
  submitted: "bg-yellow-100 text-yellow-800",
  verified: "bg-emerald-100 text-emerald-800",
  returned: "bg-red-100 text-red-700",
  consolidated: "bg-blue-100 text-blue-700",
};

export default function SupervisorRecruiterDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  const [detail, setDetail] = useState<RecruiterDetail | null>(null);
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [notes, setNotes] = useState<NoteRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [targetDrafts, setTargetDrafts] = useState<Record<string, string>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [returnDrafts, setReturnDrafts] = useState<Record<string, string>>({});
  const [newNote, setNewNote] = useState("");
  const [sendingNote, setSendingNote] = useState(false);

  const load = () => {
    setLoading(true);
    Promise.all([
      fetch(`/api/supervisor/recruiters/${id}`).then((r) => r.json()),
      fetch(`/api/reports?recruiter_id=${id}`).then((r) => r.json()),
      fetch(`/api/recruiter-notes?recruiter_id=${id}`).then((r) => r.json()),
    ])
      .then(([detailRes, reportsRes, notesRes]) => {
        if (detailRes.error) throw new Error(detailRes.error.message);
        setDetail(detailRes.data);
        setReports(reportsRes.data ?? []);
        setNotes(notesRes.data ?? []);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load recruiter."))
      .finally(() => setLoading(false));
  };

  useEffect(load, [id]);

  const allocationKey = (campaignTargetId: string) => campaignTargetId;

  const valueFor = (campaignTargetId: string) => {
    const k = allocationKey(campaignTargetId);
    if (targetDrafts[k] !== undefined) return targetDrafts[k];
    const existing = detail?.allocations.find((a) => a.campaign_target_id === campaignTargetId);
    return existing ? String(existing.target_value) : "";
  };

  const saveTarget = async (campaignTargetId: string) => {
    const k = allocationKey(campaignTargetId);
    const raw = targetDrafts[k];
    const value = Number(raw);
    if (!raw || !(value > 0)) return;

    setSavingKey(k);
    setError("");
    try {
      const res = await fetch("/api/recruiter-targets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaign_target_id: campaignTargetId, recruiter_id: id, target_value: value }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error?.message ?? "Failed to save target.");
      setTargetDrafts((prev) => {
        const next = { ...prev };
        delete next[k];
        return next;
      });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save target.");
    } finally {
      setSavingKey(null);
    }
  };

  const verify = async (reportId: string) => {
    await fetch(`/api/reports/${reportId}/verify`, { method: "PATCH" });
    load();
  };

  const returnReport = async (reportId: string) => {
    const reason = returnDrafts[reportId];
    if (!reason || reason.trim().length < 5) return;
    await fetch(`/api/reports/${reportId}/return`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ return_reason: reason }),
    });
    load();
  };

  const sendNote = async () => {
    if (!newNote.trim()) return;
    setSendingNote(true);
    try {
      const res = await fetch("/api/recruiter-notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recruiter_id: id, message: newNote }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error?.message ?? "Failed to send note.");
      setNotes((prev) => [body.data, ...prev]);
      setNewNote("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send note.");
    } finally {
      setSendingNote(false);
    }
  };

  const pendingReports = reports.filter((r) => r.status === "submitted");
  const otherReports = reports.filter((r) => r.status !== "submitted");

  return (
    <PortalShell roleLabel="Country Supervisor" navItems={SUPERVISOR_NAV_ITEMS}>
      <Link href="/supervisor/recruiters" className="inline-flex items-center gap-1 text-xs font-semibold text-midnight-900/50 hover:text-midnight-900 mb-4">
        <CaretLeft size={12} weight="bold" /> Recruiters
      </Link>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4 text-sm mb-6">{error}</div>}

      {loading || !detail ? (
        <p className="text-midnight-900/50">Loading…</p>
      ) : (
        <>
          <h1 className="section-title text-3xl md:text-4xl mb-1">{detail.recruiter.full_name}</h1>
          <p className="text-midnight-900/55 font-light mb-8">{detail.recruiter.email}</p>

          <div className="grid grid-cols-2 sm:grid-cols-2 gap-5 mb-8">
            <div className="card p-6">
              <div className="text-2xl font-semibold text-midnight-900">{detail.candidatesTotal}</div>
              <div className="text-midnight-900/50 text-xs uppercase tracking-wider mt-1">Candidates this month</div>
            </div>
            <div className="card p-6">
              <div className="text-2xl font-semibold text-midnight-900">{detail.conversionRate}%</div>
              <div className="text-midnight-900/50 text-xs uppercase tracking-wider mt-1">Conversion rate this month</div>
            </div>
          </div>

          <div className="grid lg:grid-cols-2 gap-6 mb-8">
            <div className="card p-6">
              <h2 className="text-sm font-semibold text-midnight-900/70 uppercase tracking-wider mb-4 flex items-center gap-2">
                <Target size={16} weight="bold" className="text-gold-600" /> Progress vs target this month
              </h2>
              {detail.targetProgress.length === 0 ? (
                <p className="text-sm text-midnight-900/40">No target set yet — set one below.</p>
              ) : (
                <div className="space-y-2">
                  {detail.targetProgress.map((p) => (
                    <div key={p.recruiterTargetId} className="flex items-center justify-between text-sm bg-ivory-100 rounded-lg px-3 py-2.5">
                      <span className="text-midnight-900/70">
                        {METRIC_LABELS[p.metric] ?? p.metric} <span className="text-midnight-900/40 text-xs">({p.campaignName})</span>
                      </span>
                      <span className="font-semibold text-midnight-900">
                        {p.actualValue} / {p.targetValue}
                        {p.metric === "conversion_rate" ? "%" : ""}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="card p-6">
              <h2 className="text-sm font-semibold text-midnight-900/70 uppercase tracking-wider mb-4 flex items-center gap-2">
                <Target size={16} weight="bold" className="text-gold-600" /> Campaign target allocation
              </h2>
              {detail.campaignTargets.length === 0 ? (
                <p className="text-sm text-midnight-900/40">No active campaign targets for your country yet.</p>
              ) : (
                <div className="space-y-3">
                  {detail.campaignTargets.map((ct) => {
                    const k = allocationKey(ct.id);
                    return (
                      <div key={ct.id} className="flex items-center gap-3">
                        <span className="text-sm text-midnight-900/80 flex-1">
                          {METRIC_LABELS[ct.metric] ?? ct.metric} <span className="text-midnight-900/40 text-xs">({ct.campaign.name})</span>
                        </span>
                        <input
                          type="number"
                          min="0"
                          value={valueFor(ct.id)}
                          onChange={(e) => setTargetDrafts((prev) => ({ ...prev, [k]: e.target.value }))}
                          className="input-field py-1.5 text-xs w-24"
                          placeholder="Target"
                        />
                        {targetDrafts[k] !== undefined && (
                          <button
                            type="button"
                            onClick={() => saveTarget(ct.id)}
                            disabled={savingKey === k}
                            className="btn-primary py-1.5 px-3 text-xs disabled:opacity-60"
                          >
                            {savingKey === k ? "Saving…" : "Save"}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <div className="card p-6 mb-8">
            <h2 className="text-sm font-semibold text-midnight-900/70 uppercase tracking-wider mb-4 flex items-center gap-2">
              <FileText size={16} weight="bold" className="text-gold-600" /> Reports
            </h2>
            {pendingReports.length === 0 && otherReports.length === 0 ? (
              <p className="text-sm text-midnight-900/40">No reports submitted yet.</p>
            ) : (
              <div className="space-y-3">
                {pendingReports.map((r) => (
                  <div key={r.id} className="border border-amber-200 bg-amber-50/50 rounded-lg p-4">
                    <div className="flex items-start justify-between gap-4 mb-2">
                      <div className="text-xs text-midnight-900/45 capitalize">
                        {r.type} · {new Date(r.period_start).toLocaleDateString()} – {new Date(r.period_end).toLocaleDateString()}
                      </div>
                      <button onClick={() => verify(r.id)} className="text-xs font-semibold text-emerald-600 hover:underline shrink-0">Verify</button>
                    </div>
                    {(r.content?.notes || r.content?.executive_summary) && (
                      <p className="text-sm text-midnight-900/70 mb-3">{r.content.notes || r.content.executive_summary}</p>
                    )}
                    <div className="flex items-center gap-2">
                      <textarea
                        placeholder="Reason for return…"
                        value={returnDrafts[r.id] ?? ""}
                        onChange={(e) => setReturnDrafts((prev) => ({ ...prev, [r.id]: e.target.value }))}
                        rows={1}
                        className="input-field text-xs flex-1"
                      />
                      <button onClick={() => returnReport(r.id)} className="btn-secondary py-2 px-3 text-xs shrink-0">Return</button>
                    </div>
                  </div>
                ))}
                {otherReports.map((r) => (
                  <div key={r.id} className="flex items-center justify-between text-sm border-b border-midnight-900/5 last:border-0 pb-3 last:pb-0">
                    <div className="text-midnight-900/70 capitalize">
                      {r.type} · {new Date(r.period_start).toLocaleDateString()} – {new Date(r.period_end).toLocaleDateString()}
                    </div>
                    <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold ${STATUS_STYLES[r.status]}`}>{r.status}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="card p-6 mb-8">
            <StaffKpiTargetPanel staffId={detail.recruiter.id} staffRole="regional_recruiter" />
          </div>

          <div className="card p-6 mb-8">
            <StaffScorecardPanel staffId={detail.recruiter.id} />
          </div>

          <div className="card p-6">
            <h2 className="text-sm font-semibold text-midnight-900/70 uppercase tracking-wider mb-4 flex items-center gap-2">
              <ChatCircleText size={16} weight="bold" className="text-gold-600" /> Notes to {detail.recruiter.full_name.split(" ")[0]}
            </h2>
            <div className="flex items-center gap-2 mb-4">
              <textarea
                placeholder="Write a note…"
                value={newNote}
                onChange={(e) => setNewNote(e.target.value)}
                rows={2}
                className="input-field text-sm flex-1 resize-none"
              />
              <button onClick={sendNote} disabled={sendingNote || !newNote.trim()} className="btn-primary text-xs shrink-0 disabled:opacity-60">
                <PaperPlaneTilt size={14} weight="bold" /> Send
              </button>
            </div>
            {notes.length === 0 ? (
              <p className="text-sm text-midnight-900/40">No notes sent yet.</p>
            ) : (
              <div className="space-y-3">
                {notes.map((n) => (
                  <div key={n.id} className="text-sm border-b border-midnight-900/5 last:border-0 pb-3 last:pb-0">
                    <div className="text-xs text-midnight-900/45 mb-1">
                      {n.author.full_name} · {new Date(n.created_at).toLocaleString()}
                    </div>
                    <div className="text-midnight-900/80">{n.message}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </PortalShell>
  );
}
