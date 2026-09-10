"use client";

import { useEffect, useState } from "react";
import type { Role, ReportCycle } from "@prisma/client";
import { REPORT_KPI_LABELS } from "@/lib/reportTemplates";
import { Target } from "@phosphor-icons/react";

interface TargetRow {
  id: string;
  kpiLabel: string;
  targetValue: number;
  actualValue: number | null;
}

const CYCLES: ReportCycle[] = ["daily", "weekly", "monthly"];

/**
 * A direct report's personal KPI targets — one row per label already on
 * their own report's KPI table for the selected cycle (REPORT_KPI_LABELS),
 * settable here by whoever manages them (see /api/staff-kpi-targets'
 * callerCanManage). Distinct from — and additive to — the campaign-based
 * RecruiterTarget "Set target" panel that already exists for recruiters;
 * this one covers all 3 supervisory tiers with the same component.
 */
export default function StaffKpiTargetPanel({ staffId, staffRole }: { staffId: string; staffRole: Role }) {
  const [cycle, setCycle] = useState<ReportCycle>("weekly");
  const [targets, setTargets] = useState<TargetRow[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [savingLabel, setSavingLabel] = useState<string | null>(null);
  const [error, setError] = useState("");

  const labels = REPORT_KPI_LABELS[staffRole]?.[cycle] ?? [];

  const load = () => {
    setLoading(true);
    fetch(`/api/staff-kpi-targets?staff_id=${staffId}&cycle=${cycle}`)
      .then((r) => r.json())
      .then((res) => setTargets(res.data ?? []))
      .finally(() => setLoading(false));
  };

  useEffect(load, [staffId, cycle]);

  const valueFor = (label: string) => {
    if (drafts[label] !== undefined) return drafts[label];
    const existing = targets.find((t) => t.kpiLabel === label);
    return existing ? String(existing.targetValue) : "";
  };

  const save = async (label: string) => {
    const raw = drafts[label];
    const value = Number(raw);
    if (!raw || !(value > 0)) return;
    setSavingLabel(label);
    setError("");
    try {
      const res = await fetch("/api/staff-kpi-targets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ staff_id: staffId, cycle, kpi_label: label, target_value: value }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error?.message ?? "Failed to save target.");
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[label];
        return next;
      });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save target.");
    } finally {
      setSavingLabel(null);
    }
  };

  return (
    <div>
      <h2 className="text-sm font-semibold text-midnight-900/70 uppercase tracking-wider mb-4 flex items-center gap-2">
        <Target size={16} weight="bold" className="text-gold-600" /> KPI targets
      </h2>

      <div className="flex items-center gap-1 mb-4">
        {CYCLES.map((c) => (
          <button
            key={c}
            onClick={() => setCycle(c)}
            className={`px-3 py-1 rounded-full text-xs font-semibold capitalize transition-colors ${
              cycle === c ? "bg-midnight-950 text-ivory-50" : "bg-ivory-100 text-midnight-900/60"
            }`}
          >
            {c}
          </button>
        ))}
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-3 text-xs mb-3">{error}</div>}

      {labels.length === 0 ? (
        <p className="text-sm text-midnight-900/40">No KPI table defined for this cycle.</p>
      ) : loading ? (
        <p className="text-sm text-midnight-900/50">Loading…</p>
      ) : (
        <div className="space-y-2">
          {labels.map((label) => {
            const t = targets.find((x) => x.kpiLabel === label);
            return (
              <div key={label} className="flex items-center gap-3">
                <span className="text-sm text-midnight-900/80 flex-1">{label}</span>
                {t?.actualValue != null && <span className="text-xs text-midnight-900/40 shrink-0">actual: {t.actualValue}</span>}
                <input
                  type="number"
                  min="0"
                  value={valueFor(label)}
                  onChange={(e) => setDrafts((prev) => ({ ...prev, [label]: e.target.value }))}
                  className="input-field py-1.5 text-xs w-24 shrink-0"
                  placeholder="Target"
                />
                {drafts[label] !== undefined && (
                  <button
                    type="button"
                    onClick={() => save(label)}
                    disabled={savingLabel === label}
                    className="btn-primary py-1.5 px-3 text-xs disabled:opacity-60 shrink-0"
                  >
                    {savingLabel === label ? "Saving…" : "Save"}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
