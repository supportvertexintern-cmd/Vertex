"use client";

import { useEffect, useState } from "react";

// Partner commission statement panel (Phase 6 §3C, upstream staging) —
// mounted on the Management partner detail page. Everything is computed live
// from the ledger rows by FastAPI (vertex_be/app/api/v1/partner_performance.py)
// on every read, the platform convention.

interface StatementData {
  partner: {
    id: string;
    name: string;
    status: string;
    mou_status: string;
    sla_status: string;
    contact_email: string;
    assigned_team_member: { id: string; full_name: string } | null;
  };
  summary: {
    registered_candidates: number;
    registration_commissions: number;
    deployed_candidates: number;
    monthly_deployment_commissions: number;
    // Q6: the six monthly rows are scheduled at deployment, but only months
    // whose period has arrived count as earned — the rest are shown as
    // scheduled so the partner can see the full schedule without it
    // inflating what's payable today.
    scheduled_commissions: number;
    months_earned: number;
    months_scheduled: number;
    total_earned: number;
    outstanding: number;
    pending: number;
    approved: number;
    paid: number;
  };
  history: Array<{
    id: string;
    rule_type: "registration" | "monthly_deployment";
    period: string;
    amount: number;
    currency: string;
    status: "pending" | "approved" | "paid" | "rejected";
    created_at: string;
    candidate: { full_name: string | null };
  }>;
}

const RULE_LABELS: Record<string, string> = { registration: "Registration", monthly_deployment: "Monthly" };

const STATUS_STYLES: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-800",
  approved: "bg-blue-100 text-blue-700",
  paid: "bg-emerald-100 text-emerald-800",
  rejected: "bg-red-100 text-red-700",
};

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card p-4">
      <div className="text-xs font-semibold text-midnight-900/50 uppercase tracking-wider">{label}</div>
      <div className="text-xl font-bold text-midnight-900 mt-1">{value}</div>
      {sub && <div className="text-xs text-midnight-900/45 mt-0.5">{sub}</div>}
    </div>
  );
}

export default function PartnerCommissionStatement({ partnerId }: { partnerId: string }) {
  const [data, setData] = useState<StatementData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch(`/api/management/partners/${partnerId}/commission-statement`)
      .then((r) => r.json())
      .then((res) => {
        if (res.error) throw new Error(res.error.message ?? "Failed to load commission statement.");
        setData(res.data);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load commission statement."))
      .finally(() => setLoading(false));
  }, [partnerId]);

  if (loading) return <div className="card p-10 text-center text-midnight-900/50">Loading commission statement…</div>;
  if (error) return <div className="card p-6 border-l-4 border-red-400 text-red-700 text-sm">{error}</div>;
  if (!data) return null;

  const { summary: s, history } = data;
  const usd = (n: number) => `USD ${n.toLocaleString()}`;

  return (
    <div>
      <h2 className="text-sm font-semibold text-midnight-900/50 uppercase tracking-wider mb-3">Commission statement</h2>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Stat label="Registered candidates" value={String(s.registered_candidates)} sub={`${usd(s.registration_commissions)} registration commissions`} />
        <Stat label="Deployed candidates" value={String(s.deployed_candidates)} sub={`${usd(s.monthly_deployment_commissions)} monthly commissions`} />
        <Stat label="Total earned" value={usd(s.total_earned)} sub={`${usd(s.pending)} pending · ${usd(s.approved)} approved`} />
        <Stat label="Outstanding" value={usd(s.outstanding)} sub={`${usd(s.paid)} paid to date`} />
        {s.months_scheduled > 0 && (
          <Stat
            label="Scheduled"
            value={usd(s.scheduled_commissions)}
            sub={`${s.months_scheduled} future month(s) · ${s.months_earned} earned so far`}
          />
        )}
      </div>

      {history.length === 0 ? (
        <div className="card p-8 text-center text-midnight-900/50">No commissions recorded yet.</div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-midnight-900/10 text-left text-midnight-900/40 text-xs uppercase tracking-wider">
                <th className="px-4 py-3">Candidate</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Period</th>
                <th className="px-4 py-3">Amount</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Recorded</th>
              </tr>
            </thead>
            <tbody>
              {history.map((c) => (
                <tr key={c.id} className="border-b border-midnight-900/5">
                  <td className="px-4 py-3">{c.candidate.full_name ?? "—"}</td>
                  <td className="px-4 py-3">{RULE_LABELS[c.rule_type] ?? c.rule_type}</td>
                  <td className="px-4 py-3">{c.rule_type === "registration" ? "Registration" : c.period}</td>
                  <td className="px-4 py-3 font-semibold">{c.currency} {c.amount.toLocaleString()}</td>
                  <td className="px-4 py-3"><span className={`badge ${STATUS_STYLES[c.status] ?? ""}`}>{c.status}</span></td>
                  <td className="px-4 py-3">{new Date(c.created_at).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}