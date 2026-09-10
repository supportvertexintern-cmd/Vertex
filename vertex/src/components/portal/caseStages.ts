export const CASE_STAGE_ORDER = [
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
] as const;

export type CaseStageKey = (typeof CASE_STAGE_ORDER)[number];

export const CASE_STAGE_LABELS: Record<CaseStageKey, string> = {
  registration_document_submission: "Candidate Registration & Document Submission",
  document_preparation_legalization: "Document Preparation, Translation & Legalization",
  permit_application_submission: "Work Permit Application Submission",
  permit_processing_followup: "Work Permit Processing & Government Follow-up",
  permit_authorization_approved: "Work Permit & Work Authorization Approval",
  original_documents_dispatch: "Dispatch of Original Documents",
  partner_receives_permit: "Partner Receives Work Permit",
  visa_interview_preparation: "Embassy Appointment & Visa Interview Preparation",
  visa_interview_decision: "Embassy Interview & Visa Decision",
  pre_departure_arrangements: "Pre-Departure & Flight Arrangements",
  departure_arrival_support: "Departure & Arrival Support",
};
