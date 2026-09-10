"use client";

import { useEffect, useState } from "react";
import PortalShell from "@/components/portal/PortalShell";
import { CANDIDATE_NAV_ITEMS } from "@/components/portal/candidateNav";
import CandidateCaseCard from "@/components/CandidateCaseCard";
import { Receipt } from "@phosphor-icons/react";

interface Payment {
  id: string;
  amount: number;
  transaction_id: string;
  payment_method: string;
  payment_status: string;
  created_at: string;
  job: { title: string };
}

export default function CandidateCasesPage() {
  const [payments, setPayments] = useState<Payment[]>([]);

  useEffect(() => {
    fetch("/api/payments/me")
      .then((r) => r.json())
      .then((res) => setPayments(Array.isArray(res) ? res : []))
      .catch(() => {});
  }, []);

  return (
    <PortalShell roleLabel="Candidate" navItems={CANDIDATE_NAV_ITEMS}>
      <p className="eyebrow mb-3">
        <span className="eyebrow-rule" />
        My Account
      </p>
      <h1 className="section-title text-3xl md:text-4xl mb-2">Cases.</h1>
      <p className="text-midnight-900/55 font-light mb-8 max-w-2xl">
        Your mobility case opens once an application is approved — track its stage and sign your contract here.
      </p>

      <div className="space-y-6">
        <CandidateCaseCard showEmptyState />

        <div className="card p-6">
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-lg font-semibold text-midnight-900 flex items-center gap-2">
              <Receipt size={18} weight="regular" /> Payment Receipts
            </h2>
          </div>

          {payments.length === 0 ? (
            <div className="text-center py-10 text-midnight-900/40">
              <Receipt size={36} weight="regular" className="mx-auto mb-3" />
              <p>No payment history found.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="text-midnight-900/40 text-xs uppercase tracking-wider">
                  <tr className="border-b border-midnight-900/10">
                    <th className="px-5 py-3 font-semibold">Job Title</th>
                    <th className="px-5 py-3 font-semibold">Amount Paid</th>
                    <th className="px-5 py-3 font-semibold">Method</th>
                    <th className="px-5 py-3 font-semibold">Date</th>
                    <th className="px-5 py-3 font-semibold text-right">Transaction ID</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map((payment) => (
                    <tr key={payment.id} className="border-b border-midnight-900/5 last:border-0">
                      <td className="px-5 py-4 font-medium text-midnight-900">{payment.job?.title || "Unknown Job"}</td>
                      <td className="px-5 py-4 font-medium text-emerald-700">${payment.amount.toFixed(2)} USD</td>
                      <td className="px-5 py-4 text-midnight-900/60 capitalize">{payment.payment_method}</td>
                      <td className="px-5 py-4 text-midnight-900/60">{new Date(payment.created_at).toLocaleDateString()}</td>
                      <td className="px-5 py-4 text-right text-xs text-midnight-900/40 font-mono">
                        {payment.transaction_id || payment.id.substring(0, 8)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </PortalShell>
  );
}
