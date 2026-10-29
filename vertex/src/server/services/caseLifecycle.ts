export type CaseStage =
  | "registration_document_submission"
  | "document_preparation_legalization"
  | "permit_application_submission"
  | "permit_processing_followup"
  | "permit_authorization_approved"
  | "original_documents_dispatch"
  | "partner_receives_permit"
  | "visa_interview_preparation"
  | "visa_interview_decision"
  | "pre_departure_arrangements"
  | "departure_arrival_support";

// The SOP's (Operational-Workflow-International-Recruitment.docx §3) own
// 11-stage journey, replacing the old 2-payment-stage model (2026-07-31).
export const CASE_STAGE_ORDER: CaseStage[] = [
  "registration_document_submission",
  "document_preparation_legalization",
  "permit_application_submission",
  "permit_processing_followup",
  "permit_authorization_approved",
  "original_documents_dispatch",
  "partner_receives_permit",
  "visa_interview_preparation",
  "visa_interview_decision",
  "pre_departure_arrangements",
  "departure_arrival_support",
];

// Opening a case and moving it between stages are FastAPI's since the
// pipeline switch (step 6.7; vertex_be/app/services/case_lifecycle.py,
// whose stage order its tests compare with this one).
