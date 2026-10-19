"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
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

const LIST_MAX_HEIGHT = 224;
const SEARCH_ROW_HEIGHT = 40;
const PANEL_HEIGHT = LIST_MAX_HEIGHT + SEARCH_ROW_HEIGHT;

// A searchable dropdown that behaves like a native <select> from the
// outside (string value + onChange(value)) but lets you type to filter
// the option list instead of scrolling a long native menu — used
// everywhere the app previously had a plain <select> with more than a
// couple of options (countries, sectors, staff, regions, etc.).
//
// The option list is rendered into a `position: fixed` layer attached to
// <body>, positioned directly under the trigger (or above it, when the
// window has no room for the list below) from its measured rect,
// so it cannot be affected by any ancestor's overflow/transform/position
// layout. The fixed subtree is inserted one frame after the dropdown is
// opened (double requestAnimationFrame): if it is mounted while the page
// is still settling, Chrome can lay the list out against a stale fixed
// containing block and permanently shift its children a couple of tens of
// pixels sideways (clipping the first characters of every option). A
// fresh insertion after the page has settled renders correctly every
// time. Position is re-measured on scroll/resize so it tracks the
// trigger.
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
  const [mounted, setMounted] = useState(false);
  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState(0);
  const [coords, setCoords] = useState<{ top?: number; bottom?: number; left: number; width: number; space: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const selected = options.find((o) => o.value === value) ?? null;

  const filtered = useMemo(() => {
    if (!query) return options;
    const q = query.toLowerCase();
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, query]);

  const measure = useCallback(() => {
    const el = rootRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const width = Math.min(Math.max(r.width, 200), window.innerWidth - 8);
    const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
    // A fixed panel can't be scrolled into view, so when a trigger near the
    // bottom of the window lacks room for the full list below it, open the
    // panel upward instead of off-screen.
    const below = window.innerHeight - r.bottom - 12;
    const above = r.top - 12;
    if (below < PANEL_HEIGHT && above > below) {
      setCoords({ bottom: window.innerHeight - r.top + 4, left, width, space: above });
    } else {
      setCoords({ top: r.bottom + 4, left, width, space: below });
    }
  }, []);

  const close = () => {
    setOpen(false);
    setMounted(false);
    setQuery("");
  };

  const openDropdown = () => {
    if (open) {
      close();
      return;
    }
    setOpen(true);
    setMounted(false);
    setCoords(null);
    setHighlighted(0);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        measure();
        setMounted(true);
      });
    });
  };

  useEffect(() => {
    if (!open) return;
    measure();
    window.addEventListener("scroll", measure, true);
    window.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("resize", measure);
    };
  }, [open, measure]);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      const insideRoot = rootRef.current?.contains(target);
      const insidePanel = panelRef.current?.contains(target);
      if (!insideRoot && !insidePanel) close();
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  useEffect(() => {
    if (!mounted) return;
    // The fixed list reaches its final position only after the browser
    // relayouts it once in place — re-appending the panel to <body> forces
    // that relayout so the options are never laid out a few px off the
    // panel's left edge. The move is done before focusing the search box
    // because moving the panel clears focus set earlier in the same frame,
    // and a plain focus() scrolls the box into view which re-runs the
    // stale layout behind it — { preventScroll: true } avoids that.
    const raf1 = requestAnimationFrame(() => {
      if (panelRef.current) document.body.appendChild(panelRef.current);
      requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }));
    });
    return () => cancelAnimationFrame(raf1);
  }, [mounted]);

  const commit = (opt: SearchableSelectOption) => {
    onChange(opt.value);
    close();
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
      close();
    }
  };

  const maxHeight = coords ? Math.max(96, Math.min(LIST_MAX_HEIGHT, coords.space - SEARCH_ROW_HEIGHT)) : LIST_MAX_HEIGHT;

  return (
    <div
      ref={rootRef}
      className="relative"
      onKeyDown={(e) => {
        if (e.key === "Escape") close();
      }}
    >
      {/* Hidden input carries `required` semantics into the surrounding form. */}
      {required && <input tabIndex={-1} value={value} required onChange={() => {}} className="sr-only" aria-hidden />}
      <button
        type="button"
        id={id}
        disabled={disabled}
        onClick={openDropdown}
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={listId}
        className={`${className ?? "input-field"} flex items-start justify-between text-left disabled:opacity-50 disabled:cursor-not-allowed`}
        {...aria}
      >
        <span className={`block min-w-0 break-words ${selected ? "" : "text-midnight-900/35"}`}>{selected ? selected.label : placeholder}</span>
        <CaretDown size={14} weight="bold" className="text-midnight-900/30 shrink-0 ml-2 mt-0.5" />
      </button>

      {open && mounted && coords && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={panelRef}
              style={{ position: "fixed", top: coords.top, bottom: coords.bottom, left: coords.left, width: coords.width }}
              className="z-[999] bg-white border border-midnight-900/15 rounded-lg shadow-xl overflow-hidden"
            >
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
              <ul id={listId} role="listbox" className="overflow-y-auto overflow-x-hidden py-1 [scrollbar-gutter:stable]" style={{ maxHeight }}>
                {filtered.length === 0 && (
                  <li className="px-3 py-2 text-sm text-midnight-900/40">No matches.</li>
                )}
                {filtered.map((opt, i) => (
                  <li key={opt.value} role="option" aria-selected={opt.value === value}>
                    <button
                      type="button"
                      onClick={() => commit(opt)}
                      onMouseEnter={() => setHighlighted(i)}
                      className={`w-full flex items-start justify-between gap-2 px-3 py-2 text-sm text-left ${
                        i === highlighted ? "bg-ivory-100" : ""
                      } ${opt.value === value ? "font-semibold text-midnight-900" : "text-midnight-900/80"}`}
                    >
                      <span className="block min-w-0 break-words">{opt.label}</span>
                      {opt.value === value && <Check size={14} weight="bold" className="text-gold-600 shrink-0 mt-0.5" />}
                    </button>
                  </li>
                ))}
              </ul>
            </div>,
            document.body
          )
        : null}
    </div>
  );
}