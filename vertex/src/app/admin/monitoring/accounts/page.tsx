"use client";

// Admin → Monitoring → User Accounts (owner's requirements 2026-11-07,
// phase 1): every staff, partner and referral-agent login in one list, with
// its status, who created it and its latest sign-in; an account's sessions
// and sign-in history; and deactivate / reactivate, each with a reason.
// FastAPI decides every rule (vertex_be/app/api/v1/monitoring.py, users.py):
// nobody deactivates themselves or the last active admin, and reactivating
// never shows a partner the first-time welcome again.

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CheckCircle, Copy, EnvelopeSimple, Flag, Key, Prohibit, SignOut, UserCheck, X } from "@phosphor-icons/react";
import PortalShell from "@/components/portal/PortalShell";
import { ADMIN_NAV_ITEMS } from "@/components/portal/adminNav";
import FilterBar from "@/components/portal/FilterBar";
import SearchableSelect from "@/components/SearchableSelect";
import SortableTh from "@/components/SortableTh";
import Pagination from "@/components/Pagination";
import { useDialog } from "@/components/ui/DialogProvider";

const PAGE_SIZE = 25;

const ROLE_LABELS: Record<string, string> = {
  regional_recruiter: "Regional Recruiter",
  country_supervisor: "Country Supervisor",
  inhouse_supervisor: "In-House Supervisor",
  director: "Director",
  marketing: "Marketing",
  hr: "HR",
  operations_team: "Operations Team",
  operations_director: "Operations Director",
  finance: "Finance",
  admin: "System Administrator",
  partner: "Partner",
  referral_agent: "Referral Agent",
};

type Status = "not_activated" | "active" | "deactivated";

const STATUS: Record<Status, { label: string; badge: string }> = {
  active: { label: "Active", badge: "bg-emerald-50 text-emerald-700" },
  not_activated: { label: "Not yet activated", badge: "bg-amber-50 text-amber-700" },
  deactivated: { label: "Deactivated", badge: "bg-red-50 text-red-700" },
};

interface Person {
  id: string;
  full_name: string;
}

interface Account {
  id: string;
  full_name: string;
  email: string;
  role: string;
  agency: string | null;
  agency_id: string | null;
  status: Status;
  password_set: boolean;
  activated_at: string | null;
  created_at: string;
  created_by: Person | null;
  last_sign_in_at: string | null;
  last_sign_in_ip: string | null;
  active_sessions: number;
  deactivated_at: string | null;
  deactivated_by: Person | null;
  deactivation_reason: string | null;
  open_alerts: number;
}

interface SessionRow {
  id: string;
  device: string | null;
  started_at: string;
  last_active_at: string;
  expires_at: string;
}

interface SignIn {
  at: string;
  succeeded: boolean;
  method: string | null;
  reason: string | null;
  ip: string | null;
  device: string | null;
}

interface AccountDetail extends Account {
  sessions: SessionRow[];
  sign_ins: SignIn[];
}

const REFUSALS: Record<string, string> = {
  bad_password: "Wrong password",
  no_password_set: "No password set yet",
  email_unverified: "Email not verified",
  deactivated: "Account deactivated",
  unknown_account: "Unknown account",
  google_email_unverified: "Google email not verified",
  google_account_mismatch: "Another Google account",
};

function when(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—";
}

function roleLabel(a: Pick<Account, "role" | "agency">): string {
  const label = ROLE_LABELS[a.role] ?? a.role;
  return a.agency ? `${label} · ${a.agency}` : label;
}

async function call(url: string, init?: RequestInit): Promise<Record<string, unknown>> {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const details = body.error?.details?.reason;
    throw new Error((Array.isArray(details) && details[0]) || body.error?.message || "Something went wrong.");
  }
  return body;
}

