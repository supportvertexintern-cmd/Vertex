"use client";

import { CASE_STAGE_ORDER, CASE_STAGE_LABELS, type CaseStageKey } from "./caseStages";

/**
 * An 11-segment progress strip for the mobility case lifecycle (SRS
 * FR-4.1) — a single brand hue filled up to the current stage, rather
 * than 11 distinguishable colors nobody could tell apart at a glance.
 * The current-stage label carries the specific information; the strip
 * carries "how far along."
 */
export default function CaseStageProgress({ stage }: { stage: CaseStageKey }) {
  const currentIdx = CASE_STAGE_ORDER.indexOf(stage);

  return (
    <div>
      <div className="flex gap-1">
        {CASE_STAGE_ORDER.map((s, i) => (
          <div
            key={s}
            title={CASE_STAGE_LABELS[s]}
            className={`h-1.5 flex-1 rounded-full ${
              i < currentIdx ? "bg-midnight-700" : i === currentIdx ? "bg-gold-400" : "bg-midnight-900/10"
            }`}
          />
        ))}
      </div>
      <div className="flex justify-between mt-2">
        <span className="text-xs font-semibold text-midnight-900">
          Stage {currentIdx + 1} of {CASE_STAGE_ORDER.length}: {CASE_STAGE_LABELS[stage]}
        </span>
      </div>
    </div>
  );
}
