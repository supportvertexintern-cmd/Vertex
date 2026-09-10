"use client";

import { useEffect, useMemo, useState } from "react";
import Pagination from "@/components/Pagination";
import SortableTh from "@/components/SortableTh";
import { usePagination } from "@/lib/usePagination";
import { MagnifyingGlass } from "@phosphor-icons/react";

interface ConsultationBooking {
  id: string;
  full_name: string | null;
  email: string;
  phone: string | null;
  amount: number;
  currency: string;
  status: string;
  created_at: string;
}

const STATUS_STYLES: Record<string, string> = {
  paid: "bg-emerald-100 text-emerald-800",
};

// Shared between /operations/consultations and /finance/consultations
// (2026-08-06) — same shared-component-two-routes pattern as
// PartnerSubmissionDetail. Read-only: reconciliation visibility into the
// $50 Stripe charges from the public /consultation booking flow, nothing
// actionable here beyond what Stripe's own dashboard already offers.
export default function ConsultationBookingsList() {
  const [bookings, setBookings] = useState<ConsultationBooking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [sortBy, setSortBy] = useState<"created_at" | "amount">("created_at");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const handleSort = (key: string) => {
    if (sortBy === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortBy(key as "created_at" | "amount"); setSortDir("asc"); }
  };

  useEffect(() => {
    fetch("/api/consultation-bookings")
      .then((r) => r.json())
      .then((res) => setBookings(res.data ?? []))
      .catch(() => setError("Failed to load consultation bookings."))
      .finally(() => setLoading(false));
  }, []);

  const visibleBookings = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const rows = needle
      ? bookings.filter((b) => (b.full_name ?? "").toLowerCase().includes(needle) || b.email.toLowerCase().includes(needle))
      : bookings;
    return [...rows].sort((a, b) => {
      const diff = sortBy === "amount" ? a.amount - b.amount : new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      return sortDir === "asc" ? diff : -diff;
    });
  }, [bookings, q, sortBy, sortDir]);

  const { page, setPage, totalPages, paged, total, pageSize } = usePagination(visibleBookings);

  return (
    <>
      <p className="eyebrow mb-3">
        <span className="eyebrow-rule" />
        Consultations
      </p>
      <h1 className="section-title text-3xl md:text-4xl mb-2">Consultation Bookings.</h1>
      <p className="text-midnight-900/55 font-light mb-8 max-w-2xl">
        Paid $50 consultation bookings from the public /consultation page, for reconciling against Stripe.
      </p>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4 text-sm mb-6">{error}</div>}

      {!loading && bookings.length > 0 && (
        <div className="relative mb-6 max-w-md">
          <MagnifyingGlass size={16} weight="regular" className="absolute left-4 top-1/2 -translate-y-1/2 text-midnight-900/30" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by name or email…"
            className="input-field pl-11"
          />
        </div>
      )}

      {loading ? (
        <p className="text-midnight-900/50">Loading…</p>
      ) : bookings.length === 0 ? (
        <div className="card p-10 text-center text-midnight-900/50">No consultation bookings yet.</div>
      ) : visibleBookings.length === 0 ? (
        <div className="card p-10 text-center text-midnight-900/50">No bookings match your search.</div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-midnight-900/10 text-left text-midnight-900/40 text-xs uppercase tracking-wider">
                <SortableTh label="Booked" sortKey="created_at" activeSort={sortBy} activeDir={sortDir} onSort={handleSort} />
                <th className="px-5 py-3 font-semibold">Name</th>
                <th className="px-5 py-3 font-semibold">Email</th>
                <th className="px-5 py-3 font-semibold">Phone</th>
                <SortableTh label="Amount" sortKey="amount" activeSort={sortBy} activeDir={sortDir} onSort={handleSort} />
                <th className="px-5 py-3 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {paged.map((b) => (
                <tr key={b.id} className="border-b border-midnight-900/5 last:border-0 hover:bg-ivory-100/60">
                  <td className="px-5 py-4 text-midnight-900/70">{new Date(b.created_at).toLocaleString()}</td>
                  <td className="px-5 py-4 font-medium text-midnight-900">{b.full_name ?? "—"}</td>
                  <td className="px-5 py-4 text-midnight-900/70">{b.email}</td>
                  <td className="px-5 py-4 text-midnight-900/70">{b.phone ?? "—"}</td>
                  <td className="px-5 py-4 text-midnight-900/70">{b.amount.toLocaleString()} {b.currency}</td>
                  <td className="px-5 py-4">
                    <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold ${STATUS_STYLES[b.status] ?? "bg-slate-100 text-slate-700"}`}>
                      {b.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="px-5">
            <Pagination page={page} totalPages={totalPages} onPageChange={setPage} total={total} pageSize={pageSize} />
          </div>
        </div>
      )}
    </>
  );
}
