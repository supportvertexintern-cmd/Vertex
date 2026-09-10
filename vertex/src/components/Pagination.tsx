"use client";

import { CaretLeft, CaretRight } from "@phosphor-icons/react";

interface Props {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  total?: number;
  pageSize?: number;
}

export default function Pagination({ page, totalPages, onPageChange, total, pageSize }: Props) {
  if (totalPages <= 1) return null;

  const rangeLabel =
    total !== undefined && pageSize !== undefined
      ? `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} of ${total}`
      : `Page ${page} of ${totalPages}`;

  return (
    <div className="flex items-center justify-between gap-4 pt-4 mt-2 border-t border-midnight-900/10">
      <span className="text-xs text-midnight-900/45">{rangeLabel}</span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          className="btn-secondary py-1.5 px-3 text-xs disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <CaretLeft size={12} weight="bold" /> Prev
        </button>
        <span className="text-xs text-midnight-900/60 font-medium px-1">{page} / {totalPages}</span>
        <button
          type="button"
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages}
          className="btn-secondary py-1.5 px-3 text-xs disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Next <CaretRight size={12} weight="bold" />
        </button>
      </div>
    </div>
  );
}
