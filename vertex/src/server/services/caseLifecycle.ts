import type { Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { auditedPrisma } from "@/lib/audit";
import { OPERATIONS_ROLES } from "@/lib/rbac";

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

export interface CaseTransitionCheck {
  allowed: boolean;
  reason?: string;
  isReturn: boolean;
}

/**
 * Role-gated case-stage transition rules (SRS FR-4.2). Case-stage ownership
 * belongs to Operations (SOP-driven separation of duties, 2026-07-31) —
 * recruiter and both supervisor tiers keep read-only visibility only
 * (rbac.ts's OPERATIONS_ROLES gates the route this is called from);
 * Director/Admin retain the same override access they've always had.
 */
export function canSetCaseStage(role: Role, from: CaseStage, to: CaseStage): CaseTransitionCheck {
  const fromIdx = CASE_STAGE_ORDER.indexOf(from);
  const toIdx = CASE_STAGE_ORDER.indexOf(to);
  const isReturn = toIdx < fromIdx;

  if (toIdx === fromIdx) {
    return { allowed: false, reason: "Case is already at that stage.", isReturn: false };
  }

  if (OPERATIONS_ROLES.includes(role)) {
    return { allowed: true, isReturn };
  }

  return { allowed: false, reason: "This role cannot update case status.", isReturn };
}

/**
 * SRS FR-4.1/4.2: a Case is the start of the mobility lifecycle — it only
 * makes sense once an application has actually been approved, and there's
 * exactly one Case per Application. Idempotent: calling this again for an
 * application that already has a case is a no-op, returning the existing
 * one, so callers don't need to check first.
 */
export async function createCaseForApprovedApplication(applicationId: string, actorId: string) {
  const existing = await prisma.case.findUnique({ where: { application_id: applicationId } });
  if (existing) return existing;

  const db = auditedPrisma(actorId);
  const newCase = await db.case.create({ data: { application_id: applicationId } });
  await db.caseStageEvent.create({ data: { case_id: newCase.id, stage: "registration_document_submission" } });
  return newCase;
}
