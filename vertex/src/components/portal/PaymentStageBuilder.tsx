"use client";

import SearchableSelect from "@/components/SearchableSelect";
import { CASE_STAGE_ORDER, CASE_STAGE_LABELS } from "@/components/portal/caseStages";
import { Plus, Trash } from "@phosphor-icons/react";

export interface PaymentStageDraft {
  order: number;
  label: string;
  percent: string;
  trigger_stage: string;
}

const STAGE_OPTIONS = CASE_STAGE_ORDER.map((s) => ({ value: s, label: CASE_STAGE_LABELS[s] }));

interface Props {
  stages: PaymentStageDraft[];
  onChange: (stages: PaymentStageDraft[]) => void;
}

// Marketing's repeatable payment-stage builder (2026-09-16, flexible
// per-Job payment stages) — an arbitrary number of stages, each with its
// own label/percent/trigger Case stage, replacing the old fixed
// is_credit_service financing_percent/installment_count inputs. The same
// shape (order/label/percent/trigger_stage) is what POST/PUT /api/jobs
// validates and persists as JobPaymentStage rows.
export default function PaymentStageBuilder({ stages, onChange }: Props) {
  const total = stages.reduce((sum, s) => sum + (Number(s.percent) || 0), 0);
  const isValid = stages.length > 0 && Math.round(total) === 100;

  const addStage = () => {
    onChange([...stages, { order: stages.length + 1, label: "", percent: "", trigger_stage: CASE_STAGE_ORDER[0] }]);
  };
  const removeStage = (index: number) => {
    onChange(stages.filter((_, i) => i !== index).map((s, i) => ({ ...s, order: i + 1 })));
  };
  const updateStage = (index: number, patch: Partial<PaymentStageDraft>) => {
    onChange(stages.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  };

  return (
    <div className="space-y-3">
      {stages.map((stage, i) => (
        <div key={i} className="grid grid-cols-12 gap-2 items-center">
          <input
            value={stage.label}
            onChange={(e) => updateStage(i, { label: e.target.value })}
            placeholder="Label, e.g. At Application"
            className="input-field col-span-4 text-sm"
          />
          <input
            type="number"
            min="0"
            max="100"
            step="0.01"
            value={stage.percent}
            onChange={(e) => updateStage(i, { percent: e.target.value })}
            placeholder="%"
            className="input-field col-span-2 text-sm"
          />
          <div className="col-span-5">
            <SearchableSelect
              value={stage.trigger_stage}
              onChange={(value) => updateStage(i, { trigger_stage: value })}
              options={STAGE_OPTIONS}
              className="input-field w-full text-sm"
            />
          </div>
          <button
            type="button"
            onClick={() => removeStage(i)}
            className="col-span-1 text-midnight-900/30 hover:text-red-500 flex justify-center"
            title="Remove stage"
          >
            <Trash size={15} weight="regular" />
          </button>
        </div>
      ))}

      <button
        type="button"
        onClick={addStage}
        className="text-xs font-semibold text-gold-600 hover:underline inline-flex items-center gap-1"
      >
        <Plus size={13} weight="bold" /> Add Payment Stage
      </button>

      <div className={`text-xs font-semibold ${isValid ? "text-emerald-600" : "text-red-500"}`}>
        Total: {total}% {isValid ? "✓" : "— stages must sum to exactly 100%"}
      </div>
    </div>
  );
}
