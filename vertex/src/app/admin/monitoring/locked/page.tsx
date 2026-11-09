"use client";

// Admin → Monitoring → Locked Accounts (owner's addition 2026-11-07): the
// accounts the per-account sign-in limit holds now, after 10 failed sign-ins
// in 15 minutes, and an admin's Unlock, with a reason, recorded on the audit
// trail. Since login protection (2026-11-09) lockouts in a row hold longer:
// 15 minutes, 1 hour, 4 hours, then 24 hours and "needs review". A lock
// is keyed by the email typed, so an address with no account can be locked
// too (someone guessing). Sign-ins refused by a limit are on the Audit Trail
// (action "login rate limited").

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { CheckCircle, LockOpen, WarningCircle } from "@phosphor-icons/react";
import PortalShell from "@/components/portal/PortalShell";
import { ADMIN_NAV_ITEMS } from "@/components/portal/adminNav";
import { useDialog } from "@/components/ui/DialogProvider";
import { place } from "@/lib/monitoring";

const STEPS: Record<number, string> = { 1: "15 minutes", 2: "1 hour", 3: "4 hours", 4: "24 hours" };

interface Locked {
  email_fp: string;
  lockout_id: string;
  failures: number;
  step: number;
  locked_at: string;
  unlocks_in_seconds: number;
  last_ip: string | null;
  last_country: string | null;
  needs_review: boolean;
  account: { id: string; full_name: string; email: string; role: string; deactivated: boolean } | null;
}

function minutes(seconds: number): string {
  const m = Math.ceil(seconds / 60);
  if (m <= 1) return "under a minute";
  if (m < 120) return `${m} minutes`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

export default function LockedAccountsPage() {
  const dialog = useDialog();
  const [rows, setRows] = useState<Locked[] | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch("/api/admin/monitoring/locked")
      .then(async (r) => {
        const body = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(body.error?.message || "Failed to load locked accounts.");
        setRows(body.data ?? []);
        setError("");
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load locked accounts."));
  }, []);

  useEffect(() => {
    const first = setTimeout(load, 0);
    const every = setInterval(load, 30_000); // locks expire by themselves
    return () => {
      clearTimeout(first);
      clearInterval(every);
    };
  }, [load]);

  const unlock = async (row: Locked) => {
    const who = row.account ? `${row.account.full_name} (${row.account.email})` : "this address";
    const reason = await dialog.prompt(
      `Unlock ${who} now? Their next sign-in is checked as usual, and a later lockout starts again at 15 minutes. The failed attempts stay on the audit trail. Why are you unlocking it?`,
      { title: "Unlock sign-in", confirmLabel: "Unlock", required: true, multiline: true, placeholder: "Reason (kept on the audit trail)" },
    );
    if (reason === null) return;
    setBusy(row.email_fp);
    setError("");
    setNotice("");
    try {
      const res = await fetch(`/api/admin/monitoring/locked/${row.email_fp}/unlock`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error?.message || "Failed to unlock.");
      setNotice(body.data?.unlocked ? `Unlocked ${who}.` : `${who} wasn't locked any more.`);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to unlock.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <PortalShell roleLabel="System Administrator" navItems={ADMIN_NAV_ITEMS}>
      <p className="eyebrow mb-3">
        <span className="eyebrow-rule" />
        Monitoring
      </p>
      <h1 className="section-title text-3xl md:text-4xl mb-2">Locked Accounts</h1>
      <p className="text-midnight-900/55 font-light mb-8 max-w-2xl">
        Accounts held after 10 failed sign-ins in 15 minutes. Lockouts in a row hold longer: 15 minutes, 1 hour, 4 hours,
        then 24 hours, which also flags the account for review. A lock lifts by itself; unlock one sooner, with a reason,
        once you know it&rsquo;s the owner. Refused sign-ins are on the{" "}
        <Link href="/admin/monitoring/audit?action=login_rate_limited" className="underline">
          Audit Trail
        </Link>
        .
      </p>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4 text-sm mb-6">{error}</div>}
      {notice && (
        <div className="mb-6 flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
          <CheckCircle size={18} weight="fill" className="mt-0.5 shrink-0" /> {notice}
        </div>
      )}

      {rows === null ? (
        !error && <p className="text-midnight-900/50">Loading…</p>
      ) : rows.length === 0 ? (
        <div className="card p-10 text-center text-midnight-900/50">No account is locked.</div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-midnight-900/10 text-left text-midnight-900/40 text-xs uppercase tracking-wider">
                <th className="px-5 py-3 font-semibold">Account</th>
                <th className="px-5 py-3 font-semibold">Lockout</th>
                <th className="px-5 py-3 font-semibold">Failed sign-ins</th>
                <th className="px-5 py-3 font-semibold">Last address</th>
                <th className="px-5 py-3 font-semibold">Unlocks by itself in</th>
                <th className="px-5 py-3 font-semibold"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.email_fp} className="border-b border-midnight-900/5 last:border-0">
                  <td className="px-5 py-4">
                    {r.account ? (
                      <Link href={`/admin/monitoring/accounts?open=${r.account.id}`} className="hover:underline">
                        <div className="font-medium text-midnight-900">{r.account.full_name}</div>
                        <div className="text-xs text-midnight-900/45">{r.account.email}</div>
                      </Link>
                    ) : (
                      <>
                        <div className="text-midnight-900/70">No account with this address</div>
                        <div className="text-xs text-midnight-900/40">fingerprint {r.email_fp}</div>
                      </>
                    )}
                  </td>
                  <td className="px-5 py-4 text-midnight-900/70">
                    <div>
                      Step {r.step} · {STEPS[r.step] ?? ""}
                    </div>
                    {r.needs_review && (
                      <div className="mt-1 inline-flex items-center gap-1 rounded-full bg-red-50 px-2.5 py-0.5 text-xs font-medium text-red-700">
                        <WarningCircle size={14} weight="fill" /> Needs review
                      </div>
                    )}
                  </td>
                  <td className="px-5 py-4 tabular-nums text-midnight-900/70">{r.failures}</td>
                  <td className="px-5 py-4 text-midnight-900/70">{place(r.last_ip, r.last_country)}</td>
                  <td className="px-5 py-4 text-midnight-900/70">{minutes(r.unlocks_in_seconds)}</td>
                  <td className="px-5 py-4 text-right">
                    <button type="button" disabled={busy === r.email_fp} onClick={() => unlock(r)} className="btn-secondary px-4 py-2 text-xs disabled:opacity-60">
                      <LockOpen size={16} weight="bold" /> Unlock
                    </button>
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
