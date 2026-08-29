import { CASE_STAGE_ORDER, type CaseStageKey } from "@/components/portal/caseStages";

// This stage-triggered due-date model only applies to the standard
// 3-stage milestone split — the Credit Service Programme's upfront
// payment (2026-08-29) is due at engagement, not stage-gated the same
// way, and its case-level worklist support isn't built yet (see
// /api/finance/payments-due, which skips is_credit_service Jobs
// entirely). Narrowed to the 3-stage type rather than the full
// MilestonePaymentType enum for exactly that reason.
type StageTriggeredMilestoneType = "documentation" | "permit" | "visa";

// When each milestone becomes payable (SOP-confirmed 2026-07-31: "the
// first [payment] is due once the case is created" — every Case starts at
// registration_document_submission, so "due on creation" and "due from
// this stage onward" are the same rule, no separate case-creation hook
// needed). permit/visa become due once the case reaches the stage where
// that stage of work is actually delivered.
export const MILESTONE_TRIGGER_STAGE: Record<StageTriggeredMilestoneType, CaseStageKey> = {
  documentation: "registration_document_submission",
  permit: "permit_authorization_approved",
  visa: "visa_interview_decision",
};

export function isMilestoneDue(type: StageTriggeredMilestoneType, currentStage: CaseStageKey): boolean {
  return CASE_STAGE_ORDER.indexOf(currentStage) >= CASE_STAGE_ORDER.indexOf(MILESTONE_TRIGGER_STAGE[type]);
}
