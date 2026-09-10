"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import PortalShell from "@/components/portal/PortalShell";
import { FINANCE_NAV_ITEMS } from "@/components/portal/financeNav";
import { CASE_STAGE_LABELS, type CaseStageKey } from "@/components/portal/caseStages";
import SortableTh from "@/components/SortableTh";
import SearchableSelect from "@/components/SearchableSelect";
import FilterBar from "@/components/portal/FilterBar";
import { ArrowRight } from "@phosphor-icons/react";

interface PaymentDueRow {
  case_id: string;
  candidateName: string;
  partnerName: string | null;
  source: string;
  programmeTitle: string;
  type: "documentation" | "permit" | "visa";
  amountDue: number;
  currentStage: CaseStageKey;
}

const TYPE_LABELS: Record<string, string> = {
  documentation: "Documentation (Stage 1 · 25%)",
  permit: "Work Permit (Stage 2 · 25%)",
  visa: "Visa (Stage 3 · 50%)",
};

// Application type = Candidate.source (2026-08-18).
const SOURCE_OPTIONS = [
  { value: "", label: "All application types" },
  { value: "self_registered", label: "Self-Submitted" },
  { value: "recruiter_sourced", label: "Recruiter-Sourced" },
  { value: "partner_sourced", label: "Partner-Sourced" },
];

// Finance's own worklist (SOP-confirmed 2026-07-31): every milestone
// that's reached its trigger stage but has no collected payment yet.
// Clicking through to the case opens Finance's own read-scoped CaseDetail
// (payments-only capability) to issue a link or record the payment.
export default function FinancePaymentsDuePage() {
  const [rows, setRows] = useState<PaymentDueRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [partnerFilter, setPartnerFilter] = useState("");
  const [sourceFilter, setSourceFilter] = useState("");
  const [sortBy, setSortBy] = useState<keyof PaymentDueRow>("candidateName");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const handleSort = (key: string) => {
    const k = key as keyof PaymentDueRow;
    if (sortBy === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortBy(k); setSortDir("asc"); }
  };

  useEffect(() => {
    fetch("/api/finance/payments-due")
      .then((r) => r.json())
      .then((res) => setRows(res.data ?? []))
      .catch(() => setError("Failed to load payments due."))
      .finally(() => setLoading(false));
  }, []);

  const partnerOptions = useMemo(() => {
    const names = new Set(rows.map((r) => r.partnerName).filter((n): n is string => Boolean(n)));
    return [...names].sort().map((n) => ({ value: n, label: n }));
  }, [rows]);

  // Client-side search + filter + sort — this list is fetched in full (no
  // server pagination), so all three operate over the whole dataset, not
  // just a page (CRM Comments item 8, 2026-08-10; Partner/Application
  // Type filters added 2026-08-18).
  const visibleRows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const filtered = rows.filter((r) => {
      if (partnerFilter && r.partnerName !== partnerFilter) return false;
      if (sourceFilter && r.source !== sourceFilter) return false;
      if (!needle) return true;
      return (
        r.candidateName.toLowerCase().includes(needle) ||
        (r.partnerName ?? "").toLowerCase().includes(needle) ||
        r.programmeTitle.toLowerCase().includes(needle)
      );
    });
    const sorted = [...filtered].sort((a, b) => {
      const av = a[sortBy] ?? "";
      const bv = b[sortBy] ?? "";
      if (av < bv) return sortDir === "asc" ? -1 : 1;
      if (av > bv) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
    return sorted;
  }, [rows, q, partnerFilter, sourceFilter, sortBy, sortDir]);

  return (
    <PortalShell roleLabel="Finance" navItems={FINANCE_NAV_ITEMS}>
      <p className="eyebrow mb-3">
        <span className="eyebrow-rule" />
        Milestone Payments
      </p>
      <h1 className="section-title text-3xl md:text-4xl mb-2">Payments Due.</h1>
      <p className="text-midnight-900/55 font-light mb-8 max-w-2xl">
        Every milestone that's reached its stage but hasn't been collected yet (SRS FR-4.5) — documentation is due
        the moment a case opens, permit once it's approved, visa once the interview decision comes through.
      </p>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4 text-sm mb-6">{error}</div>}

      {!loading && rows.length > 0 && (
        <FilterBar searchValue={q} onSearchChange={setQ} searchPlaceholder="Search by candidate, partner, or programme…">
          <SearchableSelect
            value={partnerFilter}
            onChange={setPartnerFilter}
            placeholder="All partners"
            className="input-field w-52"
            options={[{ value: "", label: "All partners" }, ...partnerOptions]}
          />
          <SearchableSelect value={sourceFilter} onChange={setSourceFilter} className="input-field w-56" options={SOURCE_OPTIONS} />
        </FilterBar>
      )}

      {loading ? (
        <p className="text-midnight-900/50">Loading…</p>
      ) : rows.length === 0 ? (
        <div className="card p-10 text-center text-midnight-900/50">Nothing due right now.</div>
      ) : visibleRows.length === 0 ? (
        <div className="card p-10 text-center text-midnight-900/50">No payments due match your filters.</div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-midnight-900/10 text-left text-midnight-900/40 text-xs uppercase tracking-wider">
                <SortableTh label="Candidate" sortKey="candidateName" activeSort={sortBy} activeDir={sortDir} onSort={handleSort} />
                <SortableTh label="Partner" sortKey="partnerName" activeSort={sortBy} activeDir={sortDir} onSort={handleSort} />
                <SortableTh label="Programme" sortKey="programmeTitle" activeSort={sortBy} activeDir={sortDir} onSort={handleSort} />
                <th className="px-5 py-3 font-semibold">Milestone</th>
                <SortableTh label="Amount Due" sortKey="amountDue" activeSort={sortBy} activeDir={sortDir} onSort={handleSort} />
                <th className="px-5 py-3 font-semibold">Current Stage</th>
                <th className="px-5 py-3 font-semibold"></th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((r, i) => (
                <tr key={`${r.case_id}-${r.type}-${i}`} className="border-b border-midnight-900/5 last:border-0 hover:bg-ivory-100/60">
                  <td className="px-5 py-4 font-medium text-midnight-900">{r.candidateName}</td>
                  <td className="px-5 py-4 text-midnight-900/70">{r.partnerName ?? "—"}</td>
                  <td className="px-5 py-4 text-midnight-900/70">{r.programmeTitle}</td>
                  <td className="px-5 py-4 text-midnight-900/70">{TYPE_LABELS[r.type]}</td>
                  <td className="px-5 py-4 text-midnight-900 font-semibold">£{r.amountDue.toLocaleString()}</td>
                  <td className="px-5 py-4 text-xs text-midnight-900/50">{CASE_STAGE_LABELS[r.currentStage]}</td>
                  <td className="px-5 py-4 text-right">
                    <Link
                      href={`/finance/cases/${r.case_id}`}
                      className="inline-flex items-center gap-1 text-xs font-semibold text-gold-600 hover:underline"
                    >
                      Open Case <ArrowRight size={11} weight="bold" />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </PortalShell>
  );
}
