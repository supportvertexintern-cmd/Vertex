import { useEffect, useId, useMemo, useRef, useState } from "react";

export const DEFAULT_PAGE_SIZE = 15;

/**
 * Client-side pagination over an already-fetched array — every list/table
 * in the app fetches its full dataset in one call, so pagination just
 * slices the display rather than re-querying. Clamps down automatically
 * if a filter shrinks the list out from under the current page.
 */
export function usePagination<T>(items: T[], pageSize: number = DEFAULT_PAGE_SIZE) {
  const instanceId = useId();
  const storageKey =
    typeof window === "undefined"
      ? `vertex-pagination:server:${instanceId}`
      : `vertex-pagination:${window.location.pathname}:${instanceId}`;
  const [page, setPage] = useState(1);
  const skipInitialSave = useRef(true);
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));

  useEffect(() => {
    let timeout: number | undefined;
    try {
      const savedPage = Number(window.sessionStorage.getItem(storageKey));
      if (Number.isInteger(savedPage) && savedPage > 0) {
        timeout = window.setTimeout(() => setPage(savedPage), 0);
      }
    } catch {
      // Pagination still works when browser storage is unavailable.
    }
    return () => {
      if (timeout !== undefined) window.clearTimeout(timeout);
    };
  }, [storageKey]);

  useEffect(() => {
    if (skipInitialSave.current) {
      skipInitialSave.current = false;
      return;
    }
    try {
      window.sessionStorage.setItem(storageKey, String(page));
    } catch {
      // Pagination still works when browser storage is unavailable.
    }
  }, [storageKey, page]);

  useEffect(() => {
    if (items.length === 0 || page <= totalPages) return;
    const timeout = window.setTimeout(() => setPage(totalPages), 0);
    return () => window.clearTimeout(timeout);
  }, [items.length, page, totalPages]);

  const paged = useMemo(() => items.slice((page - 1) * pageSize, page * pageSize), [items, page, pageSize]);

  return { page, setPage, totalPages, pageSize, paged, total: items.length };
}
