"use client";

import { useState } from "react";

// Shared Candidates/Partners CSV export card (CRM Comments item 12,
// superseded 2026-08-12 — CSV with a selectable date range instead of
// Google Sheets), reused across Admin Settings, Operations,
// Management/Director, and HR (2026-08-16) — same backing routes
// (GET /api/admin/backup/candidates-csv / partners-csv), each gated to
// admin + operations_team + operations_director + director + hr.
export default function BackupExport() {
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");

  const download = (entity: "candidates" | "partners") => {
    const params = new URLSearchParams();
    if (start) params.set("start", start);
    if (end) params.set("end", end);
    const qs = params.toString();
    window.location.href = `/api/admin/backup/${entity}-csv${qs ? `?${qs}` : ""}`;
  };

  return (
    <div className="card p-6">
      <h2 className="font-semibold text-midnight-900 mb-2">Data Backup</h2>
      <p className="text-sm text-midnight-900/50 mb-4">
        Download a full CSV copy of Partners and/or Candidates, as a standing backup outside the CRM database.
        Optionally limit it to a date range (based on when each record was created) — leave both blank for
        everything.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4 max-w-md">
        <div>
          <label className="block text-xs font-medium text-midnight-900/60 mb-1">From</label>
          <input type="date" value={start} onChange={(e) => setStart(e.target.value)} className="input-field" />
        </div>
        <div>
          <label className="block text-xs font-medium text-midnight-900/60 mb-1">To</label>
          <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} className="input-field" />
        </div>
      </div>
      <div className="flex items-center gap-3">
        <button onClick={() => download("candidates")} className="btn-primary py-2.5 px-6 text-xs">
          Export Candidates CSV
        </button>
        <button onClick={() => download("partners")} className="btn-primary py-2.5 px-6 text-xs">
          Export Partners CSV
        </button>
      </div>
    </div>
  );
}
