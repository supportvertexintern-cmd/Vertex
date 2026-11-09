"use client";

// Admin → Monitoring → Locked Accounts (owner's addition 2026-11-07; login
// protection 2026-11-09, 4.1). Two tabs:
//   Now locked: the addresses the per-account sign-in limit holds now. A
//     lockout in a row holds longer (15 minutes, 1 hour, 4 hours, then 24
//     hours and "Needs review"). Actions: Unlock, Unlock and send reset
//     link, Force password reset, Deactivate, Mark reviewed, each with a
//     reason or note, all recorded on the audit trail.
//   History: every lockout in the retention window, with how it ended.
// A lock is keyed by the email typed, so an address with no account can be
// locked too (someone guessing).

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CheckCircle, Envelope, Key, LockOpen, Prohibit, WarningCircle } from "@phosphor-icons/react";
import PortalShell from "@/components/portal/PortalShell";
import { ADMIN_NAV_ITEMS } from "@/components/portal/adminNav";
import FilterBar from "@/components/portal/FilterBar";
import SearchableSelect from "@/components/SearchableSelect";
import Pagination from "@/components/Pagination";
import { useDialog } from "@/components/ui/DialogProvider";
import { LOCKOUT_STEPS, place } from "@/lib/monitoring";

const PAGE_SIZE = 25;

interface Account {
  id: string;
  full_name: string;
  email: string;
  role: string;
  deactivated: boolean;
}

interface Person {
  id: string;
  full_name: string;
}

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
  account: Account | null;
}

interface Lockout {
  id: string;
  email_fp: string;
  account: Account | null;
  step: number;
  locked_at: string;
  locked_until: string;
  failures: number;
  last_ip: string | null;
  last_country: string | null;
  holding: boolean;
  ended_at: string | null;
  ended_by: "expired" | "admin" | "password_reset" | null;
  ended_by_person: Person | null;
  end_reason: string | null;
  needs_review: boolean;
  reviewed_at: string | null;
  reviewed_by: Person | null;
  review_note: string | null;
}

const ENDED: Record<string, string> = {
  holding: "Still locked",
  expired: "Expired",
  admin: "Unlocked by an admin",
  password_reset: "Password reset by the owner",
};

const REFUSED: Record<string, string> = {
  no_account: "no account has this address",
  no_password: "the account has no password yet (send a setup email instead)",
  deactivated: "the account is deactivated",
  email_limited: "the address has had its account emails for now (3 an hour, 6 a day)",
};

function minutes(seconds: number): string {
  const m = Math.ceil(seconds / 60);
  if (m <= 1) return "under a minute";
  if (m < 120) return `${m} minutes`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

function when(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—";
}

async function call(url: string, init?: RequestInit): Promise<Record<string, unknown>> {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const details = body.error?.details;
    const first = details && typeof details === "object" ? Object.values(details).flat()[0] : null;
    throw new Error((typeof first === "string" && first) || body.error?.message || "Something went wrong.");
  }
  return body;
}

