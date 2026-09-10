"use client";

import { useEffect, useState } from "react";
import { SCORECARD_AREAS } from "@/lib/validations";
import { Plus } from "@phosphor-icons/react";

interface ScorecardArea {
  id?: string;
  area_key: string;
  weight: number;
  rating: number | null;
  evidence: string | null;
}

interface ScorecardRow {
  id: string;
  period_month: string;
  status: "draft" | "finalized";
  overall_score: number | null;
  performance_category: string | null;
  required_action: string | null;
  review_date: string | null;
  areas: ScorecardArea[];
}

function monthInputValue(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * Supervisory Reporting Framework §7 — the monthly staff performance
 * scorecard, embedded into whichever detail page already exists for a
 * direct report (a Country Supervisor viewing one of their Regional
 * Recruiters, an In-House Supervisor viewing a Country Supervisor, or
 * Management viewing an In-House Supervisor) — the API enforces that only
 * the staff member's actual supervisor (User.supervisor_id) may score
 * them, so this panel doesn't need role-specific variants.
 */
export default function StaffScorecardPanel({ staffId }: { staffId: string }) {
  const [scorecards, setScorecards] = useState<ScorecardRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [month, setMonth] = useState(monthInputValue(new Date()));
  const [ratings, setRatings] = useState<Record<string, { rating?: number; evidence?: string }>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const load = () => {
    setLoading(true);
    fetch(`/api/staff-scorecards?staff_id=${staffId}`)
      .then((r) => r.json())
      .then((res) => setScorecards(res.data ?? []))
      .catch(() => setError("Failed to load scorecards."))
      .finally(() => setLoading(false));
  };

  useEffect(load, [staffId]);

  const saveDraft = async () => {
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/staff-scorecards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          staff_id: staffId,
          period_month: `${month}-01`,
          areas: SCORECARD_AREAS.map((a) => ({ area_key: a.key, rating: ratings[a.key]?.rating, evidence: ratings[a.key]?.evidence })),
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error?.message ?? "Failed to save scorecard.");
      return body.data.id as string;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save scorecard.");
      return null;
    } finally {
      setSaving(false);
    }
  };

  const saveAndFinalize = async () => {
    const id = await saveDraft();
    if (!id) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/staff-scorecards/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error?.message ?? "Failed to finalize scorecard.");
      setRatings({});
      setShowForm(false);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to finalize scorecard.");
    } finally {
      setSaving(false);
    }
  };

  const allRated = SCORECARD_AREAS.every((a) => ratings[a.key]?.rating != null);

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-midnight-900/70 uppercase tracking-wider">Supervisory Performance Scorecard</h3>
        <button onClick={() => setShowForm((v) => !v)} className="btn-secondary text-xs py-1.5 px-3">
          <Plus size={12} weight="bold" /> New Scorecard
        </button>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-3 text-xs mb-3">{error}</div>}

      {showForm && (
        <div className="card p-5 mb-4 space-y-3">
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="input-field w-40 text-sm" />
          <div className="space-y-2">
            {SCORECARD_AREAS.map((a) => (
              <div key={a.key} className="grid grid-cols-[1fr_auto] sm:grid-cols-[2fr_60px_2fr] gap-2 items-center">
                <div className="text-xs font-medium text-midnight-900/80">
                  {a.label} <span className="text-midnight-900/40">({Math.round(a.weight * 100)}%)</span>
                </div>
                <input
                  type="number"
                  min={1}
                  max={5}
                  value={ratings[a.key]?.rating ?? ""}
                  onChange={(e) => setRatings((r) => ({ ...r, [a.key]: { ...r[a.key], rating: e.target.value === "" ? undefined : Number(e.target.value) } }))}
                  className="input-field text-xs py-1 px-2 w-16"
                />
                <input
                  placeholder="Evidence"
                  value={ratings[a.key]?.evidence ?? ""}
                  onChange={(e) => setRatings((r) => ({ ...r, [a.key]: { ...r[a.key], evidence: e.target.value } }))}
                  className="input-field text-xs py-1 px-2"
                />
              </div>
            ))}
          </div>
          <div className="flex gap-2 pt-2 border-t border-midnight-900/10">
            <button onClick={saveDraft} disabled={saving} className="btn-secondary text-xs py-1.5 px-3 disabled:opacity-60">
              Save Draft
            </button>
            <button onClick={saveAndFinalize} disabled={saving || !allRated} className="btn-primary text-xs py-1.5 px-3 disabled:opacity-60">
              {saving ? "Saving…" : "Finalize"}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-xs text-midnight-900/40">Loading…</p>
      ) : scorecards.length === 0 ? (
        <p className="text-xs text-midnight-900/40">No scorecards yet.</p>
      ) : (
        <div className="space-y-2">
          {scorecards.map((s) => (
            <div key={s.id} className="flex items-center justify-between bg-ivory-100 rounded-lg px-3 py-2 text-xs">
              <span className="text-midnight-900/70">{new Date(s.period_month).toLocaleDateString(undefined, { month: "long", year: "numeric" })}</span>
              {s.status === "finalized" ? (
                <span className="font-semibold text-midnight-900">
                  {s.overall_score?.toFixed(2)} / 5.00 — {s.performance_category} ({s.required_action})
                </span>
              ) : (
                <span className="text-midnight-900/40 italic">Draft</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
