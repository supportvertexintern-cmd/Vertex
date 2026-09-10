"use client";

import { STAGE_ORDER, STAGE_LABELS, STAGE_COLORS } from "./stageColors";

interface Props {
  flow: Record<string, number>;
}

/**
 * Applicant flow funnel (SRS FR-3.2) — horizontal bars, one hue ordinal
 * ramp (validated), direct value labels at the bar tip. No axis needed:
 * the value at the tip carries the number, the bar length carries the
 * relative magnitude.
 */
export default function FunnelChart({ flow }: Props) {
  const max = Math.max(1, ...STAGE_ORDER.map((s) => flow[s] ?? 0));

  return (
    <div className="space-y-2.5">
      {STAGE_ORDER.map((stage) => {
        const value = flow[stage] ?? 0;
        const pct = Math.max(2, (value / max) * 100);
        return (
          <div key={stage} className="flex items-center gap-3 group">
            <div className="w-32 shrink-0 text-xs text-midnight-900/60 text-right">{STAGE_LABELS[stage]}</div>
            <div className="flex-1 h-6 bg-midnight-900/5 rounded-sm relative">
              <div
                className="h-6 rounded-r-sm transition-all duration-200 group-hover:brightness-110"
                style={{ width: `${pct}%`, backgroundColor: STAGE_COLORS[stage] }}
                title={`${STAGE_LABELS[stage]}: ${value}`}
              />
            </div>
            <div className="w-10 shrink-0 text-xs font-semibold text-midnight-900 tabular-nums">{value}</div>
          </div>
        );
      })}
    </div>
  );
}
