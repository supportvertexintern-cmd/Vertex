"use client";

import { useRef, useState } from "react";
import { UploadSimple } from "@phosphor-icons/react";

interface Props {
  candidateId: string;
  type: string;
  label?: string;
  onUploaded: () => void;
}

/** Lets a recruiter/supervisor upload a document for a lead who has no account of their own yet (SRS FR-2.1, FR-2.5). */
export default function CandidateDocumentUpload({ candidateId, type, label, onUploaded }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  const handleFile = async (file: File) => {
    setUploading(true);
    setError("");
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch(`/api/upload?type=${type}&candidate_id=${candidateId}`, {
        method: "POST",
        body: formData,
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? "Upload failed.");
        return;
      }
      onUploaded();
    } catch {
      setError("Upload failed.");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        data-testid={`upload-${type}-input`}
        accept="application/pdf,image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
        }}
      />
      <button
        type="button"
        disabled={uploading}
        onClick={() => inputRef.current?.click()}
        className="inline-flex items-center gap-1 text-xs text-gold-600 hover:underline disabled:opacity-50"
      >
        <UploadSimple size={12} weight="bold" /> {uploading ? "Uploading…" : label ?? `Upload ${type.replace(/_/g, " ")}`}
      </button>
      {error && <div className="text-[10px] text-red-500 mt-0.5">{error}</div>}
    </div>
  );
}
