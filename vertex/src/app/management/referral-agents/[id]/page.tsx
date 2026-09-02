"use client";

import { useEffect, useState, use } from "react";
import Link from "next/link";
import PortalShell from "@/components/portal/PortalShell";
import { MANAGEMENT_NAV_ITEMS } from "@/components/portal/managementNav";
import Pagination from "@/components/Pagination";
import { usePagination } from "@/lib/usePagination";
import { formatCandidateLifecycleStatus } from "@/lib/candidateLifecycleStatus";
import { CheckCircle, Trash, WarningCircle } from "@phosphor-icons/react";

const STATUS_STYLES: Record<string, string> = {
  pending_approval: "bg-yellow-100 text-yellow-800",
  active: "bg-emerald-100 text-emerald-800",
  suspended: "bg-red-100 text-red-700",
  rejected: "bg-slate-100 text-slate-600",
};

const MILESTONE_LABELS: Record<string, string> = {
  registered: "Registered",
  qualified: "Qualified",
  application_submitted: "Application Submitted",
  work_permit_approved: "Work Permit Approved",
  visa_approved: "Visa Approved",
  deployed: "Deployed",
};

const COMMISSION_STATUS_STYLES: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-800",
  approved: "bg-blue-100 text-blue-700",
  paid: "bg-emerald-100 text-emerald-800",
  rejected: "bg-red-100 text-red-700",
};

interface TargetVsActual {
  targetId: string;
  periodStart: string;
  periodEnd: string;
  targetReferrals: number;
  actualReferrals: number;
}

interface ReferredCandidateRow {
  id: string;
  full_name: string | null;
  lifecycle_status: string;
  referral_duplicate_flag: boolean;
  created_at: string;
}

interface CommissionRow {
  id: string;
  milestone: string;
  amount: number;
  currency: string;
  status: string;
  created_at: string;
  candidate: { id: string; full_name: string | null };
}

interface ReferralAgentDetail {
  id: string;
  full_name: string;
  email: string;
  phone: string;
  whatsapp_number: string | null;
  country: string;
  countryRef: { id: string; name: string } | null;
  city: string | null;
  status: string;
  referral_code: string;
  email_verified: boolean;
  rejection_reason: string | null;
  suspended_reason: string | null;
  user_id: string | null;
  network_size: number | null;
  promotion_plan: string | null;
  previous_experience: string | null;
  candidates: ReferredCandidateRow[];
  commissions: CommissionRow[];
}

