"use client";

import { useEffect, useState } from "react";
import PortalShell from "@/components/portal/PortalShell";
import { MANAGEMENT_NAV_ITEMS } from "@/components/portal/managementNav";

// Phase 6 VA Team management (upstream staging) — owned by the same
// partner-manager tier that creates/oversees partner accounts (per the
// business), so this lives under /management with the partner surfaces:
// list the VAs, add a new one (setup invite email), reset a password
// (re-invite), deactivate one and hand its partners over. FastAPI answers
// (vertex_be/app/api/v1/partner_tracking.py).

interface VaRow {
  id: string;
  full_name: string;
  email: string;
  email_verified: boolean;
  is_active: boolean;
  created_at: string;
  partners_assigned: number;
}

export default function VaTeamPage() {
  const [users, setUsers] = useState<VaRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({ full_name: "", email: "" });
  const [resettingId, setResettingId] = useState<string | null>(null);
  // Deactivation + reassignment (phase-6): deactivating a VA moves every
  // partner they manage to a chosen active VA, or leaves them unassigned.
  const [deactivateTarget, setDeactivateTarget] = useState<string | null>(null);
  const [reassignTarget, setReassignTarget] = useState("");
  const [acting, setActing] = useState<string | null>(null);

  const load = () => {
    fetch("/api/admin/va-users")
      .then((r) => r.json())
      .then((res) => {
        setError("");
        setUsers(res.data ?? []);
      })
      .catch(() => setError("Failed to load the VA team."))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setError("");
    setNotice("");
    const res = await fetch("/api/admin/va-users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draft),
    });
    const payload = await res.json().catch(() => ({}));
    setCreating(false);
    if (!res.ok) {
      setError(payload?.error?.message ?? "Failed to create the VA account.");
      return;
    }
    setDraft({ full_name: "", email: "" });
    setNotice("VA account created — an invite email lets them set their own password.");
    load();
  };

  const resetPassword = async (id: string) => {
    setResettingId(id);
    setError("");
    setNotice("");
    const res = await fetch(`/api/admin/va-users/${id}/reset-password`, { method: "POST" });
    const payload = await res.json().catch(() => ({}));
    setResettingId(null);
    if (!res.ok) {
      setError(payload?.error?.message ?? "Failed to reset the password.");
      return;
    }
    setNotice("Password reset — a set-password invite has been emailed.");
  };

  const setActive = async (id: string, is_active: boolean, reassignTo?: string | null) => {
    setActing(id);
    setError("");
    setNotice("");
    const body = is_active
      ? { is_active: true }
      : { is_active: false, reassign_to: reassignTo ?? null };
    const res = await fetch(`/api/admin/va-users/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = await res.json().catch(() => ({}));
    setActing(null);
    if (!res.ok) {
      setError(payload?.error?.message ?? "Failed to update the VA account.");
      return;
    }
    setDeactivateTarget(null);
    setReassignTarget("");
    if (is_active) {
      setNotice("VA reactivated.");
    } else {
      const moved = payload?.data?.reassigned ?? 0;
      setNotice(moved > 0 ? `VA deactivated — ${moved} partner(s) reassigned.` : "VA deactivated.");
    }
    load();
  };

  return (
    <PortalShell roleLabel="Management" navItems={MANAGEMENT_NAV_ITEMS}>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-midnight-900">VA Team</h1>
        <p className="text-sm text-midnight-900/50 mt-1">Virtual Assistants responsible for partner onboarding, reporting and follow-ups — managed here, alongside the partners they own.</p>
      </div>

      {error && <div className="card p-4 mb-6 border-l-4 border-red-400 text-red-700 text-sm">{error}</div>}
      {notice && <div className="card p-4 mb-6 border-l-4 border-emerald-400 text-emerald-700 text-sm">{notice}</div>}

      <div className="card p-6 mb-6">
        <h3 className="font-semibold text-midnight-900 mb-3">Add a Virtual Assistant</h3>
        <form onSubmit={create} className="flex flex-col md:flex-row gap-3">
          <input
            value={draft.full_name}
            onChange={(e) => setDraft((d) => ({ ...d, full_name: e.target.value }))}
            placeholder="Full name"
            className="input-field flex-1"
          />
          <input
            value={draft.email}
            onChange={(e) => setDraft((d) => ({ ...d, email: e.target.value }))}
            placeholder="Email address"
            type="email"
            className="input-field flex-1"
          />
          <button type="submit" disabled={creating || !draft.full_name || !draft.email} className="btn-primary">
            {creating ? "Creating…" : "Create VA account"}
          </button>
        </form>
      </div>

      <div className="card overflow-x-auto">
        {loading ? (
          <div className="p-10 text-center text-midnight-900/50">Loading…</div>
        ) : users.length === 0 ? (
          <div className="p-10 text-center text-midnight-900/50">No Virtual Assistants yet — add the first one above.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-midnight-900/10 text-left text-midnight-900/40 text-xs uppercase tracking-wider">
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Partners assigned</th>
                <th className="px-4 py-3">Created</th>
                <th className="px-4 py-3 text-right">Password</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-b border-midnight-900/5">
                  <td className="px-4 py-3 font-semibold">{u.full_name}</td>
                  <td className="px-4 py-3">{u.email}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`badge ${
                        !u.is_active
                          ? "bg-red-100 text-red-700"
                          : u.email_verified
                            ? "bg-emerald-100 text-emerald-800"
                            : "bg-yellow-100 text-yellow-800"
                      }`}
                    >
                      {!u.is_active ? "Deactivated" : u.email_verified ? "Active" : "Awaiting invite"}
                    </span>
                  </td>
                  <td className="px-4 py-3">{u.partners_assigned}</td>
                  <td className="px-4 py-3">{new Date(u.created_at).toLocaleDateString()}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <button onClick={() => resetPassword(u.id)} disabled={resettingId === u.id} className="btn-secondary text-xs">
                      {resettingId === u.id ? "…" : "Send reset invite"}
                    </button>
                    {u.is_active ? (
                      <>
                        <button
                          onClick={() => {
                            setDeactivateTarget(deactivateTarget === u.id ? null : u.id);
                            setReassignTarget("");
                          }}
                          className="btn-secondary text-xs ml-2 text-red-600"
                        >
                          {deactivateTarget === u.id ? "Cancel" : "Deactivate"}
                        </button>
                        {deactivateTarget === u.id && (
                          <div className="mt-2 flex flex-col md:flex-row gap-2 items-end justify-end">
                            <label className="text-[11px] text-midnight-900/50 text-left">
                              Reassign {u.partners_assigned} partner(s) to
                              <select
                                value={reassignTarget}
                                onChange={(e) => setReassignTarget(e.target.value)}
                                className="input-field mt-1 block w-48 text-xs"
                              >
                                <option value="">Leave unassigned</option>
                                {users.filter((v) => v.id !== u.id && v.is_active).map((v) => (
                                  <option key={v.id} value={v.id}>{v.full_name}</option>
                                ))}
                              </select>
                            </label>
                            <button
                              onClick={() => setActive(u.id, false, reassignTarget || null)}
                              disabled={acting === u.id}
                              className="btn-primary text-xs bg-red-600 hover:bg-red-700"
                            >
                              {acting === u.id ? "…" : "Confirm deactivate"}
                            </button>
                          </div>
                        )}
                      </>
                    ) : (
                      <button onClick={() => setActive(u.id, true)} disabled={acting === u.id} className="btn-secondary text-xs ml-2">
                        {acting === u.id ? "…" : "Reactivate"}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </PortalShell>
  );
}