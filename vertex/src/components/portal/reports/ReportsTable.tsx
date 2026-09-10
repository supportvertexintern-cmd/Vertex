"use client";

import Link from "next/link";
import Pagination from "@/components/Pagination";
import { ArrowRight } from "@phosphor-icons/react";

export interface ReportTableRow {
  id: string;
  status: string;
  period_start: string;
  period_end: string;
  submitter: { id: string; full_name: string };
  country?: { id: string; name: string } | null;
}

export const REPORT_STATUS_STYLES: Record<string, string> = {
  draft: "bg-slate-100 text-slate-700",
  submitted: "bg-yellow-100 text-yellow-800",
  verified: "bg-emerald-100 text-emerald-800",
  approved: "bg-emerald-100 text-emerald-800",
  returned: "bg-red-100 text-red-700",
  consolidated: "bg-blue-100 text-blue-700",
  escalated: "bg-orange-100 text-orange-800",
  closed: "bg-slate-100 text-slate-700",
};

interface Props {
  rows: ReportTableRow[];
  detailBasePath: string;
  submitterColumnLabel?: string; // omitted entirely when not given
  countryColumn?: boolean;
  emptyLabel: string;
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  total: number;
  pageSize: number;
}

// Shared Period | Status | Actions table for every reports list page
// (recruiter's own list has its own bespoke version with an inline
// create form; this is for supervisor/in-house's tabbed sections, which
// don't need that) — row's Actions cell links to a per-role detail page
// rather than the row itself, matching the recruiter list's convention.
export default function ReportsTable({
  rows,
  detailBasePath,
  submitterColumnLabel,
  countryColumn,
  emptyLabel,
  page,
  totalPages,
  onPageChange,
  total,
  pageSize,
}: Props) {
  if (rows.length === 0) {
    return <div className="card p-6 text-center text-midnight-900/40">{emptyLabel}</div>;
  }

  return (
    <div className="card overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-midnight-900/10 text-left text-midnight-900/40 text-xs uppercase tracking-wider">
            {submitterColumnLabel && <th className="px-5 py-3 font-semibold">{submitterColumnLabel}</th>}
            {countryColumn && <th className="px-5 py-3 font-semibold">Country</th>}
            <th className="px-5 py-3 font-semibold">Period</th>
            <th className="px-5 py-3 font-semibold">Status</th>
            <th className="px-5 py-3 font-semibold"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-midnight-900/5 last:border-0">
              {submitterColumnLabel && <td className="px-5 py-4 font-medium text-midnight-900">{r.submitter.full_name}</td>}
              {countryColumn && <td className="px-5 py-4 text-midnight-900/70">{r.country?.name ?? "—"}</td>}
              <td className="px-5 py-4 text-midnight-900/70 whitespace-nowrap">
                {new Date(r.period_start).toLocaleDateString()} – {new Date(r.period_end).toLocaleDateString()}
              </td>
              <td className="px-5 py-4">
                <span
                  className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider ${
                    REPORT_STATUS_STYLES[r.status] ?? "bg-slate-100 text-slate-700"
                  }`}
                >
                  {r.status}
                </span>
              </td>
              <td className="px-5 py-4 text-right">
                <Link href={`${detailBasePath}/${r.id}`} className="inline-flex items-center gap-1 text-xs font-semibold text-gold-600 hover:underline">
                  {r.status === "returned" ? "View & Resubmit" : "View"} <ArrowRight size={11} weight="bold" />
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="px-5">
        <Pagination page={page} totalPages={totalPages} onPageChange={onPageChange} total={total} pageSize={pageSize} />
      </div>
    </div>
  );
}
