"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import PortalShell from "@/components/portal/PortalShell";
import { RECRUITER_NAV_ITEMS } from "@/components/portal/recruiterNav";
import { Target, Users, TrendUp, ChatCircleText, Bell } from "@phosphor-icons/react";

interface CandidateSummary {
  id: string;
  lifecycle_status: string;
  screening_result: boolean | null;
  created_at: string;
}

interface TargetProgress {
  recruiterTargetId: string;
  metric: string;
  campaignName: string;
  targetValue: number;
  actualValue: number;
}

interface ReportRow {
  id: string;
  type: string;
  status: string;
  period_start: string;
  period_end: string;
  return_reason: string | null;
}

interface NoteRow {
  id: string;
  message: string;
  created_at: string;
  author: { full_name: string };
}

interface FeedItem {
  id: string;
  date: string;
  text: string;
  label: string;
  kind: "return" | "note";
}

const METRIC_LABELS: Record<string, string> = {
  agent_signups: "Agent Sign-ups",
  applicant_flow: "Applicant Flow",
  conversion_rate: "Conversion Rate (%)",
};

const CADENCE_DAYS: Record<string, number> = { daily: 1, weekly: 7, monthly: 30 };

function StatTile({ icon: Icon, label, value }: { icon: typeof Users; label: string; value: string | number }) {
  return (
    <div className="card p-6 flex items-center gap-4">
      <div className="w-12 h-12 rounded-full bg-midnight-950/5 flex items-center justify-center shrink-0">
        <Icon size={22} weight="regular" className="text-midnight-800" />
      </div>
      <div>
        <div className="text-2xl font-semibold text-midnight-900">{value}</div>
        <div className="text-midnight-900/50 text-xs uppercase tracking-wider mt-1">{label}</div>
      </div>
    </div>
  );
}

