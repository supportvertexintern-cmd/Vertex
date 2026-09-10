"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CaretRight } from "@phosphor-icons/react";

interface Props {
  candidateId: string;
  status: string;
  screeningFailures?: string[];
  onChanged: (next: { lifecycle_status: string; return_reason: string | null }) => void;
}

/**
 * HR's own status widget for a self-submitted candidate (2026-07-31,
 * HR-owned self-submission routing) — a purpose-built sibling to
 * CandidateStatusControls, not a retrofit of it: HR's real actions skip
 * straight from identified to screened, and later from submitted straight
 * to approved (bypassing reported/verified entirely, since there's no
 * recruiter/supervisor in this pipeline at all), which
 * CandidateStatusControls' sequential-only "next status in STATUS_ORDER"
 * model can't express. Posts to the same /api/candidates/:id/status
 * endpoint canSetLifecycleStatus's own hr branch already gates correctly.
 *
 * Screening→invite now fires automatically the moment a self-registered
 * candidate submits the CIF (2026-08-06) — "identified" only reaches this
 * component's Retry Screening path when that automatic pass failed
 * (screeningFailures non-empty). Reject and Request Revision were added
 * the same day, per the business's review of this dashboard: a real
 * terminal rejection (mirrors PartnerSubmissionDetail's own Reject), and a
 * softer return-to-guided_to_apply that reuses the same return_reason
 * mechanism recruiters/supervisors already have for their own leads.
 */
export default function HrCandidateStatusControls({ candidateId, status, screeningFailures, onChanged }: Props) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string[] | string | null>(null);
  const [caseId, setCaseId] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [returning, setReturning] = useState(false);
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (status !== "approved") return;
    fetch(`/api/cases?candidate_id=${candidateId}`)
      .then((r) => r.json())
      .then((res) => setCaseId(res.data?.[0]?.id ?? null))
      .catch(() => {});
  }, [status, candidateId]);

  const submit = async (lifecycle_status: string, return_reason?: string) => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/candidates/${candidateId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lifecycle_status, return_reason }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error?.details ?? body.error?.message ?? "Update failed.");
        return;
      }
      setRejecting(false);
      setReturning(false);
      setReason("");
      onChanged(body.data);
    } catch {
      setError("Update failed.");
    } finally {
      setSaving(false);
    }
  };

  const reasonPrompt = (placeholder: string, onConfirm: () => void, onCancel: () => void, confirmLabel: string) => (
    <div className="w-full max-w-xs space-y-1.5">
      <textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        rows={2}
        className="input-field text-xs w-full resize-none"
        placeholder={placeholder}
      />
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={saving || !reason.trim()}
          onClick={onConfirm}
          className="text-xs font-semibold text-red-600 hover:underline disabled:opacity-50"
        >
          {saving ? "Sending…" : confirmLabel}
        </button>
        <button type="button" onClick={onCancel} className="text-xs text-midnight-900/40 hover:underline">
          Cancel
        </button>
      </div>
    </div>
  );

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-3 flex-wrap">
        {status === "identified" && !rejecting && (
          screeningFailures && screeningFailures.length > 0 ? (
            <div className="space-y-1.5">
              <div className="text-xs text-red-600">
                Screening did not clear automatically:
                <ul className="list-disc list-inside mt-0.5">
                  {screeningFailures.map((f) => <li key={f}>{f}</li>)}
                </ul>
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => submit("screened")}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-gold-600 hover:underline disabled:opacity-50"
                >
                  Retry Screening <CaretRight size={12} weight="bold" />
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => setRejecting(true)}
                  className="text-xs font-semibold text-red-600 hover:underline disabled:opacity-50"
                >
                  Reject
                </button>
              </div>
            </div>
          ) : (
            <span className="text-xs text-midnight-900/40 italic">Screening in progress…</span>
          )
        )}

        {status === "identified" && rejecting &&
          reasonPrompt(
            "Why is this application being rejected?",
            () => submit("rejected", reason),
            () => { setRejecting(false); setReason(""); },
            "Confirm Reject"
          )}

        {status === "screened" && (
          <span className="text-xs text-midnight-900/40 italic">Awaiting candidate to create an account</span>
        )}

        {status === "guided_to_apply" && (
          <span className="text-xs text-midnight-900/40 italic">Awaiting document upload</span>
        )}

        {status === "submitted" && !rejecting && !returning && (
          <div className="flex items-center gap-3">
            <button
              type="button"
              disabled={saving}
              onClick={() => submit("approved")}
              className="text-xs font-semibold text-emerald-600 hover:underline disabled:opacity-50"
            >
              Create Case
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => setReturning(true)}
              className="text-xs font-semibold text-gold-600 hover:underline disabled:opacity-50"
            >
              Request Revision
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => setRejecting(true)}
              className="text-xs font-semibold text-red-600 hover:underline disabled:opacity-50"
            >
              Reject
            </button>
          </div>
        )}

        {status === "submitted" && rejecting &&
          reasonPrompt(
            "Why is this application being rejected?",
            () => submit("rejected", reason),
            () => { setRejecting(false); setReason(""); },
            "Confirm Reject"
          )}

        {status === "submitted" && returning &&
          reasonPrompt(
            "What needs to be fixed or re-uploaded?",
            () => submit("guided_to_apply", reason),
            () => { setReturning(false); setReason(""); },
            "Confirm Return"
          )}

        {status === "approved" && (
          <span className="text-xs text-emerald-700 font-semibold inline-flex items-center gap-2">
            Case Created
            {caseId && (
              <Link href={`/hr/cases/${caseId}`} className="text-gold-600 hover:underline font-normal">
                View Case
              </Link>
            )}
          </span>
        )}

        {status === "rejected" && <span className="text-xs text-red-700 font-semibold">Rejected</span>}
      </div>

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
