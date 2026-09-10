// Display labels for CandidateLifecycleStatus (CRM Comments follow-up,
// 2026-08-10) — mirrors partnerCandidateStatus.ts's own pattern for the
// exact same reason: "approved" is the real enum value (kept as-is, no
// schema migration), but what actually happens at that point is a Case
// gets created, so every status badge/list shows "Case Created" instead
// of the raw enum text — matching the partner pipeline's "job_assigned" →
// "Case Created" label exactly, for one consistent vocabulary regardless
// of which pipeline a candidate came through.
export const CANDIDATE_LIFECYCLE_STATUS_LABELS: Record<string, string> = {
  identified: "Identified",
  screened: "Screened",
  guided_to_apply: "Guided to Apply",
  submitted: "Submitted",
  reported: "Reported",
  verified: "Verified",
  approved: "Case Created",
  rejected: "Rejected",
};

export function formatCandidateLifecycleStatus(status: string): string {
  return CANDIDATE_LIFECYCLE_STATUS_LABELS[status] ?? status.replace(/_/g, " ");
}
