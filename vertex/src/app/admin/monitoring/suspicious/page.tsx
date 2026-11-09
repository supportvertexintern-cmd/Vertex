"use client";

// Admin → Monitoring → Suspicious Activity (owner's requirements 2026-11-07,
// phase 2): every alert the security monitor raised, as a list to review,
// not only as emails. An admin marks one reviewing, then resolved or
// dismissed (a false positive) with a note, and can act on its account
// from here: open it, end its sessions, or deactivate it. FastAPI decides
// the rules and audits each change (vertex_be/app/api/v1/monitoring.py).

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CheckCircle, Eye, Prohibit, SignOut, X } from "@phosphor-icons/react";
import PortalShell from "@/components/portal/PortalShell";
import { ADMIN_NAV_ITEMS } from "@/components/portal/adminNav";
import SearchableSelect from "@/components/SearchableSelect";
import Pagination from "@/components/Pagination";
import { useDialog } from "@/components/ui/DialogProvider";
import { GEOIP_CREDIT, place } from "@/lib/monitoring";

const PAGE_SIZE = 25;

type Severity = "critical" | "high" | "medium";
type Status = "open" | "reviewing" | "resolved" | "dismissed";

const SEVERITY: Record<Severity, { label: string; badge: string }> = {
  critical: { label: "Critical", badge: "bg-red-600 text-white" },
  high: { label: "High", badge: "bg-orange-100 text-orange-800" },
  medium: { label: "Medium", badge: "bg-amber-50 text-amber-800" },
};

const STATUS: Record<Status, { label: string; badge: string }> = {
  open: { label: "Open", badge: "bg-red-50 text-red-700" },
  reviewing: { label: "Reviewing", badge: "bg-sky-50 text-sky-700" },
  resolved: { label: "Resolved", badge: "bg-emerald-50 text-emerald-700" },
  dismissed: { label: "Dismissed", badge: "bg-midnight-900/5 text-midnight-900/60" },
};

// The monitor's rules (app/services/security_monitor.py), as people say them.
const RULES: Record<string, string> = {
  brute_force_account: "Brute force on an account",
  brute_force_ip: "Brute force from an address",
  authorization_probing: "Authorization probing",
  refresh_token_reused: "Stolen session token",
  malware_detected: "Malware upload or download",
  privilege_granted: "Privilege granted",
  audit_write_failed: "Audit trail write failed",
  malware_scanner_unavailable: "Malware scanner unavailable",
  shared_ip_sign_ins: "Many accounts from one address",
  sign_in_after_reset_new_ip: "New address after a password reset",
  partner_login_not_activated: "Partner login not activated",
  inactive_account: "Inactive login",
  sign_in_new_country: "Sign-in from a new country",
  rapid_sign_ins: "Signing in again and again",
  unusual_read_rate: "Reading data faster than a person",
  unusual_write_rate: "Changing data faster than a person",
  reset_email_flood: "Reset emails flooding one inbox",
};

const VIEWS = {
  unreviewed: { label: "Needs review", statuses: ["open", "reviewing"] },
  open: { label: "Open", statuses: ["open"] },
  reviewing: { label: "Reviewing", statuses: ["reviewing"] },
  resolved: { label: "Resolved", statuses: ["resolved"] },
  dismissed: { label: "Dismissed", statuses: ["dismissed"] },
  all: { label: "All", statuses: [] },
} as const;
type View = keyof typeof VIEWS;

interface AlertAccount {
  id: string;
  full_name: string;
  email: string;
  role: string;
  deactivated: boolean;
}

interface Alert {
  id: string;
  rule: string;
  severity: Severity;
  summary: string;
  account: AlertAccount | null;
  ip: string | null;
  country: string | null;
  detail: Record<string, unknown> | null;
  status: Status;
  reviewed_by: { id: string; full_name: string } | null;
  reviewed_at: string | null;
  note: string | null;
  created_at: string;
}

function when(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—";
}

const ruleLabel = (rule: string) => RULES[rule] ?? rule.replace(/_/g, " ");

async function call(url: string, init?: RequestInit): Promise<Record<string, unknown>> {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const details = body.error?.details;
    const first = details && typeof details === "object" ? (Object.values(details)[0] as unknown) : null;
    throw new Error((Array.isArray(first) && first[0]) || body.error?.message || "Something went wrong.");
  }
  return body;
}

