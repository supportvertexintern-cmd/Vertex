import { useEffect, useMemo, useState } from "react";

export const DEFAULT_PAGE_SIZE = 15;

/**
 * Client-side pagination over an already-fetched array — every list/table
 * in the app fetches its full dataset in one call, so pagination just
 * slices the display rather than re-querying. Clamps down automatically
 * if a filter shrinks the list out from under the current page.
 */
export function usePagination<T>(items: T[], pageSize: number = DEFAULT_PAGE_SIZE) {
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const paged = useMemo(() => items.slice((page - 1) * pageSize, page * pageSize), [items, page, pageSize]);

  return { page, setPage, totalPages, pageSize, paged, total: items.length };
}
