"use client";

import { MagnifyingGlass } from "@phosphor-icons/react";

interface Props {
  searchValue: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder?: string;
  children?: React.ReactNode;
}

// Shared search + filter bar (2026-08-19) — replaces the old
// `flex flex-col sm:flex-row` single-row layout, which put the search
// input in a `flex-1` slot competing for space against however many
// SearchableSelect filters a page had. Once a page grew past 2-3 filters
// (Partner, Application Type, Stage, Status...), the search box was
// squeezed down to almost nothing on anything but the widest screens —
// reported as "the search bar is invisible." Search now always gets its
// own full-width row; filters sit together in their own wrapping row
// below, so neither competes with the other for space.
export default function FilterBar({ searchValue, onSearchChange, searchPlaceholder = "Search…", children }: Props) {
  return (
    <div className="mb-6 space-y-3">
      <div className="relative">
        <MagnifyingGlass size={16} weight="regular" className="absolute left-4 top-1/2 -translate-y-1/2 text-midnight-900/30" />
        <input
          value={searchValue}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={searchPlaceholder}
          className="input-field pl-11 w-full"
        />
      </div>
      {children && <div className="flex flex-wrap items-center gap-3">{children}</div>}
    </div>
  );
}
