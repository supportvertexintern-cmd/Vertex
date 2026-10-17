import { CASE_STAGE_ORDER, type CaseStageKey } from "@/components/portal/caseStages";

// A stage becomes payable once the Case reaches (or has passed) its own
// trigger_stage — generalized (2026-09-16) from the old hardcoded 3-value
// MILESTONE_TRIGGER_STAGE map to work for any of a Job's payment_stages,
// of any shape. "Due once the Case is created" (the old documentation
// milestone's behavior) is just trigger_stage === the first CaseStage
// value, registration_document_submission — every Case starts there, so
// "due on creation" and "due from this stage onward" are still the same
// rule, no separate case-creation hook needed.
export function isMilestoneDue(triggerStage: CaseStageKey, currentStage: CaseStageKey): boolean {
  return CASE_STAGE_ORDER.indexOf(currentStage) >= CASE_STAGE_ORDER.indexOf(triggerStage);
}
