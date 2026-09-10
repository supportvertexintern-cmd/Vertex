"use client";

import { useState } from "react";
import { CheckCircle, XCircle, Clock } from "@phosphor-icons/react";

const STATUS_STYLES: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-800",
  verified: "bg-emerald-100 text-emerald-800",
  rejected: "bg-red-100 text-red-800",
};

/**
 * Verify/reject a candidate document (SRS FR-2.7). Only rendered on
 * admin-only views today — the API independently enforces which roles may
 * verify (country_supervisor/inhouse_supervisor/director/admin), so this
 * is a convenience UI, not the authorization boundary.
 */
export default function DocumentVerifyControls({
  documentId,
  initialStatus,
}: {
  documentId: string;
  initialStatus: string;
}) {
  const [status, setStatus] = useState(initialStatus);
  const [saving, setSaving] = useState(false);

  const setVerification = async (verification_status: "verified" | "rejected") => {
    setSaving(true);
    try {
      const res = await fetch(`/api/documents/${documentId}/verify`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ verification_status }),
      });
      if (!res.ok) throw new Error("Failed to update verification status.");
      setStatus(verification_status);
    } catch {
      alert("Couldn't update verification status.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide ${STATUS_STYLES[status]}`}>
        {status === "pending" && <Clock size={10} weight="bold" />}
        {status === "verified" && <CheckCircle size={10} weight="bold" />}
        {status === "rejected" && <XCircle size={10} weight="bold" />}
        {status}
      </span>
      {status !== "verified" && (
        <button
          type="button"
          disabled={saving}
          onClick={() => setVerification("verified")}
          className="text-[10px] font-semibold text-emerald-600 hover:underline disabled:opacity-50"
        >
          Verify
        </button>
      )}
      {status !== "rejected" && (
        <button
          type="button"
          disabled={saving}
          onClick={() => setVerification("rejected")}
          className="text-[10px] font-semibold text-red-500 hover:underline disabled:opacity-50"
        >
          Reject
        </button>
      )}
    </div>
  );
}
