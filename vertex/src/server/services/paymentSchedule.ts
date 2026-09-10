import type { MilestonePaymentType } from "@prisma/client";
import { CASE_STAGE_ORDER, type CaseStageKey } from "@/components/portal/caseStages";

// When each milestone becomes payable (SOP-confirmed 2026-07-31: "the
// first [payment] is due once the case is created" — every Case starts at
// registration_document_submission, so "due on creation" and "due from
// this stage onward" are the same rule, no separate case-creation hook
// needed). permit/visa become due once the case reaches the stage where
// that stage of work is actually delivered.
export const MILESTONE_TRIGGER_STAGE: Record<MilestonePaymentType, CaseStageKey> = {
  documentation: "registration_document_submission",
  permit: "permit_authorization_approved",
  visa: "visa_interview_decision",
};

export function isMilestoneDue(type: MilestonePaymentType, currentStage: CaseStageKey): boolean {
  return CASE_STAGE_ORDER.indexOf(currentStage) >= CASE_STAGE_ORDER.indexOf(MILESTONE_TRIGGER_STAGE[type]);
}
