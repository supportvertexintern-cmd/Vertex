"use client";

import { useEffect, useState } from "react";
import PortalShell from "@/components/portal/PortalShell";
import { REFERRAL_AGENT_NAV_ITEMS } from "@/components/portal/referralAgentNav";
import { Copy, Check } from "@phosphor-icons/react";

interface MeData {
  full_name: string;
  email: string;
  status: string;
  country: string;
  referral_code: string;
  referral_link: string;
  qr_data_uri: string;
  total_referrals: number;
  milestone_counts: Record<string, number>;
  commission_summary: { earned: number; pending: number; paid: number; currency: string };
}

interface CandidateRow {
  id: string;
  full_name: string;
  lifecycle_status: string;
  referral_duplicate_flag: boolean;
  created_at: string;
  current_stage: string | null;
}

const MILESTONE_LABELS: Record<string, string> = {
  registered: "Registered",
  qualified: "Qualified",
  application_submitted: "Application Submitted",
  work_permit_approved: "Work Permit Approved",
  visa_approved: "Visa Approved",
  deployed: "Deployed",
};

function formatMoney(amount: number, currency: string) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount);
}

export default function ReferralAgentDashboardPage() {
  const [me, setMe] = useState<MeData | null>(null);
  const [candidates, setCandidates] = useState<CandidateRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch("/api/referral-agent/me").then((r) => r.json()),
      fetch("/api/referral-agent/candidates").then((r) => r.json()),
    ])
      .then(([meRes, candidatesRes]) => {
        if (meRes.data) setMe(meRes.data);
        else setError(meRes.error?.message || "Failed to load your profile.");
        setCandidates(candidatesRes.data ?? []);
      })
      .catch(() => setError("Failed to load your dashboard."))
      .finally(() => setLoading(false));
  }, []);

  const copyLink = () => {
    if (!me) return;
    navigator.clipboard.writeText(me.referral_link).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <PortalShell roleLabel="Referral Agent" navItems={REFERRAL_AGENT_NAV_ITEMS}>
      <div className="max-w-[1200px] mx-auto px-4 sm:px-6 py-8">
        <h1 className="text-2xl font-semibold text-midnight-900 tracking-tight mb-6">Referral Dashboard</h1>

        {loading && <p className="text-midnight-900/50 text-sm">Loading…</p>}
        {error && <p className="text-red-600 text-sm">{error}</p>}

        {me && (
          <>
            {/* Referral link + QR */}
            <div className="card p-6 mb-6 grid sm:grid-cols-[1fr_auto] gap-6 items-center">
              <div>
                <p className="text-sm font-medium text-midnight-900/60 mb-1">Your referral code</p>
                <p className="text-lg font-mono font-semibold text-midnight-900 mb-3">{me.referral_code}</p>
                <p className="text-sm font-medium text-midnight-900/60 mb-1">Your referral link</p>
                <div className="flex items-center gap-2">
                  <input readOnly value={me.referral_link} className="input-field text-sm font-mono" />
                  <button onClick={copyLink} className="btn-secondary text-xs px-3 py-2.5 shrink-0 flex items-center gap-1.5">
                    {copied ? <Check size={16} weight="bold" /> : <Copy size={16} weight="regular" />}
                    {copied ? "Copied" : "Copy"}
                  </button>
                </div>
              </div>
              {me.qr_data_uri && (
                <img src={me.qr_data_uri} alt="Referral QR code" className="w-32 h-32 border border-midnight-900/10 rounded-lg" />
              )}
            </div>

            {/* Commission summary */}
            <div className="grid sm:grid-cols-4 gap-4 mb-6">
              <div className="card p-5">
                <p className="text-xs font-medium text-midnight-900/50 uppercase tracking-wide mb-1">Total Referrals</p>
                <p className="text-2xl font-semibold text-midnight-900">{me.total_referrals}</p>
              </div>
              <div className="card p-5">
                <p className="text-xs font-medium text-midnight-900/50 uppercase tracking-wide mb-1">Total Earned</p>
                <p className="text-2xl font-semibold text-midnight-900">{formatMoney(me.commission_summary.earned, me.commission_summary.currency)}</p>
              </div>
              <div className="card p-5">
                <p className="text-xs font-medium text-midnight-900/50 uppercase tracking-wide mb-1">Pending</p>
                <p className="text-2xl font-semibold text-amber-600">{formatMoney(me.commission_summary.pending, me.commission_summary.currency)}</p>
              </div>
              <div className="card p-5">
                <p className="text-xs font-medium text-midnight-900/50 uppercase tracking-wide mb-1">Paid</p>
                <p className="text-2xl font-semibold text-emerald-600">{formatMoney(me.commission_summary.paid, me.commission_summary.currency)}</p>
              </div>
            </div>

            {/* Milestone breakdown */}
            <div className="card p-6 mb-6">
              <h2 className="font-semibold text-midnight-900 mb-4">Milestone Breakdown</h2>
              <div className="grid sm:grid-cols-3 lg:grid-cols-6 gap-4">
                {Object.entries(MILESTONE_LABELS).map(([key, label]) => (
                  <div key={key}>
                    <p className="text-xs text-midnight-900/50 mb-1">{label}</p>
                    <p className="text-xl font-semibold text-midnight-900">{me.milestone_counts[key] ?? 0}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Referred candidates */}
            <div className="card p-6">
              <h2 className="font-semibold text-midnight-900 mb-4">Referred Candidates</h2>
              {candidates.length === 0 ? (
                <p className="text-midnight-900/50 text-sm">No candidates referred yet — share your link above to get started.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-midnight-900/10 text-left text-midnight-900/50 text-xs uppercase tracking-wide">
                        <th className="py-2 pr-4">Name</th>
                        <th className="py-2 pr-4">Status</th>
                        <th className="py-2 pr-4">Stage</th>
                        <th className="py-2 pr-4">Referred</th>
                      </tr>
                    </thead>
                    <tbody>
                      {candidates.map((c) => (
                        <tr key={c.id} className="border-b border-midnight-900/5">
                          <td className="py-2.5 pr-4 font-medium text-midnight-900">{c.full_name}</td>
                          <td className="py-2.5 pr-4 capitalize">{c.lifecycle_status.replace(/_/g, " ")}</td>
                          <td className="py-2.5 pr-4 capitalize">{c.current_stage ? c.current_stage.replace(/_/g, " ") : "—"}</td>
                          <td className="py-2.5 pr-4 text-midnight-900/60">{new Date(c.created_at).toLocaleDateString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </PortalShell>
  );
}
