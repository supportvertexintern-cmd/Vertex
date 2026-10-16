"use client";

import SearchableSelect from "@/components/SearchableSelect";

export interface OpportunityFilterOptions {
  countries: string[];
  programmes: string[];
  programme_countries: string[];
}

export const EMPTY_OPPORTUNITY_FILTER_OPTIONS: OpportunityFilterOptions = { countries: [], programmes: [], programme_countries: [] };

interface Props {
  options: OpportunityFilterOptions;
  country: string;
  onCountryChange: (value: string) => void;
  programme: string;
  onProgrammeChange: (value: string) => void;
  programmeCountry: string;
  onProgrammeCountryChange: (value: string) => void;
  onClear: () => void;
  clearDisabled: boolean;
}

// Country / Programme / Programme Country dropdowns + Clear Filters
// (2026-10-15), shared by every list dashboard that shows an opportunity.
// Rendered inside FilterBar's filter row, after a page's own filters.
// Options come from the list endpoint's filter_options (see
// server/services/opportunityFilters.ts).
export default function OpportunityFilters({
  options,
  country,
  onCountryChange,
  programme,
  onProgrammeChange,
  programmeCountry,
  onProgrammeCountryChange,
  onClear,
  clearDisabled,
}: Props) {
  return (
    <>
      <SearchableSelect
        value={country}
        onChange={onCountryChange}
        className="input-field w-56"
        aria-label="Country"
        options={[{ value: "", label: "All Countries" }, ...options.countries.map((c) => ({ value: c, label: c }))]}
      />
      <SearchableSelect
        value={programme}
        onChange={onProgrammeChange}
        className="input-field w-72"
        aria-label="Programme"
        options={[{ value: "", label: "All Programmes" }, ...options.programmes.map((p) => ({ value: p, label: p }))]}
      />
      <SearchableSelect
        value={programmeCountry}
        onChange={onProgrammeCountryChange}
        className="input-field w-56"
        aria-label="Programme Country"
        options={[
          { value: "", label: "All Programme Countries" },
          ...options.programme_countries.map((c) => ({ value: c, label: c })),
        ]}
      />
      <button
        type="button"
        onClick={onClear}
        disabled={clearDisabled}
        className="text-xs font-semibold text-midnight-900/60 hover:text-gold-600 disabled:opacity-40 disabled:hover:text-midnight-900/60 px-2 py-2"
      >
        Clear Filters
      </button>
    </>
  );
}
