"use client";

import { useEffect, useState } from "react";
import type { ReportCycle, Role } from "@prisma/client";
import SearchableSelect from "@/components/SearchableSelect";
import EditableRowTable, { type RowValue } from "./EditableRowTable";
import ReportKpiTable, { type KpiRow } from "./ReportKpiTable";
import { REPORT_KPI_LABELS, getReportSections, OVERALL_STATUS_OPTIONS } from "@/lib/reportTemplates";

export interface ReportContentValue {
  campaign_or_role?: string;
  // Auto-filled server-side from the report's own id once it's created
  // (Supervisory Reporting Framework §3.1's "CRM Submission Ref.") — never
  // user-entered, so there's no input for it in this form.
  crm_reference?: string;
  executive_summary?: string;
  overall_status?: "green" | "amber" | "red" | "grey";
  kpis: KpiRow[];
  pipeline: Record<string, RowValue>[];
  activity: Record<string, RowValue>[];
  issues: Record<string, RowValue>[];
  achievements: Record<string, RowValue>[];
  priorities: Record<string, RowValue>[];
  competencies: Record<string, RowValue>[];
  key_achievement?: string;
  next_priority?: string;
  certified: boolean;
}

export const EMPTY_REPORT_CONTENT: ReportContentValue = {
  kpis: [],
  pipeline: [],
  activity: [],
  issues: [],
  achievements: [],
  priorities: [],
  competencies: [],
  certified: false,
};

const PIPELINE_COLUMNS = [
  { key: "stage", label: "Stage" },
  { key: "opening", label: "Opening", type: "number" as const },
  { key: "added", label: "Added / New", type: "number" as const },
  { key: "moved_forward", label: "Moved Forward / Progressed", type: "number" as const },
  { key: "closed_rejected", label: "Closed / Rejected", type: "number" as const },
  { key: "closing", label: "Closing", type: "number" as const },
  { key: "target", label: "Target", type: "number" as const },
];

const ACHIEVEMENT_COLUMNS = [
  { key: "label", label: "Achievement / Finding" },
  { key: "evidence", label: "Evidence / Analysis" },
  { key: "business_impact", label: "Business Impact / Implication" },
];

const PRIORITY_COLUMNS = [
  { key: "label", label: "Priority / Objective" },
  { key: "planned_activity", label: "Planned Activity / Recommendation" },
  { key: "target_measure", label: "Target / Measure" },
  { key: "support_required", label: "Support Required" },
  { key: "due_date", label: "Due Date", type: "date" as const },
];

const COMPETENCY_COLUMNS = [
  { key: "label", label: "Area" },
  { key: "target", label: "Self-Rating (1-5)", type: "number" as const },
  { key: "detail", label: "Evidence" },
  { key: "actual", label: "Supervisor Rating (1-5)", type: "number" as const },
];

interface Props {
  role: Role;
  cycle: ReportCycle;
  value: ReportContentValue;
  onChange: (value: ReportContentValue) => void;
}

/**
 * The shared body of every Supervisory Reporting Framework report form —
 * §2.1's mandatory sections (KPI table, pipeline/activity table, issues,
 * achievements, priorities, competencies, executive summary,
 * certification), assembled generically and driven entirely by
 * src/lib/reportTemplates.ts's per-role/per-cycle configuration. Each
 * portal's reports page wraps this with its own period picker and any
 * auto-populated data (candidate lists, target progress) specific to
 * that role.
 */
interface CampaignOption {
  id: string;
  name: string;
}

interface CandidateOption {
  id: string;
  full_name: string | null;
  user: { full_name: string } | null;
  phone: string | null;
  email: string | null;
}

