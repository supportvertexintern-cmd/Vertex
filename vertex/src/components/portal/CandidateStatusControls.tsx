"use client";

import { useState } from "react";
import SearchableSelect from "@/components/SearchableSelect";
import { CaretRight, ArrowUUpLeft } from "@phosphor-icons/react";

const STATUS_ORDER = ["identified", "screened", "guided_to_apply", "submitted", "reported", "verified", "approved"] as const;
type Status = (typeof STATUS_ORDER)[number];

const STATUS_LABELS: Record<Status, string> = {
  identified: "Identified",
  screened: "Screened",
  guided_to_apply: "Guided to Apply",
  submitted: "Submitted",
  reported: "Reported",
  verified: "Verified",
  approved: "Case Created",
};

interface Props {
  candidateId: string;
  status: Status;
  /** Whether this viewer's role can act as a supervisor (verify/return) rather than just advance forward. */
  canVerify: boolean;
  /**
   * Whether this viewer can push a candidate all the way to "approved" —
   * In-House Supervisor/Director/admin only (Regional Supervisory
   * Operational Workflow p.5: "Approved by In-House" is a distinct,
   * higher-tier stage from Country Supervisor's "Verified" ceiling).
   * Ignored unless canVerify is also true.
   */
  canApprove?: boolean;
  onChanged: (next: { lifecycle_status: string; return_reason: string | null }) => void;
}

/**
 * Advance/verify/return controls for a candidate's pre-application
 * lifecycle (SRS FR-2.4, FR-2.7). The API is the real authorization
 * boundary — this only avoids showing obviously-wrong actions for the
 * viewer's portal context.
 */
export default function CandidateStatusControls({ candidateId, status, canVerify, canApprove = false, onChanged }: Props) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string[] | string | null>(null);
  const [showReturnForm, setShowReturnForm] = useState(false);
  const [returnTo, setReturnTo] = useState<Status>("identified");
  const [returnReason, setReturnReason] = useState("");

  const currentIdx = STATUS_ORDER.indexOf(status);
  const nextStatus = STATUS_ORDER[currentIdx + 1] as Status | undefined;
  // A Country Supervisor's reach stops at "Verified" — they can neither
  // advance a candidate into "approved" nor touch one that's already
  // there (no un-approving either); only In-House/admin can.
  const atOrPastApproval = status === "approved";
  const earlierStatuses = canVerify && !canApprove && atOrPastApproval ? [] : STATUS_ORDER.slice(0, currentIdx);
  const reportedIdx = STATUS_ORDER.indexOf("reported");
  // A recruiter's own actions stop at "reported" — the hand-off point to
  // their supervisor (SRS FR-2.1). A supervisor's forward action only
  // starts once a candidate has actually been reported. Showing a button
  // outside either range would look actionable but always be rejected
  // server-side (verified separately by canSetLifecycleStatus's tests).
  // "guided_to_apply" and "submitted" are both system-only now: the
  // former fires when the candidate claims their invite and creates an
  // account, the latter when their required documents are all uploaded —
  // neither is a manual recruiter action.
  const recruiterCanAdvance = !canVerify && currentIdx < reportedIdx && status !== "screened" && status !== "guided_to_apply";
  const supervisorCanAdvance =
    canVerify && currentIdx >= reportedIdx && !atOrPastApproval && (canApprove || nextStatus !== "approved");

  const submit = async (lifecycle_status: string, return_reason?: string) => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/candidates/${candidateId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lifecycle_status, ...(return_reason ? { return_reason } : {}) }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error?.details ?? body.error?.message ?? "Update failed.");
        return;
      }
      onChanged(body.data);
      setShowReturnForm(false);
      setReturnReason("");
    } catch {
      setError("Update failed.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2 flex-wrap">
        {nextStatus && recruiterCanAdvance && (
          <button
            type="button"
            disabled={saving}
            onClick={() => submit(nextStatus)}
            className="inline-flex items-center gap-1 text-xs font-semibold text-gold-600 hover:underline disabled:opacity-50"
          >
            Advance to {STATUS_LABELS[nextStatus]} <CaretRight size={12} weight="bold" />
          </button>
        )}

        {!canVerify && status === "screened" && (
          <span className="text-xs text-midnight-900/40 italic">Awaiting candidate to create an account</span>
        )}

        {!canVerify && status === "guided_to_apply" && (
          <span className="text-xs text-midnight-900/40 italic">Awaiting document upload</span>
        )}

        {!canVerify && !recruiterCanAdvance && status !== "screened" && status !== "guided_to_apply" && (
          <span className="text-xs text-midnight-900/40 italic">Awaiting supervisor action</span>
        )}

        {canVerify && nextStatus && supervisorCanAdvance && (
          <button
            type="button"
            disabled={saving}
            onClick={() => submit(nextStatus)}
            className="text-xs font-semibold text-emerald-600 hover:underline disabled:opacity-50"
          >
            {nextStatus === "approved" ? "Create Case" : "Verify"}
          </button>
        )}

        {canVerify && nextStatus && !supervisorCanAdvance && (
          <span className="text-xs text-midnight-900/40 italic">
            {!canApprove && (status === "verified" || atOrPastApproval)
              ? "Awaiting In-House approval"
              : "Awaiting recruiter to report"}
          </span>
        )}

        {canVerify && earlierStatuses.length > 0 && (
          <button
            type="button"
            onClick={() => setShowReturnForm((v) => !v)}
            className="inline-flex items-center gap-1 text-xs font-semibold text-red-500 hover:underline"
          >
            <ArrowUUpLeft size={12} weight="bold" /> Return
          </button>
        )}
      </div>

      {showReturnForm && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 mt-1 space-y-2 max-w-xs">
          <SearchableSelect
            value={returnTo}
            onChange={(value) => setReturnTo(value as Status)}
            className="text-xs"
            options={earlierStatuses.map((s) => ({ value: s, label: `Return to ${STATUS_LABELS[s]}` }))}
          />
          <textarea
            value={returnReason}
            onChange={(e) => setReturnReason(e.target.value)}
            placeholder="Reason for return (required)…"
            rows={2}
            className="input-field text-xs resize-none w-full"
          />
          <button
            type="button"
            disabled={saving || returnReason.trim().length < 5}
            onClick={() => submit(returnTo, returnReason)}
            className="btn-secondary py-1.5 px-3 text-xs disabled:opacity-50"
          >
            Confirm Return
          </button>
        </div>
      )}

      {error && (
        <div className="text-xs text-red-500 max-w-xs">
          {Array.isArray(error) ? (
            <ul className="list-disc list-inside">
              {error.map((e) => <li key={e}>{e}</li>)}
            </ul>
          ) : error}
        </div>
      )}
    </div>
  );
}