function StatusBadge({ status }: { status: Status }) {
  const s = STATUS[status];
  return <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${s.badge}`}>{s.label}</span>;
}

export default function UserAccountsPage() {
  return (
    <Suspense>
      <UserAccounts />
    </Suspense>
  );
}

function UserAccounts() {
  // ?open=<id>: an account opened from elsewhere (a Suspicious Activity item).
  const search = useSearchParams();
  const linked = search.get("open");
  const [rows, setRows] = useState<Account[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [role, setRole] = useState("");
  const [status, setStatus] = useState(search.get("status") ?? "");
  const [inactive, setInactive] = useState("");
  const [createdFrom, setCreatedFrom] = useState("");
  const [createdTo, setCreatedTo] = useState("");
  const [flagged, setFlagged] = useState("");
  const [sort, setSort] = useState("created_at");
  const [direction, setDirection] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(linked);

  const load = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams({ sort, direction, page: String(page), pageSize: String(PAGE_SIZE) });
    for (const [key, value] of Object.entries({ q, role, status, inactive_days: inactive, created_from: createdFrom, created_to: createdTo, flagged })) {
      if (value) params.set(key, value);
    }
    call(`/api/admin/monitoring/accounts?${params}`)
      .then((body) => {
        setRows((body.data as Account[]) ?? []);
        setTotal(Number(body.total ?? 0));
        setError("");
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load accounts."))
      .finally(() => setLoading(false));
  }, [q, role, status, inactive, createdFrom, createdTo, flagged, sort, direction, page]);

  useEffect(() => {
    const timeout = setTimeout(load, 250); // debounce search-as-you-type
    return () => clearTimeout(timeout);
  }, [load]);

  // A new filter starts from the first page.
  const filter = (set: (value: string) => void) => (value: string) => {
    set(value);
    setPage(1);
  };

  const handleSort = (key: string) => {
    if (sort === key) setDirection((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSort(key);
      setDirection(key === "full_name" ? "asc" : "desc");
    }
  };

  return (
    <PortalShell roleLabel="System Administrator" navItems={ADMIN_NAV_ITEMS}>
      <p className="eyebrow mb-3">
        <span className="eyebrow-rule" />
        Monitoring
      </p>
      <h1 className="section-title text-3xl md:text-4xl mb-2">User Accounts</h1>
      <p className="text-midnight-900/55 font-light mb-8 max-w-2xl">
        Every staff, partner and referral-agent login, with its status and latest sign-in. Open an account to see its
        sessions and sign-in history, or to deactivate it: a deactivated account can&rsquo;t sign in and its sessions end
        at once, without deleting anything.
      </p>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4 text-sm mb-6">{error}</div>}

      <FilterBar searchValue={q} onSearchChange={filter(setQ)} searchPlaceholder="Search by name or email…">
        <SearchableSelect
          value={role}
          onChange={filter(setRole)}
          placeholder="All roles"
          className="input-field w-56"
          options={[{ value: "", label: "All roles" }, ...Object.entries(ROLE_LABELS).map(([value, label]) => ({ value, label }))]}
        />
        <SearchableSelect
          value={status}
          onChange={filter(setStatus)}
          placeholder="Any status"
          className="input-field w-48"
          options={[{ value: "", label: "Any status" }, ...Object.entries(STATUS).map(([value, s]) => ({ value, label: s.label }))]}
        />
        <SearchableSelect
          value={inactive}
          onChange={filter(setInactive)}
          placeholder="Any last sign-in"
          className="input-field w-56"
          options={[
            { value: "", label: "Any last sign-in" },
            { value: "30", label: "Not signed in for 30+ days" },
            { value: "60", label: "Not signed in for 60+ days" },
            { value: "90", label: "Not signed in for 90+ days" },
          ]}
        />
        <SearchableSelect
          value={flagged}
          onChange={filter(setFlagged)}
          placeholder="Flagged or not"
          className="input-field w-52"
          options={[
            { value: "", label: "Flagged or not" },
            { value: "true", label: "Has open security flags" },
          ]}
        />
        <label className="flex items-center gap-2 text-xs text-midnight-900/50">
          Created from
          <input type="date" value={createdFrom} onChange={(e) => filter(setCreatedFrom)(e.target.value)} className="input-field py-2 text-xs w-40" />
        </label>
        <label className="flex items-center gap-2 text-xs text-midnight-900/50">
          to
          <input type="date" value={createdTo} onChange={(e) => filter(setCreatedTo)(e.target.value)} className="input-field py-2 text-xs w-40" />
        </label>
      </FilterBar>

      {loading && rows.length === 0 ? (
        <p className="text-midnight-900/50">Loading…</p>
      ) : rows.length === 0 ? (
        <div className="card p-10 text-center text-midnight-900/50">No matching accounts.</div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-midnight-900/10 text-left text-midnight-900/40 text-xs uppercase tracking-wider">
                <SortableTh label="Account" sortKey="full_name" activeSort={sort} activeDir={direction} onSort={handleSort} />
                <th className="px-5 py-3 font-semibold">Role</th>
                <th className="px-5 py-3 font-semibold">Status</th>
                <SortableTh label="Created" sortKey="created_at" activeSort={sort} activeDir={direction} onSort={handleSort} />
                <SortableTh label="Last sign-in" sortKey="last_sign_in_at" activeSort={sort} activeDir={direction} onSort={handleSort} />
                <th className="px-5 py-3 font-semibold text-right">Sessions</th>
                <th className="px-5 py-3 font-semibold text-right">Flags</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr
                  key={a.id}
                  onClick={() => setOpen(a.id)}
                  className="border-b border-midnight-900/5 last:border-0 cursor-pointer hover:bg-ivory-100/60"
                >
                  <td className="px-5 py-4">
                    <button type="button" className="text-left" onClick={() => setOpen(a.id)}>
                      <div className="font-medium text-midnight-900">{a.full_name}</div>
                      <div className="text-xs text-midnight-900/45">{a.email}</div>
                    </button>
                  </td>
                  <td className="px-5 py-4 text-midnight-900/70">{roleLabel(a)}</td>
                  <td className="px-5 py-4">
                    <StatusBadge status={a.status} />
                    {a.status === "active" && a.activated_at && (
                      <div className="text-xs text-midnight-900/40 mt-1">since {when(a.activated_at)}</div>
                    )}
                    {a.status === "not_activated" && (
                      <div className="text-xs text-midnight-900/40 mt-1">{a.password_set ? "Password set" : "Setup email sent"}</div>
                    )}
                  </td>
                  <td className="px-5 py-4 text-midnight-900/70">
                    <div>{when(a.created_at)}</div>
                    <div className="text-xs text-midnight-900/40">{a.created_by ? `by ${a.created_by.full_name}` : ""}</div>
                  </td>
                  <td className="px-5 py-4 text-midnight-900/70">
                    <div>{when(a.last_sign_in_at)}</div>
                    {a.last_sign_in_ip && <div className="text-xs text-midnight-900/40">{a.last_sign_in_ip}</div>}
                  </td>
                  <td className="px-5 py-4 text-right text-midnight-900/70">{a.active_sessions}</td>
                  <td className="px-5 py-4 text-right">
                    {a.open_alerts > 0 ? (
                      <Link
                        href={`/admin/monitoring/suspicious?user=${a.id}`}
                        onClick={(e) => e.stopPropagation()}
                        className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700"
                      >
                        <Flag size={12} weight="fill" /> {a.open_alerts}
                      </Link>
                    ) : (
                      <span className="text-midnight-900/30">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Pagination page={page} totalPages={Math.max(1, Math.ceil(total / PAGE_SIZE))} onPageChange={setPage} total={total} pageSize={PAGE_SIZE} />

      {open && <AccountDrawer id={open} onClose={() => setOpen(null)} onChanged={load} />}
    </PortalShell>
  );
}

function AccountDrawer({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const dialog = useDialog();
  const [account, setAccount] = useState<AccountDetail | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [temporary, setTemporary] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(() => {
    call(`/api/admin/monitoring/accounts/${id}`)
      .then((body) => setAccount(body.data as AccountDetail))
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load the account."));
  }, [id]);

  useEffect(load, [load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const act = async (work: () => Promise<string | void>) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const message = await work();
      if (message) setNotice(message);
      load();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  const post = (path: string, body?: unknown) =>
    call(`/api/admin/users/${id}/${path}`, {
      method: "POST",
      ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    });

  const deactivate = async (a: AccountDetail) => {
    const reason = await dialog.prompt(
      `${a.full_name} won't be able to sign in, and every session ends now. Nothing is deleted. Why is this account being deactivated?`,
      { title: "Deactivate account", confirmLabel: "Deactivate", danger: true, required: true, multiline: true, placeholder: "Reason (kept on the audit trail)" },
    );
    if (reason === null) return;
    await act(async () => {
      const body = await post("deactivate", { reason });
      const ended = Number((body.data as { ended?: number })?.ended ?? 0);
      return `Deactivated. ${ended} session${ended === 1 ? "" : "s"} ended.`;
    });
  };

  const reactivate = async (a: AccountDetail) => {
    const reason = await dialog.prompt(`${a.full_name} will be able to sign in again. Why is this account being reactivated?`, {
      title: "Reactivate account",
      confirmLabel: "Reactivate",
      required: true,
      multiline: true,
      placeholder: "Reason (kept on the audit trail)",
    });
    if (reason === null) return;
    await act(async () => {
      await post("reactivate", { reason });
      return "Reactivated. The account can sign in again.";
    });
  };

  const endAll = async (a: AccountDetail) => {
    if (!(await dialog.confirm(`Sign ${a.full_name} out of every browser and device now?`, { confirmLabel: "Sign out", danger: true }))) return;
    await act(async () => {
      const body = await call(`/api/admin/users/${id}/sessions`, { method: "DELETE" });
      const ended = Number((body.data as { ended?: number })?.ended ?? 0);
      return `${ended} session${ended === 1 ? "" : "s"} ended.`;
    });
  };

  const endOne = async (session: SessionRow) => {
    if (!(await dialog.confirm("End this session? That browser or device is signed out at once.", { confirmLabel: "End session", danger: true }))) return;
    await act(async () => {
      await call(`/api/admin/users/${id}/sessions/${session.id}`, { method: "DELETE" });
      return "Session ended.";
    });
  };

  const resendSetup = async (a: AccountDetail) => {
    await act(async () => {
      await post("setup-email");
      return `Setup email sent to ${a.email}.`;
    });
  };

  const resetPassword = async (a: AccountDetail) => {
    if (!(await dialog.confirm(`Reset the password for ${a.full_name}? Their current password stops working and their sessions end.`, { confirmLabel: "Reset password", danger: true }))) return;
    await act(async () => {
      const body = await call(`/api/admin/users/${id}/reset-password`, { method: "POST" });
      setTemporary(String(body.temporaryPassword ?? ""));
    });
  };

  return (
    <div className="fixed inset-0 z-[60] flex justify-end bg-midnight-950/40" onClick={onClose}>
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="account-drawer-title"
        className="h-full w-full max-w-xl overflow-y-auto bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-midnight-900/10 bg-white px-6 py-5">
          <div className="min-w-0">
            <h2 id="account-drawer-title" className="text-lg font-semibold text-midnight-900 break-words">
              {account?.full_name ?? "Account"}
            </h2>
            {account && <p className="text-sm text-midnight-900/50 break-all">{account.email}</p>}
          </div>
          <button type="button" onClick={onClose} className="p-1 text-midnight-900/40 hover:text-midnight-900" aria-label="Close">
            <X size={20} weight="bold" />
          </button>
        </div>

        <div className="space-y-8 px-6 py-6">
          {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-3 text-sm">{error}</div>}
          {notice && (
            <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
              <CheckCircle size={18} weight="fill" className="mt-0.5 shrink-0" /> {notice}
            </div>
          )}
          {temporary && (
            <div className="card border-l-4 border-gold-400 p-4">
              <p className="mb-2 text-sm text-midnight-900/60">Share this temporary password now. It won&rsquo;t be shown again.</p>
              <div className="flex items-center gap-3">
                <code className="rounded-lg border border-midnight-900/10 bg-ivory-100 px-3 py-1.5 font-mono text-sm">{temporary}</code>
                <button
                  type="button"
                  className="btn-secondary px-3 py-1.5 text-xs"
                  onClick={() => {
                    navigator.clipboard.writeText(temporary);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  }}
                >
                  <Copy size={14} weight="bold" /> {copied ? "Copied!" : "Copy"}
                </button>
              </div>
            </div>
          )}

          {!account ? (
            !error && <p className="text-midnight-900/50">Loading…</p>
          ) : (
            <>
              <section>
                <dl className="grid grid-cols-[auto,1fr] gap-x-6 gap-y-2 text-sm">
                  <dt className="text-midnight-900/45">Status</dt>
                  <dd><StatusBadge status={account.status} /></dd>
                  <dt className="text-midnight-900/45">Role</dt>
                  <dd className="text-midnight-900">
                    {roleLabel(account)}
                    {account.agency_id && (
                      <Link href={`/management/partners/${account.agency_id}`} className="ml-2 text-xs text-gold-700 underline">
                        partner page
                      </Link>
                    )}
                    <Link href={`/admin/monitoring/audit?entity_id=${account.id}`} className="ml-2 text-xs text-gold-700 underline">
                      View history
                    </Link>
                  </dd>
                  <dt className="text-midnight-900/45">Activated</dt>
                  <dd className="text-midnight-900">{account.activated_at ? when(account.activated_at) : "Not yet: no sign-in so far"}</dd>
                  <dt className="text-midnight-900/45">Created</dt>
                  <dd className="text-midnight-900">
                    {when(account.created_at)}
                    {account.created_by && <span className="text-midnight-900/50"> by {account.created_by.full_name}</span>}
                  </dd>
                  <dt className="text-midnight-900/45">Security flags</dt>
                  <dd className="text-midnight-900">
                    {account.open_alerts > 0 ? (
                      <Link href={`/admin/monitoring/suspicious?user=${account.id}`} className="text-red-700 underline">
                        {account.open_alerts} open in Suspicious Activity
                      </Link>
                    ) : (
                      "None open"
                    )}
                  </dd>
                  <dt className="text-midnight-900/45">Last sign-in</dt>
                  <dd className="text-midnight-900">
                    {when(account.last_sign_in_at)}
                    {account.last_sign_in_ip && <span className="text-midnight-900/50"> from {account.last_sign_in_ip}</span>}
                  </dd>
                  {account.status === "deactivated" && (
                    <>
                      <dt className="text-midnight-900/45">Deactivated</dt>
                      <dd className="text-midnight-900">
                        {when(account.deactivated_at)}
                        {account.deactivated_by && <span className="text-midnight-900/50"> by {account.deactivated_by.full_name}</span>}
                        {account.deactivation_reason && (
                          <p className="mt-1 whitespace-pre-wrap text-midnight-900/70">&ldquo;{account.deactivation_reason}&rdquo;</p>
                        )}
                      </dd>
                    </>
                  )}
                </dl>
              </section>

              <section className="flex flex-wrap gap-2">
                {account.status === "deactivated" ? (
                  <button type="button" disabled={busy} onClick={() => reactivate(account)} className="btn-primary px-4 py-2 text-xs disabled:opacity-60">
                    <UserCheck size={16} weight="bold" /> Reactivate
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => deactivate(account)}
                    className="inline-flex items-center gap-2 rounded-xl bg-red-600 px-4 py-2 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-60"
                  >
                    <Prohibit size={16} weight="bold" /> Deactivate
                  </button>
                )}
                {account.status !== "deactivated" && account.sessions.length > 0 && (
                  <button type="button" disabled={busy} onClick={() => endAll(account)} className="btn-secondary px-4 py-2 text-xs disabled:opacity-60">
                    <SignOut size={16} weight="bold" /> End all sessions
                  </button>
                )}
                {account.status !== "deactivated" && !account.password_set && (
                  <button type="button" disabled={busy} onClick={() => resendSetup(account)} className="btn-secondary px-4 py-2 text-xs disabled:opacity-60">
                    <EnvelopeSimple size={16} weight="bold" /> Resend setup email
                  </button>
                )}
                {account.status !== "deactivated" && account.password_set && account.role !== "partner" && (
                  <button type="button" disabled={busy} onClick={() => resetPassword(account)} className="btn-secondary px-4 py-2 text-xs disabled:opacity-60">
                    <Key size={16} weight="bold" /> Reset password
                  </button>
                )}
              </section>
              {account.role === "partner" && account.status !== "deactivated" && account.password_set && (
                <p className="-mt-6 text-xs text-midnight-900/45">A partner&rsquo;s password is reset from its partner page, which emails a new setup link.</p>
              )}

              <section>
                <h3 className="mb-3 text-sm font-semibold text-midnight-900">Active sessions</h3>
                {account.sessions.length === 0 ? (
                  <p className="text-sm text-midnight-900/45">No active sessions.</p>
                ) : (
                  <ul className="divide-y divide-midnight-900/5 rounded-xl border border-midnight-900/10">
                    {account.sessions.map((s) => (
                      <li key={s.id} className="flex items-start justify-between gap-4 px-4 py-3 text-sm">
                        <div className="min-w-0">
                          <div className="truncate text-midnight-900">{s.device ?? "Unknown device"}</div>
                          <div className="text-xs text-midnight-900/45">
                            Signed in {when(s.started_at)} · last active {when(s.last_active_at)}
                          </div>
                        </div>
                        <button type="button" disabled={busy} onClick={() => endOne(s)} className="shrink-0 text-xs font-medium text-red-600 hover:underline disabled:opacity-60">
                          End session
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section>
                <h3 className="mb-1 text-sm font-semibold text-midnight-900">Sign-in history</h3>
                <p className="mb-3 text-xs text-midnight-900/45">The latest 50 sign-ins and refused sign-ins. Opening this is recorded on the audit trail.</p>
                {account.sign_ins.length === 0 ? (
                  <p className="text-sm text-midnight-900/45">No sign-ins recorded.</p>
                ) : (
                  <div className="overflow-x-auto rounded-xl border border-midnight-900/10">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-midnight-900/10 text-left uppercase tracking-wider text-midnight-900/40">
                          <th className="px-3 py-2 font-semibold">When</th>
                          <th className="px-3 py-2 font-semibold">Result</th>
                          <th className="px-3 py-2 font-semibold">Address</th>
                          <th className="px-3 py-2 font-semibold">Device</th>
                        </tr>
                      </thead>
                      <tbody>
                        {account.sign_ins.map((s, i) => (
                          <tr key={`${s.at}-${i}`} className="border-b border-midnight-900/5 last:border-0 align-top">
                            <td className="whitespace-nowrap px-3 py-2 text-midnight-900/70">{when(s.at)}</td>
                            <td className="px-3 py-2">
                              {s.succeeded ? (
                                <span className="text-emerald-700">Signed in{s.method === "google" ? " with Google" : ""}</span>
                              ) : (
                                <span className="text-red-700">Refused: {REFUSALS[s.reason ?? ""] ?? s.reason ?? "unknown"}</span>
                              )}
                            </td>
                            <td className="px-3 py-2 text-midnight-900/70">{s.ip ?? "—"}</td>
                            <td className="max-w-[12rem] truncate px-3 py-2 text-midnight-900/50" title={s.device ?? ""}>
                              {s.device ?? "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </>
          )}
        </div>
      </aside>
    </div>
  );
}
