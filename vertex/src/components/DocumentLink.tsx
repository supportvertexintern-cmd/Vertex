"use client";

import { useState } from "react";

/**
 * Renders a document (CV, passport, etc.) as a click-to-reveal link. Fetches
 * a short-lived signed URL on demand rather than embedding one in the page
 * up front (SRS FR-1.6) — the underlying file is never publicly reachable.
 */
export default function DocumentLink({
  documentId,
  label,
  className,
}: {
  documentId: string;
  label: string;
  className?: string;
}) {
  const [loading, setLoading] = useState(false);

  const handleClick = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/documents/${documentId}/signed-url`);
      if (!res.ok) throw new Error("Failed to get document link");
      const { url } = await res.json();
      window.open(url, "_blank", "noopener,noreferrer");
    } catch {
      alert("Couldn't open this document. It may have been removed.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <button type="button" onClick={handleClick} disabled={loading} className={className}>
      {loading ? "Opening…" : label}
    </button>
  );
}
