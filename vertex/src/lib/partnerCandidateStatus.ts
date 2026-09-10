// Display labels for PartnerCandidateStatus. "job_assigned" is the actual
// enum value (kept as-is to avoid a schema migration) but reads as if a
// job posting was matched — what HR/Operations actually did at that status
// is create the Case, so every status badge/filter shows "Case Created"
// instead of the raw enum text.
export const PARTNER_CANDIDATE_STATUS_LABELS: Record<string, string> = {
  submitted: "Submitted",
  under_review: "Under Review",
  job_assigned: "Case Created",
  rejected: "Rejected",
};

export function formatPartnerCandidateStatus(status: string): string {
  return PARTNER_CANDIDATE_STATUS_LABELS[status] ?? status.replace(/_/g, " ");
}
