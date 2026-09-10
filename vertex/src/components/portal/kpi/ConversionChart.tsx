"use client";

import { STAGE_LABELS, STAGE_COLORS } from "./stageColors";

interface StageConversion {
  from: string;
  to: string;
  rate: number;
}

interface Props {
  byStage: StageConversion[];
}

/**
 * Stage-to-stage conversion (SRS FR-3.2) — same ordinal ramp as the funnel
 * (this is still "position in a fixed sequence," not series identity), one
 * bar per transition, percentage as the direct label.
 */
export default function ConversionChart({ byStage }: Props) {
  return (
    <div className="space-y-2.5">
      {byStage.map((s) => (
        <div key={`${s.from}-${s.to}`} className="flex items-center gap-3 group">
          <div className="w-44 shrink-0 text-xs text-midnight-900/60 text-right">
            {STAGE_LABELS[s.from]} → {STAGE_LABELS[s.to]}
          </div>
          <div className="flex-1 h-6 bg-midnight-900/5 rounded-sm relative">
            <div
              className="h-6 rounded-r-sm transition-all duration-200 group-hover:brightness-110"
              style={{ width: `${Math.max(2, s.rate)}%`, backgroundColor: STAGE_COLORS[s.to] }}
              title={`${STAGE_LABELS[s.from]} → ${STAGE_LABELS[s.to]}: ${s.rate}%`}
            />
          </div>
          <div className="w-12 shrink-0 text-xs font-semibold text-midnight-900 tabular-nums">{s.rate}%</div>
        </div>
      ))}
    </div>
  );
}
