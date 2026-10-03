import { computePaymentStageAmounts, computePaymentPlanBalance } from "@/lib/fees";
import { CASE_STAGE_LABELS, type CaseStageKey } from "@/components/portal/caseStages";

export interface PaymentStageOption {
  id: string;
  order: number;
  label: string;
  percent: number;
  trigger_stage: string;
}

export interface ResolvedPaymentStage {
  id: string;
  label: string;
  percent: number;
  amount: number;
  triggerStageLabel: string;
}

// Shared amount/trigger-label resolution behind every payment-plan display
// across the app (2026-09-16, flexible per-Job payment stages) — a Job's
// `payment_stages` (any number, any shape) plus its `service_fee_gbp` is
// all any consumer needs; nothing hardcodes a 2/3-way split or an
// upfront+installments shape anymore. Stages with a computed amount of 0
// (e.g. a placeholder row) are dropped — nothing to show for them.
export function resolvePaymentStages(totalGbp: number, stages: PaymentStageOption[]): ResolvedPaymentStage[] {
  const ordered = [...stages].sort((a, b) => a.order - b.order);
  const amounts = computePaymentStageAmounts(totalGbp, ordered.map((s) => s.percent));
  return ordered
    .map((s, i) => ({
      id: s.id,
      label: s.label,
      percent: s.percent,
      amount: amounts[i],
      triggerStageLabel: CASE_STAGE_LABELS[s.trigger_stage as CaseStageKey] ?? s.trigger_stage,
    }))
    .filter((s) => s.amount > 0);
}

// Single-line text summary — for a context that needs plain text/a Field
// value rather than its own layout (e.g. PartnerSubmissionDetail's
// "Opportunity" summary grid). A financed plan's uncovered balance is
// stated explicitly so the sub-100% sum never reads as a discounted fee.
export function summarizePaymentStages(totalGbp: number, stages: PaymentStageOption[]): string {
  const resolved = resolvePaymentStages(totalGbp, stages);
  const parts = resolved.map((s) => `${s.label} £${s.amount.toLocaleString()}`);
  const balance = computePaymentPlanBalance(totalGbp, stages.map((s) => s.percent));
  const balancePart = balance.hasBalance
    ? ` · financed balance £${balance.balanceAmount.toLocaleString()} paid separately`
    : "";
  return `£${totalGbp.toLocaleString()} total · ${parts.join(" · ")}${balancePart}`;
}

interface PaymentStagesPreviewProps {
  totalGbp: number;
  stages: PaymentStageOption[];
  /**
   * "grid" — light card-grid, used inline in a form (ApplicationForm,
   * PartnerCandidateForm) alongside the Payment Plan Acknowledgement.
   * "dark" — dark sidebar card rows, used on the public /jobs/[id] page.
   */
  variant?: "grid" | "dark";
  className?: string;
}

// One shared rendering of a Job's payment plan, replacing the previous
// per-form hardcoded 2/3-shape branching (documentation/permit/visa,
// two_stage_pricing's 50/50, is_credit_service's upfront+installments) —
// every Job's plan, whatever shape it was configured with, renders the
// same way everywhere now.
export default function PaymentStagesPreview({ totalGbp, stages, variant = "grid", className }: PaymentStagesPreviewProps) {
  const resolved = resolvePaymentStages(totalGbp, stages);
  if (resolved.length === 0) return null;

  // A plan whose stages cover less than the full fee — the uncovered
  // balance is still owed (paid separately, e.g. financed) and must be
  // stated wherever the stages are shown (2026-10-04).
  const balance = computePaymentPlanBalance(totalGbp, stages.map((s) => s.percent));

  if (variant === "dark") {
    return (
      <div className={`space-y-2.5 ${className ?? ""}`}>
        {resolved.map((s) => (
          <div key={s.id} className="flex items-center justify-between gap-3 bg-white/5 rounded-lg px-3.5 py-2.5">
            <div>
              <div className="text-xs font-semibold text-gold-300">
                {s.label} · {Math.round(s.percent)}%
              </div>
              <div className="text-ivory-50/45 text-xs mt-0.5">Due from: {s.triggerStageLabel}</div>
            </div>
            <div className="font-semibold text-ivory-50 whitespace-nowrap">{s.amount.toLocaleString()} GBP</div>
          </div>
        ))}
        {balance.hasBalance && (
          <div className="flex items-center justify-between gap-3 bg-gold-500/10 border border-gold-500/30 rounded-lg px-3.5 py-2.5">
            <div>
              <div className="text-xs font-semibold text-gold-300">Financed balance · {balance.balancePercent}%</div>
              <div className="text-ivory-50/45 text-xs mt-0.5">
                Not collected through the platform — payable separately as agreed (full service fee still applies)
              </div>
            </div>
            <div className="font-semibold text-ivory-50 whitespace-nowrap">{balance.balanceAmount.toLocaleString()} GBP</div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={className ?? ""}>
      <div
        className="grid gap-2 text-center text-xs"
        style={{ gridTemplateColumns: `repeat(${Math.min(resolved.length, 4)}, minmax(0, 1fr))` }}
      >
        {resolved.map((s) => (
          <div key={s.id} className="bg-slate-50 border border-slate-200 rounded-lg p-3">
            <div className="font-bold text-emerald-700 mb-1">
              {s.label} · {Math.round(s.percent)}% (£{s.amount.toLocaleString()})
            </div>
            <div className="text-slate-500">Due from: {s.triggerStageLabel}</div>
          </div>
        ))}
      </div>
      {balance.hasBalance && (
        <div className="mt-3 bg-amber-50 border border-amber-300 rounded-lg px-4 py-3 text-xs text-amber-900 leading-relaxed">
          <span className="font-bold">
            Financed balance: £{balance.balanceAmount.toLocaleString()} ({balance.balancePercent}% of the fee)
          </span>{" "}
          — not collected through the platform. The full service fee still applies; this balance is payable separately
          as agreed in the service agreement.
        </div>
      )}
    </div>
  );
}