function Badge({ className, children }: { className: string; children: React.ReactNode }) {
  return <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${className}`}>{children}</span>;
}

export default function SuspiciousActivityPage() {
  return (
    <Suspense>
      <SuspiciousActivity />
    </Suspense>
  );
}

function SuspiciousActivity() {
  // ?user=<id>: one account's alerts, from its Flags in User Accounts.
  const userId = useSearchParams().get("user") ?? "";
  const [rows, setRows] = useState<Alert[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [view, setView] = useState<View>(userId ? "all" : "unreviewed");
  const [severity, setSeverity] = useState("");
  const [rule, setRule] = useState("");
  const [rules, setRules] = useState<string[]>([]);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<Alert | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
    for (const s of VIEWS[view].statuses) params.append("status", s);
    for (const [key, value] of Object.entries({ severity, rule, user_id: userId, date_from: dateFrom, date_to: dateTo })) {
      if (value) params.set(key, value);
    }
    call(`/api/admin/monitoring/alerts?${params}`)
      .then((body) => {
        setRows((body.data as Alert[]) ?? []);
        setTotal(Number(body.total ?? 0));
        setError("");
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load alerts."))
      .finally(() => setLoading(false));
  }, [view, severity, rule, userId, dateFrom, dateTo, page]);

  useEffect(() => {
    const timeout = setTimeout(load, 0); // after the render that changed a filter
    return () => clearTimeout(timeout);
  }, [load]);

  useEffect(() => {
    call("/api/admin/monitoring/alerts/rules")
      .then((body) => setRules((body.data as string[]) ?? []))
      .catch(() => {});
  }, []);

  const filter = <T,>(set: (value: T) => void) => (value: T) => {
    set(value);
    setPage(1);
  };

  const ruleOptions = Array.from(new Set([...Object.keys(RULES), ...rules]));

  return (
    <PortalShell roleLabel="System Administrator" navItems={ADMIN_NAV_ITEMS}>
      <p className="eyebrow mb-3">
        <span className="eyebrow-rule" />
        Monitoring
      </p>
      <h1 className="section-title text-3xl md:text-4xl mb-2">Suspicious Activity</h1>
      <p className="text-midnight-900/55 font-light mb-8 max-w-2xl">
        Every alert the security monitor raises, as well as its email. Mark one reviewing while you look into it, then
        resolve it or dismiss it as a false positive, with a note. Each change is kept on the audit trail.
      </p>

      {userId && (
        <div className="mb-6 flex items-center justify-between gap-4 rounded-lg border border-midnight-900/10 bg-ivory-100 px-4 py-3 text-sm">
          <span>Showing one account&rsquo;s alerts.</span>
          <Link href="/admin/monitoring/suspicious" className="text-gold-700 underline">
            Show every account
          </Link>
        </div>
      )}

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4 text-sm mb-6">{error}</div>}

      <div className="mb-4 flex flex-wrap gap-2" role="tablist" aria-label="Status">
        {(Object.keys(VIEWS) as View[]).map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={view === key}
            onClick={() => filter(setView)(key)}
            className={`rounded-full px-4 py-1.5 text-xs font-medium transition-colors ${
              view === key ? "bg-midnight-950 text-ivory-50" : "bg-white text-midnight-900/60 border border-midnight-900/10 hover:text-midnight-900"
            }`}
          >
            {VIEWS[key].label}
          </button>
        ))}
      </div>

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <SearchableSelect
          value={severity}
          onChange={filter(setSeverity)}
          placeholder="Any severity"
          className="input-field w-44"
          options={[{ value: "", label: "Any severity" }, ...Object.entries(SEVERITY).map(([value, s]) => ({ value, label: s.label }))]}
        />
        <SearchableSelect
          value={rule}
          onChange={filter(setRule)}
          placeholder="Any type"
          className="input-field w-64"
          options={[{ value: "", label: "Any type" }, ...ruleOptions.map((value) => ({ value, label: ruleLabel(value) }))]}
        />
        <label className="flex items-center gap-2 text-xs text-midnight-900/50">
          From
          <input type="date" value={dateFrom} onChange={(e) => filter(setDateFrom)(e.target.value)} className="input-field py-2 text-xs w-40" />
        </label>
        <label className="flex items-center gap-2 text-xs text-midnight-900/50">
          to
          <input type="date" value={dateTo} onChange={(e) => filter(setDateTo)(e.target.value)} className="input-field py-2 text-xs w-40" />
        </label>
      </div>

      {loading && rows.length === 0 ? (
        <p className="text-midnight-900/50">Loading…</p>
      ) : rows.length === 0 ? (
        <div className="card p-10 text-center text-midnight-900/50">
          {view === "unreviewed" ? "Nothing needs review." : "No matching alerts."}
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-midnight-900/10 text-left text-midnight-900/40 text-xs uppercase tracking-wider">
                <th className="px-5 py-3 font-semibold">Time</th>
                <th className="px-5 py-3 font-semibold">Severity</th>
                <th className="px-5 py-3 font-semibold">Type</th>
                <th className="px-5 py-3 font-semibold">Account</th>
                <th className="px-5 py-3 font-semibold">Address</th>
                <th className="px-5 py-3 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id} onClick={() => setOpen(a)} className="border-b border-midnight-900/5 last:border-0 cursor-pointer hover:bg-ivory-100/60 align-top">
                  <td className="px-5 py-4 whitespace-nowrap text-midnight-900/70">{when(a.created_at)}</td>
                  <td className="px-5 py-4">
                    <Badge className={SEVERITY[a.severity].badge}>{SEVERITY[a.severity].label}</Badge>
                  </td>
                  <td className="px-5 py-4">
                    <button type="button" className="text-left" onClick={() => setOpen(a)}>
                      <div className="font-medium text-midnight-900">{ruleLabel(a.rule)}</div>
                      <div className="text-xs text-midnight-900/45">{a.summary}</div>
                    </button>
                  </td>
                  <td className="px-5 py-4 text-midnight-900/70">
                    {a.account ? (
                      <>
                        <div>{a.account.full_name}</div>
                        <div className="text-xs text-midnight-900/45">{a.account.email}</div>
                      </>
                    ) : (
                      <span className="text-midnight-900/30">—</span>
                    )}
                  </td>
                  <td className="px-5 py-4 text-midnight-900/70">{place(a.ip, a.country)}</td>
                  <td className="px-5 py-4">
                    <Badge className={STATUS[a.status].badge}>{STATUS[a.status].label}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Pagination page={page} totalPages={Math.max(1, Math.ceil(total / PAGE_SIZE))} onPageChange={setPage} total={total} pageSize={PAGE_SIZE} />
      <p className="mt-4 text-xs text-midnight-900/40">{GEOIP_CREDIT}</p>

      {open && (
        <AlertDrawer
          alert={open}
          onClose={() => setOpen(null)}
          onChanged={(next) => {
            if (next) setOpen(next);
            load();
          }}
        />
      )}
    </PortalShell>
  );
}

function AlertDrawer({ alert, onClose, onChanged }: { alert: Alert; onClose: () => void; onChanged: (next?: Alert) => void }) {
  const dialog = useDialog();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

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
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  const review = async (status: Status) => {
    const closing = status === "resolved" || status === "dismissed";
    const reopening = alert.status === "resolved" || alert.status === "dismissed";
    let note: string | null = null;
    if (closing || reopening) {
      note = await dialog.prompt(
        status === "resolved"
          ? "What did you find, and what was done?"
          : status === "dismissed"
            ? "Why is this a false positive?"
            : "Why is this being looked at again?",
        {
          title: status === "resolved" ? "Resolve alert" : status === "dismissed" ? "Dismiss alert" : "Reopen alert",
          confirmLabel: status === "resolved" ? "Resolve" : status === "dismissed" ? "Dismiss" : "Reopen",
          required: true,
          multiline: true,
          placeholder: "Note (kept on the audit trail)",
        },
      );
      if (note === null) return;
    }
    await act(async () => {
      const body = await call(`/api/admin/monitoring/alerts/${alert.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(note === null ? { status } : { status, note }),
      });
      onChanged(body.data as Alert);
      return `Marked ${STATUS[status].label.toLowerCase()}.`;
    });
  };

  const deactivate = async (account: AlertAccount) => {
    const reason = await dialog.prompt(
      `${account.full_name} won't be able to sign in, and every session ends now. Nothing is deleted. Why is this account being deactivated?`,
      {
        title: "Deactivate account",
        confirmLabel: "Deactivate",
        danger: true,
        required: true,
        multiline: true,
        defaultValue: `${ruleLabel(alert.rule)}: ${alert.summary}`,
        placeholder: "Reason (kept on the audit trail)",
      },
    );
    if (reason === null) return;
    await act(async () => {
      const body = await call(`/api/admin/users/${account.id}/deactivate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      const ended = Number((body.data as { ended?: number })?.ended ?? 0);
      onChanged({ ...alert, account: { ...account, deactivated: true } });
      return `Account deactivated. ${ended} session${ended === 1 ? "" : "s"} ended.`;
    });
  };

  const endSessions = async (account: AlertAccount) => {
    if (!(await dialog.confirm(`Sign ${account.full_name} out of every browser and device now?`, { confirmLabel: "Sign out", danger: true }))) return;
    await act(async () => {
      const body = await call(`/api/admin/users/${account.id}/sessions`, { method: "DELETE" });
      const ended = Number((body.data as { ended?: number })?.ended ?? 0);
      return `${ended} session${ended === 1 ? "" : "s"} ended.`;
    });
  };

  const details = Object.entries(alert.detail ?? {}).filter(([key]) => !["severity", "rule", "summary"].includes(key));
  const account = alert.account;

  return (
    <div className="fixed inset-0 z-[60] flex justify-end bg-midnight-950/40" onClick={onClose}>
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="alert-drawer-title"
        className="h-full w-full max-w-xl overflow-y-auto bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-midnight-900/10 bg-white px-6 py-5">
          <div className="min-w-0">
            <h2 id="alert-drawer-title" className="text-lg font-semibold text-midnight-900">
              {ruleLabel(alert.rule)}
            </h2>
            <p className="text-sm text-midnight-900/55">{alert.summary}</p>
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

          <dl className="grid grid-cols-[auto,1fr] gap-x-6 gap-y-2 text-sm">
            <dt className="text-midnight-900/45">Raised</dt>
            <dd className="text-midnight-900">{when(alert.created_at)}</dd>
            <dt className="text-midnight-900/45">Severity</dt>
            <dd>
              <Badge className={SEVERITY[alert.severity].badge}>{SEVERITY[alert.severity].label}</Badge>
            </dd>
            <dt className="text-midnight-900/45">Status</dt>
            <dd>
              <Badge className={STATUS[alert.status].badge}>{STATUS[alert.status].label}</Badge>
              {alert.reviewed_by && (
                <span className="ml-2 text-xs text-midnight-900/50">
                  by {alert.reviewed_by.full_name}, {when(alert.reviewed_at)}
                </span>
              )}
            </dd>
            {alert.note && (
              <>
                <dt className="text-midnight-900/45">Note</dt>
                <dd className="whitespace-pre-wrap text-midnight-900">{alert.note}</dd>
              </>
            )}
            <dt className="text-midnight-900/45">Address</dt>
            <dd className="text-midnight-900">{place(alert.ip, alert.country)}</dd>
            <dt className="text-midnight-900/45">Account</dt>
            <dd className="text-midnight-900">
              {account ? (
                <>
                  {account.full_name} <span className="text-midnight-900/50">({account.email})</span>
                  {account.deactivated && <Badge className="ml-2 bg-red-50 text-red-700">Deactivated</Badge>}
                </>
              ) : (
                "No account identified"
              )}
            </dd>
          </dl>

          <section className="flex flex-wrap gap-2">
            {alert.status === "open" && (
              <button type="button" disabled={busy} onClick={() => review("reviewing")} className="btn-secondary px-4 py-2 text-xs disabled:opacity-60">
                <Eye size={16} weight="bold" /> Mark reviewing
              </button>
            )}
            {(alert.status === "open" || alert.status === "reviewing") && (
              <>
                <button type="button" disabled={busy} onClick={() => review("resolved")} className="btn-primary px-4 py-2 text-xs disabled:opacity-60">
                  <CheckCircle size={16} weight="bold" /> Resolve
                </button>
                <button type="button" disabled={busy} onClick={() => review("dismissed")} className="btn-secondary px-4 py-2 text-xs disabled:opacity-60">
                  Dismiss as false positive
                </button>
              </>
            )}
            {(alert.status === "resolved" || alert.status === "dismissed") && (
              <button type="button" disabled={busy} onClick={() => review("reviewing")} className="btn-secondary px-4 py-2 text-xs disabled:opacity-60">
                Reopen
              </button>
            )}
          </section>

          {account && (
            <section>
              <h3 className="mb-3 text-sm font-semibold text-midnight-900">The account</h3>
              <div className="flex flex-wrap gap-2">
                <Link href={`/admin/monitoring/accounts?open=${account.id}`} className="btn-secondary px-4 py-2 text-xs">
                  Open account
                </Link>
                {!account.deactivated && (
                  <>
                    <button type="button" disabled={busy} onClick={() => endSessions(account)} className="btn-secondary px-4 py-2 text-xs disabled:opacity-60">
                      <SignOut size={16} weight="bold" /> End its sessions
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => deactivate(account)}
                      className="inline-flex items-center gap-2 rounded-xl bg-red-600 px-4 py-2 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-60"
                    >
                      <Prohibit size={16} weight="bold" /> Deactivate account
                    </button>
                  </>
                )}
              </div>
            </section>
          )}

          {details.length > 0 && (
            <section>
              <h3 className="mb-3 text-sm font-semibold text-midnight-900">Details</h3>
              <dl className="grid grid-cols-[auto,1fr] gap-x-6 gap-y-1.5 rounded-xl border border-midnight-900/10 p-4 text-xs">
                {details.map(([key, value]) => (
                  <div key={key} className="contents">
                    <dt className="text-midnight-900/45">{key.replace(/_/g, " ")}</dt>
                    <dd className="break-all text-midnight-900/80">{typeof value === "string" ? value : JSON.stringify(value)}</dd>
                  </div>
                ))}
              </dl>
            </section>
          )}
        </div>
      </aside>
    </div>
  );
}