export default function RecruiterOverviewPage() {
  const [candidates, setCandidates] = useState<CandidateSummary[]>([]);
  const [targetProgress, setTargetProgress] = useState<TargetProgress[]>([]);
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [notes, setNotes] = useState<NoteRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const params = new URLSearchParams({
      period_start: monthStart.toISOString().slice(0, 10),
      period_end: now.toISOString().slice(0, 10),
    });

    setLoading(true);
    Promise.all([
      fetch("/api/candidates").then((r) => r.json()),
      fetch(`/api/recruiter-targets/progress?${params}`).then((r) => r.json()),
      fetch("/api/reports").then((r) => r.json()),
      fetch("/api/recruiter-notes").then((r) => r.json()),
    ])
      .then(([candidatesRes, progressRes, reportsRes, notesRes]) => {
        setCandidates(candidatesRes.data ?? []);
        setTargetProgress(progressRes.data ?? []);
        setReports(reportsRes.data ?? []);
        setNotes(notesRes.data ?? []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const stats = useMemo(() => {
    const total = candidates.length;
    const approved = candidates.filter((c) => c.lifecycle_status === "approved").length;
    const identified = candidates.length;
    const screeningEvaluated = candidates.filter((c) => c.screening_result !== null).length;
    const screeningPassed = candidates.filter((c) => c.screening_result === true).length;
    return {
      total,
      approved,
      conversionRate: identified === 0 ? 0 : Math.round((approved / identified) * 1000) / 10,
      screeningPassRate: screeningEvaluated === 0 ? null : Math.round((screeningPassed / screeningEvaluated) * 1000) / 10,
    };
  }, [candidates]);

  const supervisorFeedback = useMemo(() => {
    const fromReturns: FeedItem[] = reports
      .filter((r) => r.status === "returned" && r.return_reason)
      .map((r) => ({ id: r.id, date: r.period_end, text: r.return_reason!, label: `${r.type} report returned`, kind: "return" as const }));
    const fromNotes: FeedItem[] = notes.map((n) => ({ id: n.id, date: n.created_at, text: n.message, label: n.author.full_name, kind: "note" as const }));
    return [...fromReturns, ...fromNotes].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).slice(0, 5);
  }, [reports, notes]);

  const reportsDue = useMemo(() => {
    const now = new Date();
    return (["daily", "weekly", "monthly"] as const).map((type) => {
      const last = reports
        .filter((r) => r.type === type)
        .sort((a, b) => new Date(b.period_end).getTime() - new Date(a.period_end).getTime())[0];
      if (!last) return { type, dueInDays: 0, everSubmitted: false };
      const nextDue = new Date(last.period_end);
      nextDue.setDate(nextDue.getDate() + CADENCE_DAYS[type]);
      const dueInDays = Math.ceil((nextDue.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      return { type, dueInDays, everSubmitted: true };
    });
  }, [reports]);

  return (
    <PortalShell roleLabel="Regional Recruiter" navItems={RECRUITER_NAV_ITEMS}>
      <p className="eyebrow mb-3">
        <span className="eyebrow-rule" />
        Agent network
      </p>
      <h1 className="section-title text-3xl md:text-4xl mb-2">Overview.</h1>
      <p className="text-midnight-900/55 font-light mb-8 max-w-2xl">
        Your targets, candidate pipeline, and performance at a glance — plus anything your country supervisor
        has flagged and which reports are coming due.
      </p>

      {loading ? (
        <p className="text-midnight-900/50">Loading…</p>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 mb-8">
            <StatTile icon={Users} label="Candidates (all time)" value={stats.total} />
            <StatTile icon={TrendUp} label="Conversion rate (identified → approved)" value={`${stats.conversionRate}%`} />
            <StatTile icon={Target} label="Screening pass rate" value={stats.screeningPassRate === null ? "—" : `${stats.screeningPassRate}%`} />
          </div>

          <div className="grid lg:grid-cols-2 gap-6 mb-8">
            <div className="card p-6">
              <h2 className="text-sm font-semibold text-midnight-900/70 uppercase tracking-wider mb-4 flex items-center gap-2">
                <Target size={16} weight="bold" className="text-gold-600" /> Targets this month
              </h2>
              {targetProgress.length === 0 ? (
                <p className="text-sm text-midnight-900/40">No target set for you yet — your country supervisor sets this under Team Targets.</p>
              ) : (
                <div className="space-y-2">
                  {targetProgress.map((p) => (
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
                <Bell size={16} weight="bold" className="text-gold-600" /> Reports due
              </h2>
              <div className="space-y-2">
                {reportsDue.map(({ type, dueInDays, everSubmitted }) => (
                  <div key={type} className="flex items-center justify-between text-sm">
                    <span className="text-midnight-900/70 capitalize">{type}</span>
                    {!everSubmitted ? (
                      <span className="text-xs font-semibold text-amber-700">Not yet submitted</span>
                    ) : dueInDays < 0 ? (
                      <span className="text-xs font-semibold text-red-600">Overdue by {Math.abs(dueInDays)}d</span>
                    ) : dueInDays === 0 ? (
                      <span className="text-xs font-semibold text-amber-700">Due today</span>
                    ) : (
                      <span className="text-xs text-midnight-900/50">Due in {dueInDays}d</span>
                    )}
                  </div>
                ))}
              </div>
              <Link href="/recruiter/reports" className="inline-block mt-4 text-xs font-semibold text-gold-600 hover:underline">
                Submit a report →
              </Link>
            </div>
          </div>

          <div className="card p-6">
            <h2 className="text-sm font-semibold text-midnight-900/70 uppercase tracking-wider mb-4 flex items-center gap-2">
              <ChatCircleText size={16} weight="bold" className="text-gold-600" /> From your country supervisor
            </h2>
            {supervisorFeedback.length === 0 ? (
              <p className="text-sm text-midnight-900/40">No feedback from your supervisor right now.</p>
            ) : (
              <div className="space-y-3">
                {supervisorFeedback.map((item) => (
                  <div key={item.id} className="text-sm border-b border-midnight-900/5 last:border-0 pb-3 last:pb-0">
                    <div className="text-xs text-midnight-900/45 uppercase tracking-wide mb-1">
                      {item.label} · {new Date(item.date).toLocaleDateString()}
                    </div>
                    <div className={item.kind === "return" ? "text-red-600" : "text-midnight-900/80"}>{item.text}</div>
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