const post = (url: string, body: unknown) =>
  call(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

function Who({ account, fp }: { account: Account | null; fp: string }) {
  return account ? (
    <Link href={`/admin/monitoring/accounts?open=${account.id}`} className="hover:underline">
      <div className="font-medium text-midnight-900">{account.full_name}</div>
      <div className="text-xs text-midnight-900/45">{account.email}</div>
    </Link>
  ) : (
    <>
      <div className="text-midnight-900/70">No account with this address</div>
      <div className="text-xs text-midnight-900/40">fingerprint {fp}</div>
    </>
  );
}

function ReviewBadge() {
  return (
    <div className="mt-1 inline-flex items-center gap-1 rounded-full bg-red-50 px-2.5 py-0.5 text-xs font-medium text-red-700">
      <WarningCircle size={14} weight="fill" /> Needs review
    </div>
  );
}

export default function LockedAccountsPage() {
  return (
    <Suspense>
      <LockedAccounts />
    </Suspense>
  );
}

function LockedAccounts() {
  const search = useSearchParams();
  const dialog = useDialog();
  const [tab, setTab] = useState<"now" | "history">(search.get("tab") === "history" ? "history" : "now");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  // Now locked
  const [rows, setRows] = useState<Locked[] | null>(null);
  const loadNow = useCallback(() => {
    call("/api/admin/monitoring/locked")
      .then((body) => {
        setRows((body.data as Locked[]) ?? []);
        setError("");
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load locked accounts."));
  }, []);

  // History
  const [history, setHistory] = useState<Lockout[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [step, setStep] = useState("");
  const [endedBy, setEndedBy] = useState("");
  const [needsReview, setNeedsReview] = useState(search.get("needs_review") ?? "");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const loadHistory = useCallback(() => {
    const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
    for (const [key, value] of Object.entries({ q, step, ended_by: endedBy, needs_review: needsReview, date_from: dateFrom, date_to: dateTo })) {
      if (value) params.set(key, value);
    }
    call(`/api/admin/monitoring/lockouts?${params}`)
      .then((body) => {
        setHistory((body.data as Lockout[]) ?? []);
        setTotal(Number(body.total ?? 0));
        setError("");
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load the history."));
  }, [page, q, step, endedBy, needsReview, dateFrom, dateTo]);

  useEffect(() => {
    if (tab !== "now") return;
    const first = setTimeout(loadNow, 0);
    const every = setInterval(loadNow, 30_000); // locks expire by themselves
    return () => {
      clearTimeout(first);
      clearInterval(every);
    };
  }, [tab, loadNow]);

  useEffect(() => {
    if (tab !== "history") return;
    const timeout = setTimeout(loadHistory, 250); // debounce search-as-you-type
    return () => clearTimeout(timeout);
  }, [tab, loadHistory]);

  const filter = (set: (value: string) => void) => (value: string) => {
    set(value);
    setPage(1);
  };

  const reload = () => (tab === "now" ? loadNow() : loadHistory());

  const act = async (key: string, run: () => Promise<string>) => {
    setBusy(key);
    setError("");
    setNotice("");
    try {
      setNotice(await run());
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(null);
    }
  };

  const unlock = async (row: Locked, sendReset: boolean) => {
    const who = row.account ? `${row.account.full_name} (${row.account.email})` : "this address";
    const reason = await dialog.prompt(
      `Unlock ${who} now${sendReset ? " and email them a password reset link" : ""}? Their next sign-in is checked as usual, and a later lockout starts again at 15 minutes. Why?`,
      { title: sendReset ? "Unlock and send reset link" : "Unlock sign-in", confirmLabel: "Unlock", required: true, multiline: true, placeholder: "Reason (kept on the audit trail)" },
    );
    if (reason === null) return;
    await act(row.email_fp, async () => {
      const body = await post(`/api/admin/monitoring/locked/${row.email_fp}/unlock`, { reason, send_reset: sendReset });
      const data = body.data as { unlocked: boolean; reset_sent: boolean; reset_refused: string | null };
      const lifted = data.unlocked ? `Unlocked ${who}.` : `${who} wasn't locked any more.`;
      if (!sendReset) return lifted;
      return data.reset_sent ? `${lifted} A password reset link was emailed.` : `${lifted} No reset link was sent: ${REFUSED[data.reset_refused ?? ""] ?? data.reset_refused}.`;
    });
  };

  const forceReset = async (account: Account, key: string) => {
    const reason = await dialog.prompt(
      `${account.full_name}'s password stops working now, every session ends, any lockout lifts, and a setup email goes to ${account.email} to choose a new one. Why?`,
      { title: "Force password reset", confirmLabel: "Force reset", danger: true, required: true, multiline: true, placeholder: "Reason (kept on the audit trail)" },
    );
    if (reason === null) return;
    await act(key, async () => {
      await post(`/api/admin/monitoring/accounts/${account.id}/force-reset`, { reason });
      return `${account.full_name}: password cleared and a setup email sent.`;
    });
  };

  const deactivate = async (account: Account, key: string) => {
    const reason = await dialog.prompt(
      `${account.full_name} (${account.email}) won't be able to sign in, and their sessions end now. Why is the account being deactivated?`,
      { title: "Deactivate account", confirmLabel: "Deactivate", danger: true, required: true, multiline: true, placeholder: "Reason (kept on the audit trail)" },
    );
    if (reason === null) return;
    await act(key, async () => {
      await post(`/api/admin/users/${account.id}/deactivate`, { reason });
      return `${account.full_name}: account deactivated.`;
    });
  };

  const review = async (lockoutId: string, who: string) => {
    const note = await dialog.prompt(`Close "Needs review" for ${who}? What did you find?`, {
      title: "Mark reviewed",
      confirmLabel: "Mark reviewed",
      required: true,
      multiline: true,
      placeholder: "Note (kept on the audit trail)",
    });
    if (note === null) return;
    await act(lockoutId, async () => {
      await post(`/api/admin/monitoring/lockouts/${lockoutId}/review`, { note });
      return `Marked reviewed: ${who}.`;
    });
  };

  const actions = (row: Locked) => {
    const a = row.account;
    const key = row.email_fp;
    const off = busy === key;
    const link = "inline-flex items-center gap-1 font-medium hover:underline disabled:opacity-60 whitespace-nowrap";
    return (
      <div className="flex flex-col items-end gap-2 text-xs">
        <button type="button" disabled={off} onClick={() => unlock(row, false)} className="btn-secondary px-4 py-2 text-xs disabled:opacity-60">
          <LockOpen size={16} weight="bold" /> Unlock
        </button>
        {a && (
          <button type="button" disabled={off} onClick={() => unlock(row, true)} className={`${link} text-gold-700`}>
            <Envelope size={14} weight="bold" /> Unlock and send reset link
          </button>
        )}
        {a && a.role !== "candidate" && !a.deactivated && (
          <button type="button" disabled={off} onClick={() => forceReset(a, key)} className={`${link} text-midnight-900/70`}>
            <Key size={14} weight="bold" /> Force password reset
          </button>
        )}
        {a && !a.deactivated && (
          <button type="button" disabled={off} onClick={() => deactivate(a, key)} className={`${link} text-red-600`}>
            <Prohibit size={14} weight="bold" /> Deactivate account
          </button>
        )}
        {row.needs_review && (
          <button type="button" disabled={off} onClick={() => review(row.lockout_id, a ? a.full_name : "this address")} className={`${link} text-red-700`}>
            <CheckCircle size={14} weight="bold" /> Mark reviewed
          </button>
        )}
      </div>
    );
  };

  const tabClass = (t: string) =>
    `px-4 py-2 text-sm font-medium border-b-2 ${tab === t ? "border-gold-500 text-midnight-900" : "border-transparent text-midnight-900/50 hover:text-midnight-900"}`;

  return (
    <PortalShell roleLabel="System Administrator" navItems={ADMIN_NAV_ITEMS}>
      <p className="eyebrow mb-3">
        <span className="eyebrow-rule" />
        Monitoring
      </p>
      <h1 className="section-title text-3xl md:text-4xl mb-2">Locked Accounts</h1>
      <p className="text-midnight-900/55 font-light mb-6 max-w-2xl">
        Accounts held after 10 failed sign-ins in 15 minutes. Lockouts in a row hold longer: 15 minutes, 1 hour, 4 hours,
        then 24 hours, which also flags the account for review. A lock lifts by itself; unlock one sooner, with a reason,
        once you know it&rsquo;s the owner. Refused sign-ins are on the{" "}
        <Link href="/admin/monitoring/audit?action=login_rate_limited" className="underline">
          Audit Trail
        </Link>
        .
      </p>

      <div className="flex gap-2 border-b border-midnight-900/10 mb-6" role="tablist">
        <button type="button" role="tab" aria-selected={tab === "now"} className={tabClass("now")} onClick={() => setTab("now")}>
          Now locked
        </button>
        <button type="button" role="tab" aria-selected={tab === "history"} className={tabClass("history")} onClick={() => setTab("history")}>
          History
        </button>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4 text-sm mb-6">{error}</div>}
      {notice && (
        <div className="mb-6 flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
          <CheckCircle size={18} weight="fill" className="mt-0.5 shrink-0" /> {notice}
        </div>
      )}

      {tab === "now" &&
        (rows === null ? (
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
                  <tr key={r.email_fp} className="border-b border-midnight-900/5 last:border-0 align-top">
                    <td className="px-5 py-4">
                      <Who account={r.account} fp={r.email_fp} />
                    </td>
                    <td className="px-5 py-4 text-midnight-900/70">
                      <div>
                        Step {r.step} · {LOCKOUT_STEPS[r.step] ?? ""}
                      </div>
                      <div className="text-xs text-midnight-900/40">since {when(r.locked_at)}</div>
                      {r.needs_review && <ReviewBadge />}
                    </td>
                    <td className="px-5 py-4 tabular-nums text-midnight-900/70">{r.failures}</td>
                    <td className="px-5 py-4 text-midnight-900/70">{place(r.last_ip, r.last_country)}</td>
                    <td className="px-5 py-4 text-midnight-900/70">{minutes(r.unlocks_in_seconds)}</td>
                    <td className="px-5 py-4">{actions(r)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}

      {tab === "history" && (
        <>
          <FilterBar searchValue={q} onSearchChange={filter(setQ)} searchPlaceholder="Search by account name or email…">
            <SearchableSelect
              value={step}
              onChange={filter(setStep)}
              placeholder="Any step"
              className="input-field w-44"
              options={[{ value: "", label: "Any step" }, ...Object.entries(LOCKOUT_STEPS).map(([value, label]) => ({ value, label: `Step ${value} · ${label}` }))]}
            />
            <SearchableSelect
              value={endedBy}
              onChange={filter(setEndedBy)}
              placeholder="However it ended"
              className="input-field w-56"
              options={[{ value: "", label: "However it ended" }, ...Object.entries(ENDED).map(([value, label]) => ({ value, label }))]}
            />
            <SearchableSelect
              value={needsReview}
              onChange={filter(setNeedsReview)}
              placeholder="Any review state"
              className="input-field w-48"
              options={[
                { value: "", label: "Any review state" },
                { value: "true", label: "Needs review" },
                { value: "false", label: "No review needed" },
              ]}
            />
            <label className="flex items-center gap-2 text-xs text-midnight-900/50">
              From
              <input type="date" value={dateFrom} onChange={(e) => filter(setDateFrom)(e.target.value)} className="input-field py-2 text-xs w-40" />
            </label>
            <label className="flex items-center gap-2 text-xs text-midnight-900/50">
              to
              <input type="date" value={dateTo} onChange={(e) => filter(setDateTo)(e.target.value)} className="input-field py-2 text-xs w-40" />
            </label>
          </FilterBar>

          {history === null ? (
            !error && <p className="text-midnight-900/50">Loading…</p>
          ) : history.length === 0 ? (
            <div className="card p-10 text-center text-midnight-900/50">No lockouts match.</div>
          ) : (
            <div className="card overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-midnight-900/10 text-left text-midnight-900/40 text-xs uppercase tracking-wider">
                    <th className="px-5 py-3 font-semibold">Account</th>
                    <th className="px-5 py-3 font-semibold">Lockout</th>
                    <th className="px-5 py-3 font-semibold">Failures · address</th>
                    <th className="px-5 py-3 font-semibold">How it ended</th>
                    <th className="px-5 py-3 font-semibold">Review</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((h) => (
                    <tr key={h.id} className="border-b border-midnight-900/5 last:border-0 align-top">
                      <td className="px-5 py-4">
                        <Who account={h.account} fp={h.email_fp} />
                      </td>
                      <td className="px-5 py-4 text-midnight-900/70">
                        <div>
                          Step {h.step} · {LOCKOUT_STEPS[h.step] ?? ""}
                        </div>
                        <div className="text-xs text-midnight-900/40">{when(h.locked_at)}</div>
                      </td>
                      <td className="px-5 py-4 text-midnight-900/70">
                        <div className="tabular-nums">{h.failures}</div>
                        <div className="text-xs text-midnight-900/40">{place(h.last_ip, h.last_country)}</div>
                      </td>
                      <td className="px-5 py-4 text-midnight-900/70">
                        <div>{h.holding ? ENDED.holding : ENDED[h.ended_by ?? "expired"]}</div>
                        {h.ended_at && <div className="text-xs text-midnight-900/40">{when(h.ended_at)}</div>}
                        {h.ended_by_person && h.ended_by === "admin" && (
                          <div className="text-xs text-midnight-900/40">by {h.ended_by_person.full_name}</div>
                        )}
                        {h.end_reason && <div className="text-xs text-midnight-900/55 mt-1">&ldquo;{h.end_reason}&rdquo;</div>}
                      </td>
                      <td className="px-5 py-4 text-midnight-900/70">
                        {h.needs_review && !h.reviewed_at && (
                          <>
                            <ReviewBadge />
                            <div className="mt-2">
                              <button
                                type="button"
                                disabled={busy === h.id}
                                onClick={() => review(h.id, h.account ? h.account.full_name : "this address")}
                                className="text-xs font-medium text-red-700 hover:underline disabled:opacity-60"
                              >
                                Mark reviewed
                              </button>
                            </div>
                          </>
                        )}
                        {h.reviewed_at && (
                          <>
                            <div className="text-xs">
                              Reviewed {when(h.reviewed_at)}
                              {h.reviewed_by ? ` by ${h.reviewed_by.full_name}` : ""}
                            </div>
                            {h.review_note && <div className="text-xs text-midnight-900/55 mt-1">&ldquo;{h.review_note}&rdquo;</div>}
                          </>
                        )}
                        {!h.needs_review && <span className="text-midnight-900/30">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Pagination page={page} totalPages={Math.max(1, Math.ceil(total / PAGE_SIZE))} onPageChange={setPage} total={total} pageSize={PAGE_SIZE} />
        </>
      )}
    </PortalShell>
  );
}
