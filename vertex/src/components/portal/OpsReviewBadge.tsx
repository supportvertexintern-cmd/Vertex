// Small status badge for a Case's ops_review_status (CRM Comments item 6,
// 2026-08-10) — surfaced in every case-list table, not just CaseDetail's
// own confirm/reject card, so a rejection is visible without opening the
// case. "pending" renders as a plain span (not a full badge) to keep it
// visually quiet — every new case starts there, so a loud badge on every
// single row would be noise; only Confirmed/Rejected earn a colored pill.
export default function OpsReviewBadge({ status }: { status: "pending" | "confirmed" | "rejected" }) {
  if (status === "pending") {
    return <span className="text-xs text-midnight-900/35">Pending review</span>;
  }
  if (status === "rejected") {
    return (
      <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-red-100 text-red-700">
        Documentation Rejected
      </span>
    );
  }
  return (
    <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800">
      Confirmed
    </span>
  );
}
