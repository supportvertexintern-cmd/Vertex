"use client";

import { useState } from "react";
import DocumentLink from "@/components/DocumentLink";
import { UploadSimple } from "@phosphor-icons/react";

interface SupportingDocument {
  id: string;
  label: string | null;
  verification_status: string;
  uploaded_at: string;
}

interface Props {
  // Omit for a candidate uploading their own — /api/upload resolves the
  // candidate via the session itself in that case, and (correctly) 403s a
  // "candidate" role that tries to pass candidate_id explicitly, since
  // that param means "acting on someone else's behalf."
  candidateId?: string;
  documents: SupportingDocument[];
  onUploaded: () => void;
}

/**
 * Lets a partner/candidate/recruiter attach a supporting document that
 * isn't one of the fixed required types (2026-08-05) — always uploaded as
 * type "other" with a free-text label to say what it actually is, since
 * "Other Document" alone can't distinguish two of them. Unlike every other
 * document type, "other" doesn't supersede on re-upload (see upload.ts's
 * route), so multiple can accumulate here.
 */
export default function SupportingDocumentUpload({ candidateId, documents, onUploaded }: Props) {
  const [label, setLabel] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  const upload = async () => {
    if (!file || !label.trim()) return;
    setUploading(true);
    setError("");
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("label", label.trim());
      const url = candidateId ? `/api/upload?type=other&candidate_id=${candidateId}` : "/api/upload?type=other";
      const res = await fetch(url, { method: "POST", body: formData });
      const json = await res.json();
      if (!res.ok) { setError(json.error ?? "Upload failed."); return; }
      setLabel("");
      setFile(null);
      onUploaded();
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="pt-4 mt-4 border-t border-midnight-900/10">
      <div className="text-xs font-semibold text-midnight-900/70 uppercase tracking-wider mb-1">
        Other Supporting Documents
      </div>
      <p className="text-xs text-midnight-900/40 mb-3">
        Anything not covered by the required list above — a reference letter, extra certificate, etc. Give it a
        label so it&apos;s clear what it is.
      </p>

      {documents.length > 0 && (
        <div className="space-y-1.5 mb-3">
          {documents.map((d) => (
            <div key={d.id} className="flex items-center justify-between text-sm border-b border-midnight-900/5 pb-1.5">
              <DocumentLink documentId={d.id} label={d.label || "Untitled document"} className="text-gold-600 hover:underline" />
              <span className="text-xs text-midnight-900/45 capitalize">{d.verification_status}</span>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="What is this document? (e.g. Employer reference letter)"
          className="input-field text-sm flex-1 min-w-[240px]"
        />
        <label className="inline-flex items-center gap-1.5 text-xs font-semibold text-gold-600 hover:underline cursor-pointer">
          <UploadSimple size={12} weight="bold" />
          {file ? file.name : "Choose file"}
          <input
            type="file"
            accept="application/pdf,image/*"
            className="hidden"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </label>
        <button
          type="button"
          onClick={upload}
          disabled={uploading || !file || !label.trim()}
          className="btn-primary text-xs px-3 py-1.5 disabled:opacity-40"
        >
          {uploading ? "Uploading…" : "Add Document"}
        </button>
      </div>
      {error && <p className="text-xs text-red-500 mt-1.5">{error}</p>}
    </div>
  );
}
