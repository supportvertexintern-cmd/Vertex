"use client";

// Shared Yes/No + optional detail input, used everywhere a visa-readiness
// question is edited (submission forms and post-submission corrections
// alike) — extracted so the same interaction pattern doesn't get
// reimplemented slightly differently in each place.
export default function YesNoDetailField({
  label,
  value,
  detail,
  onChange,
  onDetailChange,
  detailPlaceholder = "Details (optional)",
}: {
  label: string;
  value: boolean | null;
  detail: string;
  onChange: (v: boolean) => void;
  onDetailChange: (v: string) => void;
  detailPlaceholder?: string;
}) {
  return (
    <div>
      <label className="block text-xs text-midnight-900/50 mb-1">{label}</label>
      <div className="flex items-center gap-3 mb-1">
        <label className="flex items-center gap-1 text-xs text-midnight-900/70">
          <input type="radio" checked={value === true} onChange={() => onChange(true)} className="w-3.5 h-3.5" /> Yes
        </label>
        <label className="flex items-center gap-1 text-xs text-midnight-900/70">
          <input type="radio" checked={value === false} onChange={() => onChange(false)} className="w-3.5 h-3.5" /> No
        </label>
      </div>
      {value === true && (
        <input
          value={detail}
          onChange={(e) => onDetailChange(e.target.value)}
          placeholder={detailPlaceholder}
          className="input-field text-xs w-full"
        />
      )}
    </div>
  );
}
