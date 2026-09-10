import { WarningCircle } from "@phosphor-icons/react";

// Shared overdue/due-soon styling for a case's stage_deadline — used by
// every staff case-list table (Management, Operations, Finance) so the
// "Overdue"/"Due in Xd" thresholds stay identical everywhere.
export default function DeadlineCell({ deadline }: { deadline: string | null }) {
  if (!deadline) return <span className="text-midnight-900/30">—</span>;
  const days = Math.ceil((new Date(deadline).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  if (days < 0) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-semibold text-red-700">
        <WarningCircle size={13} weight="fill" /> Overdue {Math.abs(days)}d
      </span>
    );
  }
  if (days <= 7) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-700">
        <WarningCircle size={13} weight="fill" /> Due in {days}d
      </span>
    );
  }
  return <span className="text-xs text-midnight-900/50">{new Date(deadline).toLocaleDateString()}</span>;
}