export default function ReportContentForm({ role, cycle, value, onChange }: Props) {
  const kpiLabels = REPORT_KPI_LABELS[role]?.[cycle] ?? [];
  const sections = getReportSections(role, cycle);
  const set = <K extends keyof ReportContentValue>(key: K, v: ReportContentValue[K]) => onChange({ ...value, [key]: v });

  const [campaigns, setCampaigns] = useState<CampaignOption[]>([]);
  useEffect(() => {
    fetch("/api/campaigns?scope=mine&status=active")
      .then((r) => r.json())
      .then((res) => setCampaigns(res.data ?? []))
      .catch(() => {});
  }, []);

  // Pre-fill each KPI row's target from whatever the caller's own
  // supervisor has set for that exact label/cycle (StaffKpiTarget) — same
  // idea as autoKpis() pre-filling "actual" on the recruiter's report
  // page from live candidate data, just for "target" instead. Only fills
  // in rows that don't already have a target (an in-progress edit or a
  // loaded draft/resubmit always wins), and stays fully editable after.
  useEffect(() => {
    if (kpiLabels.length === 0) return;
    fetch(`/api/staff-kpi-targets?cycle=${cycle}`)
      .then((r) => r.json())
      .then((res) => {
        const targets: { kpiLabel: string; targetValue: number }[] = res.data ?? [];
        if (targets.length === 0) return;
        let changed = false;
        const nextKpis = [...value.kpis];
        for (const t of targets) {
          const idx = nextKpis.findIndex((r) => r.label === t.kpiLabel);
          if (idx === -1) {
            nextKpis.push({ label: t.kpiLabel, target: t.targetValue });
            changed = true;
          } else if (nextKpis[idx].target == null) {
            nextKpis[idx] = { ...nextKpis[idx], target: t.targetValue };
            changed = true;
          }
        }
        if (changed) set("kpis", nextKpis);
      })
      .catch(() => {});
    // Deliberately only re-runs on cycle change, not on every value.kpis
    // edit — this is a one-time seed, not a continuous sync.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cycle]);

  // The recruiter's Daily Activity Report's "Candidate / CRM ID" column
  // (§3.1) is a searchable select over their own candidates, not free
  // text — a recruiter's own candidates only, matching /api/candidates'
  // own role-based scoping. Other roles' daily activity tables reuse the
  // same underlying column key for a different subject (a recruiter, or
  // a country), so this only applies for regional_recruiter.
  const [candidates, setCandidates] = useState<CandidateOption[]>([]);
  useEffect(() => {
    if (role !== "regional_recruiter" || cycle !== "daily") return;
    fetch("/api/candidates?pageSize=100")
      .then((r) => r.json())
      .then((res) => setCandidates(res.data ?? []))
      .catch(() => {});
  }, [role, cycle]);

  const activityColumns =
    role === "regional_recruiter" && sections.activity
      ? sections.activity.columns.map((c) =>
          c.key === "candidate_ref"
            ? {
                ...c,
                type: "select" as const,
                options: candidates.map((cand) => ({
                  value: cand.user?.full_name ?? cand.full_name ?? "— unnamed lead —",
                  label: `${cand.user?.full_name ?? cand.full_name ?? "— unnamed lead —"}${cand.phone ? ` · ${cand.phone}` : cand.email ? ` · ${cand.email}` : ""}`,
                })),
              }
            : c
        )
      : sections.activity?.columns;

  return (
    <div className="space-y-5">
      <div>
        <label className="block text-xs font-medium text-midnight-900/60 mb-1">Campaign</label>
        <SearchableSelect
          value={value.campaign_or_role ?? ""}
          onChange={(v) => set("campaign_or_role", v)}
          options={campaigns.map((c) => ({ value: c.name, label: c.name }))}
          placeholder={campaigns.length === 0 ? "No active campaigns in your country" : "Select a campaign…"}
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-midnight-900/60 mb-1">Overall Status</label>
        <SearchableSelect
          value={value.overall_status ?? ""}
          onChange={(v) => set("overall_status", v as ReportContentValue["overall_status"])}
          options={OVERALL_STATUS_OPTIONS}
          placeholder="Select…"
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-midnight-900/60 mb-1">Executive Summary</label>
        <textarea
          value={value.executive_summary ?? ""}
          onChange={(e) => set("executive_summary", e.target.value)}
          rows={2}
          placeholder="Progress, achievements, shortfalls, urgent issues, decisions required, overall status."
          className="input-field w-full resize-none text-sm"
        />
      </div>

      {kpiLabels.length > 0 && <ReportKpiTable labels={kpiLabels} rows={value.kpis} onChange={(rows) => set("kpis", rows)} />}

      {sections.pipeline && (
        <EditableRowTable title={sections.pipeline.title} columns={PIPELINE_COLUMNS} rows={value.pipeline} onChange={(rows) => set("pipeline", rows)} />
      )}

      {sections.activity && activityColumns && (
        <EditableRowTable title={sections.activity.title} columns={activityColumns} rows={value.activity} onChange={(rows) => set("activity", rows)} />
      )}

      {sections.achievements && (
        <EditableRowTable title={sections.achievements.title} columns={ACHIEVEMENT_COLUMNS} rows={value.achievements} onChange={(rows) => set("achievements", rows)} />
      )}

      {sections.issues && (
        <EditableRowTable title={sections.issues.title} columns={sections.issues.columns} rows={value.issues} onChange={(rows) => set("issues", rows)} />
      )}

      {sections.competencies && (
        <EditableRowTable
          title={sections.competencies.title}
          columns={COMPETENCY_COLUMNS}
          rows={value.competencies}
          onChange={(rows) => set("competencies", rows)}
        />
      )}

      {sections.priorities && (
        <EditableRowTable title={sections.priorities.title} columns={PRIORITY_COLUMNS} rows={value.priorities} onChange={(rows) => set("priorities", rows)} />
      )}

      {cycle === "daily" && (
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-midnight-900/60 mb-1">Key Achievement</label>
            <input value={value.key_achievement ?? ""} onChange={(e) => set("key_achievement", e.target.value)} className="input-field text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-midnight-900/60 mb-1">Tomorrow's Priority</label>
            <input value={value.next_priority ?? ""} onChange={(e) => set("next_priority", e.target.value)} className="input-field text-sm" />
          </div>
        </div>
      )}

      <label className="flex items-start gap-2 text-sm text-midnight-900/80 font-medium border-t border-midnight-900/10 pt-4">
        <input type="checkbox" checked={value.certified} onChange={(e) => set("certified", e.target.checked)} required className="w-4 h-4 mt-0.5" />
        I confirm that the information above is complete and accurate.
      </label>
    </div>
  );
}
