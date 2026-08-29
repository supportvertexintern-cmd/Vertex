// Document requirement types are admin-managed (DocumentRequirementType,
// fetched via /api/apply/options or /api/admin/document-types) rather than
// a fixed enum — this file only holds the small, structurally-fixed
// exclusion sets that don't belong on the admin-editable list.

// One DocumentRequirementType key per milestone stage (2026-08-19) —
// previously a single shared "payment_receipt" key for all three, which
// broke badly: POST /api/upload supersedes (deletes) the existing
// Document row of the same type for a candidate on re-upload, and
// CasePayment.receipt_document_id is onDelete: SetNull, so uploading a
// Visa receipt silently deleted the Documentation/Permit receipts and
// nulled out their CasePayment references — by the time all 3 milestones
// were paid, only the most recently uploaded receipt was still
// reachable. "payment_receipt" (no suffix) is kept only for backward
// compatibility with already-collected payments created before this
// split; nothing uploads against it going forward.
// payment_receipt_upfront (2026-08-29) added for the Credit Service
// Programme's single upfront payment (see MilestonePaymentType.upfront) —
// same one-key-per-stage rationale as the 3 above.
export const PAYMENT_RECEIPT_TYPE_KEYS = [
  "payment_receipt",
  "payment_receipt_documentation",
  "payment_receipt_permit",
  "payment_receipt_visa",
  "payment_receipt_upfront",
] as const;

export function paymentReceiptTypeKey(milestoneType: "documentation" | "permit" | "visa" | "upfront"): string {
  return `payment_receipt_${milestoneType}`;
}

// Types outside the CIF/Agency self-report + per-country-requirement
// concept entirely: cv is handled by its own dedicated screening-gate
// upload button (never a checklist item), and the rest predate the
// programme-requirement model (Phase 4's broader case-document set,
// plus "other" which has no reachable UI path anywhere). issued_work_permit/
// issued_visa (2026-07-31) are Operations delivering a government-issued
// document back onto the case, never something a candidate/partner
// self-reports having in advance. The payment-receipt keys (2026-07-31,
// split 2026-08-19) are the same shape: staff-uploaded only, never a
// candidate/partner self-report item. Never shown in the CIF/Agency
// checklist or admin's per-country requirement toggle, regardless of
// what admin adds there.
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
  ...PAYMENT_RECEIPT_TYPE_KEYS,
] as const;

// CaseDetail's staff upload picker excludes cv/passport (already uploaded
// via the candidate's own dedicated screening-gate buttons) and every
// payment-receipt key — those are only ever attached through the
// Milestone Payments card's own controls, which correctly tie the
// upload to one specific CasePayment, never this generic picker.
export const CASE_UPLOAD_EXCLUDED_KEYS = ["cv", "passport", "other", ...PAYMENT_RECEIPT_TYPE_KEYS] as const;

export function documentTypeLabel(type: string): string {
  return type.replace(/_/g, " ");
}
