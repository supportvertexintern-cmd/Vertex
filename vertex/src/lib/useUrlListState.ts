"use client";

import { useCallback } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

// Keeps a list page's page/search/filter state mirrored into the URL
// query string (CRM Comments follow-up, 2026-08-12: "returning to the
// applicant list automatically takes the user back to the first page").
// Reading initial state from the URL (instead of always starting at
// useState(1)/"") plus pushing every change back into it means each
// page+filter combination is its own real browser-history entry — the
// browser's own Back button (or a page's "← Back" link, once switched to
// router.back()) naturally lands on the exact same page/filters instead
// of resetting to page 1.
export function useUrlListState() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const get = useCallback((key: string, fallback = "") => searchParams.get(key) ?? fallback, [searchParams]);
  const getNumber = useCallback((key: string, fallback: number) => {
    const raw = searchParams.get(key);
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) && n > 0 ? n : fallback;
  }, [searchParams]);

  // replace (not push) — updating a filter shouldn't pile up a new
  // history entry per keystroke; only the initial list->detail navigation
  // needs to be a real history step for Back to work.
  const set = useCallback(
    (updates: Record<string, string | number>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        const str = String(value);
        if (str) params.set(key, str);
        else params.delete(key);
      }
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [searchParams, pathname, router]
  );

  return { get, getNumber, set };
}