export default function ReferralAgentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [agent, setAgent] = useState<ReferralAgentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [acting, setActing] = useState(false);
  const [targets, setTargets] = useState<TargetVsActual[]>([]);
  const [showTargetForm, setShowTargetForm] = useState(false);
  const [targetForm, setTargetForm] = useState({ period_start: "", period_end: "", target_referrals: "" });
  const [savingTarget, setSavingTarget] = useState(false);

  const load = () => {
    setLoading(true);
    fetch(`/api/admin/referral-agents/${id}`)
      .then((r) => r.json())
      .then((res) => {
        if (res.error) throw new Error(res.error.message);
        setAgent(res.data);
      })
      .catch(() => setError("Failed to load referral agent."))
      .finally(() => setLoading(false));
  };

  const loadTargets = () => {
    fetch(`/api/admin/referral-agents/${id}/targets`)
      .then((r) => r.json())
      .then((res) => setTargets(res.data ?? []))
      .catch(() => {});
  };

  useEffect(load, [id]);
  useEffect(loadTargets, [id]);

  const createTarget = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingTarget(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/referral-agents/${id}/targets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(targetForm),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error?.message || "Failed to set target.");
      setTargetForm({ period_start: "", period_end: "", target_referrals: "" });
      setShowTargetForm(false);
      loadTargets();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to set target.");
    } finally {
      setSavingTarget(false);
    }
  };

  const approve = async () => {
    setActing(true);
    setError("");
    setNotice("");
    try {
      const res = await fetch(`/api/admin/referral-agents/${id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error?.message || "Failed to approve agent.");
      setNotice("Agent approved — an approval email and an account-setup invite have been sent.");
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to approve agent.");
    } finally {
      setActing(false);
    }
  };

  const reject = async () => {
    const reason = window.prompt("Reason for rejecting this application:");
    if (!reason) return;
    setActing(true);
    setError("");
    setNotice("");
    try {
      const res = await fetch(`/api/admin/referral-agents/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "rejected", reason }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error?.message || "Failed to reject agent.");
      setNotice("Application rejected — the applicant has been notified.");
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reject agent.");
    } finally {
      setActing(false);
    }
  };

  const suspend = async () => {
    const reason = window.prompt("Reason for suspending this agent:");
    if (!reason) return;
    setActing(true);
    setError("");
    setNotice("");
    try {
      const res = await fetch(`/api/admin/referral-agents/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "suspended", reason }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error?.message || "Failed to suspend agent.");
      setNotice("Agent suspended — they have been notified.");
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to suspend agent.");
    } finally {
      setActing(false);
    }
  };

  const reactivate = async () => {
    if (!window.confirm("Reactivate this agent? They'll be able to earn new commissions again.")) return;
    setActing(true);
    setError("");
    setNotice("");
    try {
      const res = await fetch(`/api/admin/referral-agents/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "active" }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error?.message || "Failed to reactivate agent.");
      setNotice("Agent reactivated.");
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reactivate agent.");
    } finally {
      setActing(false);
    }
  };

  const { page, setPage, totalPages, paged, total, pageSize } = usePagination(agent?.candidates ?? []);

  if (loading) {
    return (
      <PortalShell roleLabel="Management" navItems={MANAGEMENT_NAV_ITEMS}>
        <p className="text-midnight-900/50">Loading…</p>
      </PortalShell>
    );
  }

  if (!agent) {
    return (
      <PortalShell roleLabel="Management" navItems={MANAGEMENT_NAV_ITEMS}>
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4 text-sm">{error || "Referral agent not found."}</div>
      </PortalShell>
    );
  }

  return (
    <PortalShell roleLabel="Management" navItems={MANAGEMENT_NAV_ITEMS}>
      <div className="flex items-center justify-between mb-2">
        <div>
          <p className="eyebrow mb-3">
            <span className="eyebrow-rule" />
            {agent.countryRef?.name ?? agent.country}
          </p>
          <h1 className="section-title text-3xl md:text-4xl mb-2">{agent.full_name}</h1>
        </div>
        <Link href="/management/referral-agents" className="text-sm font-medium text-midnight-900/50 hover:text-gold-600">
          ← Back to Referral Agents
        </Link>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4 text-sm mb-6">{error}</div>}
      {notice && <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-lg p-4 text-sm mb-6">{notice}</div>}

      <div className="card p-6 mb-8 flex items-center justify-between flex-wrap gap-4">
        <div>
          <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold ${STATUS_STYLES[agent.status] ?? "bg-slate-100 text-slate-700"}`}>
            {agent.status.replace(/_/g, " ")}
          </span>
          {!agent.email_verified && (
            <span className="ml-2 inline-flex items-center gap-1 text-xs font-semibold text-amber-600">
              <WarningCircle size={13} weight="fill" /> Email not verified yet
            </span>
          )}
          {agent.rejection_reason && <p className="text-xs text-midnight-900/50 mt-2">Rejected: {agent.rejection_reason}</p>}
          {agent.suspended_reason && <p className="text-xs text-midnight-900/50 mt-2">Suspended: {agent.suspended_reason}</p>}
        </div>
        <div className="flex items-center gap-3">
          {agent.status === "pending_approval" && (
            <>
              <button onClick={reject} disabled={acting} className="btn-secondary text-xs disabled:opacity-60 flex items-center gap-1.5">
                <Trash size={14} weight="regular" /> Reject
              </button>
              <button onClick={approve} disabled={acting || !agent.email_verified} title={!agent.email_verified ? "Applicant hasn't verified their email yet" : undefined} className="btn-primary text-xs disabled:opacity-60 flex items-center gap-1.5">
                <CheckCircle size={14} weight="fill" /> {acting ? "Approving…" : "Approve"}
              </button>
            </>
          )}
          {agent.status === "active" && (
            <button onClick={suspend} disabled={acting} className="btn-secondary text-xs disabled:opacity-60">
              Suspend
            </button>
          )}
          {agent.status === "suspended" && (
            <button onClick={reactivate} disabled={acting} className="btn-primary text-xs disabled:opacity-60">
              Reactivate
            </button>
          )}
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-6 mb-8">
        <div className="card p-6">
          <h2 className="text-xs font-semibold text-midnight-900/50 uppercase tracking-wider mb-4">Details</h2>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between"><dt className="text-midnight-900/50">Email</dt><dd className="text-midnight-900">{agent.email}</dd></div>
            <div className="flex justify-between"><dt className="text-midnight-900/50">Phone</dt><dd className="text-midnight-900">{agent.phone}</dd></div>
            {agent.whatsapp_number && <div className="flex justify-between"><dt className="text-midnight-900/50">WhatsApp</dt><dd className="text-midnight-900">{agent.whatsapp_number}</dd></div>}
            {agent.city && <div className="flex justify-between"><dt className="text-midnight-900/50">City</dt><dd className="text-midnight-900">{agent.city}</dd></div>}
            <div className="flex justify-between"><dt className="text-midnight-900/50">Referral Code</dt><dd className="text-midnight-900 font-mono text-xs">{agent.referral_code}</dd></div>
            {agent.network_size !== null && <div className="flex justify-between"><dt className="text-midnight-900/50">Est. Network Size</dt><dd className="text-midnight-900">{agent.network_size}</dd></div>}
          </dl>
          {agent.promotion_plan && (
            <div className="mt-4 pt-4 border-t border-midnight-900/10">
              <dt className="text-xs text-midnight-900/50 mb-1">Promotion Plan</dt>
              <dd className="text-sm text-midnight-900">{agent.promotion_plan}</dd>
            </div>
          )}
          {agent.previous_experience && (
            <div className="mt-4 pt-4 border-t border-midnight-900/10">
              <dt className="text-xs text-midnight-900/50 mb-1">Previous Experience</dt>
              <dd className="text-sm text-midnight-900">{agent.previous_experience}</dd>
            </div>
          )}
        </div>

        <div className="card p-6">
          <h2 className="text-xs font-semibold text-midnight-900/50 uppercase tracking-wider mb-4">Recent Commissions</h2>
          {agent.commissions.length === 0 ? (
            <p className="text-sm text-midnight-900/50">No commissions generated yet.</p>
          ) : (
            <div className="space-y-3">
              {agent.commissions.slice(0, 8).map((c) => (
                <div key={c.id} className="flex items-center justify-between text-sm">
                  <div>
                    <div className="text-midnight-900">{c.candidate.full_name ?? "— unnamed —"}</div>
                    <div className="text-xs text-midnight-900/45">{MILESTONE_LABELS[c.milestone] ?? c.milestone}</div>
                  </div>
                  <div className="text-right">
                    <div className="font-medium text-midnight-900">{new Intl.NumberFormat("en-US", { style: "currency", currency: c.currency }).format(c.amount)}</div>
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ${COMMISSION_STATUS_STYLES[c.status] ?? "bg-slate-100 text-slate-700"}`}>
                      {c.status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="card p-6 mb-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xs font-semibold text-midnight-900/50 uppercase tracking-wider">Referral Targets</h2>
          <button onClick={() => setShowTargetForm((s) => !s)} className="text-xs font-medium text-gold-600 hover:underline">
            {showTargetForm ? "Cancel" : "Set New Target"}
          </button>
        </div>

        {showTargetForm && (
          <form onSubmit={createTarget} className="grid sm:grid-cols-4 gap-3 mb-4 items-end">
            <div>
              <label className="block text-xs font-medium text-midnight-900/60 mb-1.5">Period Start</label>
              <input type="date" required value={targetForm.period_start} onChange={(e) => setTargetForm({ ...targetForm, period_start: e.target.value })} className="input-field text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-midnight-900/60 mb-1.5">Period End</label>
              <input type="date" required value={targetForm.period_end} onChange={(e) => setTargetForm({ ...targetForm, period_end: e.target.value })} className="input-field text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-midnight-900/60 mb-1.5">Target Referrals</label>
              <input type="number" min={0} required value={targetForm.target_referrals} onChange={(e) => setTargetForm({ ...targetForm, target_referrals: e.target.value })} className="input-field text-sm" />
            </div>
            <button type="submit" disabled={savingTarget} className="btn-primary text-xs disabled:opacity-60">
              {savingTarget ? "Saving…" : "Save Target"}
            </button>
          </form>
        )}

        {targets.length === 0 ? (
          <p className="text-sm text-midnight-900/50">No targets set yet.</p>
        ) : (
          <div className="space-y-2">
            {targets.map((t) => (
              <div key={t.targetId} className="flex items-center justify-between text-sm">
                <div className="text-midnight-900/70">
                  {new Date(t.periodStart).toLocaleDateString()} – {new Date(t.periodEnd).toLocaleDateString()}
                </div>
                <div className="font-medium text-midnight-900">
                  {t.actualReferrals} / {t.targetReferrals} referrals
                  <span className={`ml-2 text-xs font-semibold ${t.actualReferrals >= t.targetReferrals ? "text-emerald-600" : "text-amber-600"}`}>
                    {t.actualReferrals >= t.targetReferrals ? "On track" : "Behind"}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <h2 className="text-sm font-semibold text-midnight-900/50 uppercase tracking-wider mb-3">Referred candidates</h2>

      {agent.candidates.length === 0 ? (
        <div className="card p-10 text-center text-midnight-900/50">No candidates referred yet.</div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-midnight-900/10 text-left text-midnight-900/40 text-xs uppercase tracking-wider">
                <th className="px-5 py-3 font-semibold">Candidate</th>
                <th className="px-5 py-3 font-semibold">Status</th>
                <th className="px-5 py-3 font-semibold">Duplicate?</th>
                <th className="px-5 py-3 font-semibold">Referred</th>
              </tr>
            </thead>
            <tbody>
              {paged.map((c) => (
                <tr key={c.id} className="border-b border-midnight-900/5 last:border-0">
                  <td className="px-5 py-4 font-medium text-midnight-900">{c.full_name ?? "— unnamed —"}</td>
                  <td className="px-5 py-4">
                    <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold bg-slate-100 text-slate-700">
                      {formatCandidateLifecycleStatus(c.lifecycle_status)}
                    </span>
                  </td>
                  <td className="px-5 py-4">
                    {c.referral_duplicate_flag ? (
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-red-600">
                        <WarningCircle size={13} weight="fill" /> Flagged
                      </span>
                    ) : (
                      <span className="text-xs text-midnight-900/35">—</span>
                    )}
                  </td>
                  <td className="px-5 py-4 text-midnight-900/60">{new Date(c.created_at).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="px-5">
            <Pagination page={page} totalPages={totalPages} onPageChange={setPage} total={total} pageSize={pageSize} />
          </div>
        </div>
      )}
    </PortalShell>
  );
}
