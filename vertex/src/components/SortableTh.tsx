"use client";

import { CaretUp, CaretDown } from "@phosphor-icons/react";

// Shared sortable column header (CRM Comments item 8, 2026-08-10) — used
// across the primary review-queue list pages. The caller owns sort state
// (sortBy/sortDir) and passes its own onSort; this is purely presentational
// plus the click-to-toggle interaction.
export default function SortableTh({
  label,
  sortKey,
  activeSort,
  activeDir,
  onSort,
  className = "",
}: {
  label: string;
  sortKey: string;
  activeSort: string;
  activeDir: "asc" | "desc";
  onSort: (key: string) => void;
  className?: string;
}) {
  const active = activeSort === sortKey;
  return (
    <th className={`px-5 py-3 font-semibold ${className}`}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={`inline-flex items-center gap-1 hover:text-midnight-900/70 ${active ? "text-midnight-900/70" : ""}`}
      >
        {label}
        <span className="flex flex-col -space-y-1">
          <CaretUp size={9} weight="bold" className={active && activeDir === "asc" ? "text-gold-600" : "text-midnight-900/20"} />
          <CaretDown size={9} weight="bold" className={active && activeDir === "desc" ? "text-gold-600" : "text-midnight-900/20"} />
        </span>
      </button>
    </th>
  );
}
