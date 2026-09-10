"use client";

import { CheckCircle, WarningCircle } from "@phosphor-icons/react";

interface TargetVsActual {
  campaignTargetId: string;
  metric: string;
  countryId: string | null;
  regionId: string | null;
  targetValue: number;
  actualValue: number;
}

const METRIC_LABELS: Record<string, string> = {
  agent_signups: "Agent Sign-ups",
  applicant_flow: "Applicant Flow",
  conversion_rate: "Conversion Rate",
};

/**
 * Targets vs actuals (SRS FR-3.2) — the bar fill is the brand accent (gold),
 * a distinct hue from the funnel's ordinal green ramp so the two never get
 * confused as the same encoding. Met/under is carried by a reserved status
 * icon + label (never color alone, never the bar's own fill) — this is a
 * status *of* the bar, not the bar's identity.
 */
export default function TargetsVsActuals({ data }: { data: TargetVsActual[] }) {
  if (data.length === 0) {
    return <p className="text-xs text-midnight-900/40">No targets set for this campaign.</p>;
  }

  const max = Math.max(1, ...data.map((d) => Math.max(d.targetValue, d.actualValue)));

  return (
    <div className="space-y-4">
      {data.map((d) => {
        const met = d.actualValue >= d.targetValue;
        const actualPct = Math.max(2, (d.actualValue / max) * 100);
        const targetPct = Math.min(100, (d.targetValue / max) * 100);
        return (
          <div key={d.campaignTargetId}>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-medium text-midnight-900">{METRIC_LABELS[d.metric] ?? d.metric}</span>
              <span className={`inline-flex items-center gap-1 text-xs font-semibold ${met ? "text-emerald-700" : "text-amber-700"}`}>
                {met ? <CheckCircle size={14} weight="fill" /> : <WarningCircle size={14} weight="fill" />}
                {met ? "On target" : "Below target"}
              </span>
            </div>
            <div className="h-6 bg-midnight-900/5 rounded-sm relative">
              <div
                className="h-6 rounded-r-sm bg-gold-400 transition-all duration-200"
                style={{ width: `${actualPct}%` }}
                title={`Actual: ${d.actualValue}`}
              />
              <div
                className="absolute top-0 h-6 w-0.5 bg-midnight-900/70"
                style={{ left: `${targetPct}%` }}
                title={`Target: ${d.targetValue}`}
              />
            </div>
            <div className="flex justify-between mt-1 text-[11px] text-midnight-900/45 tabular-nums">
              <span>Actual: {d.actualValue}</span>
              <span>Target: {d.targetValue}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
