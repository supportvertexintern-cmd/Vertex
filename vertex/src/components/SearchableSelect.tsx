"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CaretDown, MagnifyingGlass, Check } from "@phosphor-icons/react";

export interface SearchableSelectOption {
  value: string;
  label: string;
}

interface Props {
  value: string;
  onChange: (value: string) => void;
  options: SearchableSelectOption[];
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  className?: string;
  id?: string;
  "aria-label"?: string;
}

// A searchable dropdown that behaves like a native <select> from the
// outside (string value + onChange(value)) but lets you type to filter
// the option list instead of scrolling a long native menu — used
// everywhere the app previously had a plain <select> with more than a
// couple of options (countries, sectors, staff, regions, etc.).
export default function SearchableSelect({
  value,
  onChange,
  options,
  placeholder = "Select…",
  disabled,
  required,
  className,
  id,
  ...aria
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = options.find((o) => o.value === value) ?? null;

  const filtered = useMemo(() => {
    if (!query) return options;
    const q = query.toLowerCase();
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, query]);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  useEffect(() => {
    if (open) {
      setHighlighted(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const commit = (opt: SearchableSelectOption) => {
    onChange(opt.value);
    setOpen(false);
    setQuery("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlighted((h) => Math.min(h + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlighted((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (filtered[highlighted]) commit(filtered[highlighted]);
    } else if (e.key === "Escape") {
      setOpen(false);
      setQuery("");
    }
  };

  return (
    <div ref={rootRef} className="relative">
      {/* Hidden input carries `required` semantics into the surrounding form. */}
      {required && <input tabIndex={-1} value={value} required onChange={() => {}} className="sr-only" aria-hidden />}
      <button
        type="button"
        id={id}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        className={`${className ?? "input-field"} flex items-center justify-between text-left disabled:opacity-50 disabled:cursor-not-allowed`}
        {...aria}
      >
        <span className={selected ? "" : "text-midnight-900/35"}>{selected ? selected.label : placeholder}</span>
        <CaretDown size={14} weight="bold" className="text-midnight-900/30 shrink-0 ml-2" />
      </button>

      {open && (
        <div className="absolute z-30 mt-1 w-full min-w-[200px] bg-white border border-midnight-900/15 rounded-lg shadow-xl overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-midnight-900/10">
            <MagnifyingGlass size={14} weight="regular" className="text-midnight-900/30 shrink-0" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Search…"
              aria-label="Search options"
              className="flex-1 text-sm outline-none placeholder-midnight-900/35"
            />
          </div>
          <ul role="listbox" className="max-h-56 overflow-y-auto py-1">
            {filtered.length === 0 && (
              <li className="px-3 py-2 text-sm text-midnight-900/40">No matches.</li>
            )}
            {filtered.map((opt, i) => (
              <li key={opt.value} role="option" aria-selected={opt.value === value}>
                <button
                  type="button"
                  onClick={() => commit(opt)}
                  onMouseEnter={() => setHighlighted(i)}
                  className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-sm text-left ${
                    i === highlighted ? "bg-ivory-100" : ""
                  } ${opt.value === value ? "font-semibold text-midnight-900" : "text-midnight-900/80"}`}
                >
                  {opt.label}
                  {opt.value === value && <Check size={14} weight="bold" className="text-gold-600 shrink-0" />}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
