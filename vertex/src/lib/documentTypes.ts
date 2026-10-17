// Document requirement types are admin-managed (DocumentRequirementType,
// fetched via /api/apply/options or /api/admin/document-types) rather than
// a fixed enum — this file only holds the small, structurally-fixed
// exclusion sets that don't belong on the admin-editable list.

// One DocumentRequirementType key per JobPaymentStage (2026-09-16,
// flexible per-Job payment stages — replaces the old fixed 5-key set of
// payment_receipt_documentation/permit/visa/upfront + generic
// payment_receipt, since a Job can now have any number of stages, not a
// fixed 3-or-4-shape set). Keying by the stage's own id (not a shared
// type) is what actually matters here: POST /api/upload supersedes
// (deletes) the existing Document row of the same type for a candidate on
// re-upload, and CasePayment.receipt_document_id is onDelete: SetNull, so
// two still-pending payments for the SAME candidate sharing one upload
// type would silently delete each other's receipt and null out the
// CasePayment reference — this is what the original 2026-08-19 split
// fixed for the old fixed set, generalized here to any stage count. The
// matching DocumentRequirementType row is upserted server-side whenever a
// JobPaymentStage is created (see POST/PUT /api/jobs). "payment_receipt"
// (no suffix) is kept recognized for backward compatibility with
// payments recorded before this change.
//
// The old fixed keys (payment_receipt_documentation, payment_receipt_permit,
// payment_receipt_visa, payment_receipt_upfront) may still exist in older
// databases (e.g. Production) and must be excluded from the checklist and
// staff upload picker just like the new per‑stage keys.
export const PAYMENT_RECEIPT_TYPE_PREFIX = "payment_receipt_stage_";

export const LEGACY_PAYMENT_RECEIPT_KEYS = [
  "payment_receipt_documentation",
  "payment_receipt_permit",
  "payment_receipt_visa",
  "payment_receipt_upfront",
] as const;

export function paymentReceiptTypeKey(jobPaymentStageId: string): string {
  return `${PAYMENT_RECEIPT_TYPE_PREFIX}${jobPaymentStageId}`;
}

export function isPaymentReceiptTypeKey(key: string): boolean {
  return (
    key === "payment_receipt" ||
    key.startsWith(PAYMENT_RECEIPT_TYPE_PREFIX) ||
    (LEGACY_PAYMENT_RECEIPT_KEYS as readonly string[]).includes(key)
  );
}

// Types outside the CIF/Agency self-report + per-country-requirement
// concept entirely: cv is handled by its own dedicated screening-gate
// upload button (never a checklist item), and the rest predate the
// programme-requirement model (Phase 4's broader case-document set,
// plus "other" which has no reachable UI path anywhere). issued_work_permit/
// issued_visa (2026-07-31) are Operations delivering a government-issued
// document back onto the case, never something a candidate/partner
// self-reports having in advance. The payment-receipt keys (2026-07-31,
// split 2026-08-19, generalized 2026-09-16, legacy keys added 2026-09-21)
// are the same shape: staff-uploaded only, never a candidate/partner
// self-report item. Never shown in the CIF/Agency checklist or admin's
// per-country requirement toggle, regardless of what admin adds there.
export const NON_PROGRAMME_TYPE_KEYS = [
  "cv",
  "transcript",
  "certificate",
  "medical",
  "contract",
  "visa",
  "other",
  "issued_work_permit",
  "issued_visa",
] as const;

export function isNonProgrammeTypeKey(key: string): boolean {
  return (
    (NON_PROGRAMME_TYPE_KEYS as readonly string[]).includes(key) ||
    isPaymentReceiptTypeKey(key)
  );
}

// CaseDetail's staff upload picker excludes cv/passport (already uploaded
// via the candidate's own dedicated screening-gate buttons) and every
// payment-receipt key — those are only ever attached through the
// Milestone Payments card's own controls, which correctly tie the
// upload to one specific CasePayment, never this generic picker.
export function isCaseUploadExcludedKey(key: string): boolean {
  return (
    key === "cv" ||
    key === "passport" ||
    key === "other" ||
    isPaymentReceiptTypeKey(key)
  );
}

export function documentTypeLabel(type: string): string {
  return type.replace(/_/g, " ");
}