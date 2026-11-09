"use client";

// Admin → Monitoring → Reset Email Activity (login protection 4.4,
// 2026-11-09): every password-reset, setup and verification email sent or
// refused, with the address it was asked from. Addresses refused 3 or more
// in 24 hours are flagged (someone may be flooding an inbox). An admin can
// resend a reset or setup email by hand, with a reason: no limit counts it,
// and it is recorded. Reading the list is recorded on the audit trail.

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CheckCircle, PaperPlaneTilt, WarningCircle } from "@phosphor-icons/react";
import PortalShell from "@/components/portal/PortalShell";
import { ADMIN_NAV_ITEMS } from "@/components/portal/adminNav";
import FilterBar from "@/components/portal/FilterBar";
import SearchableSelect from "@/components/SearchableSelect";
import Pagination from "@/components/Pagination";
import { useDialog } from "@/components/ui/DialogProvider";
import { GEOIP_CREDIT, place } from "@/lib/monitoring";

const PAGE_SIZE = 50;

type Kind = "password_reset" | "account_setup" | "email_verification";
type Result = "sent" | "refused_email_limit" | "refused_address_limit" | "not_sent";

const KINDS: Record<Kind, string> = { password_reset: "Password reset", account_setup: "Setup", email_verification: "Verification" };

const RESULTS: Record<Result, { label: string; badge: string }> = {
  sent: { label: "Sent", badge: "bg-emerald-50 text-emerald-700" },
  refused_email_limit: { label: "Refused (email limit)", badge: "bg-red-50 text-red-700" },
  refused_address_limit: { label: "Refused (address limit)", badge: "bg-red-50 text-red-700" },
  not_sent: { label: "Nothing sent (no account or no password)", badge: "bg-midnight-900/5 text-midnight-900/60" },
};

interface Account {
  id: string;
  full_name: string;
  email: string;
  role: string;
  deactivated: boolean;
}

interface Row {
  id: string;
  at: string;
  kind: Kind;
  result: Result;
  account: Account | null;
  email_fp: string | null;
  ip: string | null;
  country: string | null;
  manual: boolean;
}

interface Flag {
  email_fp: string;
  account: Account | null;
  refused: number;
}

function when(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

async function call(url: string, init?: RequestInit): Promise<Record<string, unknown>> {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error?.message || "Something went wrong.");
  return body;
}

export default function ResetEmailActivityPage() {
  return (
    <Suspense>
      <ResetEmailActivity />
    </Suspense>
  );
}

function ResetEmailActivity() {
  const search = useSearchParams();
  const dialog = useDialog();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [total, setTotal] = useState(0);
  const [flags, setFlags] = useState<Flag[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState(search.get("q") ?? "");
  const [kind, setKind] = useState(search.get("kind") ?? "");
  const [result, setResult] = useState(search.get("result") ?? "");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const load = useCallback(() => {
    const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
    for (const [key, value] of Object.entries({ q, kind, result, date_from: dateFrom, date_to: dateTo })) {
      if (value) params.set(key, value);
    }
    call(`/api/admin/monitoring/reset-emails?${params}`)
      .then((body) => {
        setRows((body.data as Row[]) ?? []);
        setTotal(Number(body.total ?? 0));
        setError("");
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load reset emails."));
  }, [page, q, kind, result, dateFrom, dateTo]);

  useEffect(() => {
    const timeout = setTimeout(load, 300); // debounce typing
    return () => clearTimeout(timeout);
  }, [load]);

  useEffect(() => {
    call("/api/admin/monitoring/reset-emails/flagged")
      .then((body) => setFlags((body.data as Flag[]) ?? []))
      .catch(() => {});
  }, []);

  const filter = (set: (value: string) => void) => (value: string) => {
    set(value);
    setPage(1);
  };

  const resend = async (account: Account, what: "password_reset" | "account_setup") => {
    const label = what === "password_reset" ? "a password reset link" : "a setup email";
    const reason = await dialog.prompt(
      `Send ${label} to ${account.full_name} (${account.email}) now? No limit counts it. Why?`,
      { title: "Resend by hand", confirmLabel: "Send", required: true, multiline: true, placeholder: "Reason (kept on the audit trail)" },
    );
    if (reason === null) return;
    setBusy(account.id);
    setError("");
    setNotice("");
    try {
      await call("/api/admin/monitoring/reset-emails/resend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: account.id, kind: what, reason }),
      });
      setNotice(`Sent ${label} to ${account.email}.`);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
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
      <h1 className="section-title text-3xl md:text-4xl mb-2">Reset Email Activity</h1>
      <p className="text-midnight-900/55 font-light mb-8 max-w-2xl">
        Every password-reset, setup and verification email sent or refused. One address gets at most 3 reset or setup
        emails an hour and 6 a day; each network address at most 5 reset requests in 15 minutes. Opening this list is
        recorded on the audit trail.
      </p>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4 text-sm mb-6">{error}</div>}
      {notice && (
        <div className="mb-6 flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
          <CheckCircle size={18} weight="fill" className="mt-0.5 shrink-0" /> {notice}
        </div>
      )}

      {flags.length > 0 && (
        <div className="card p-5 mb-8 border border-red-200">
          <p className="flex items-center gap-2 text-sm font-semibold text-red-700 mb-3">
            <WarningCircle size={18} weight="fill" /> Possible inbox flooding: 3 or more refused in the last 24 hours
          </p>
          <ul className="space-y-1 text-sm">
            {flags.map((f) => (
              <li key={f.email_fp} className="flex items-center justify-between gap-4">
                {f.account ? (
                  <button type="button" onClick={() => filter(setQ)(f.account!.email)} className="text-left hover:underline">
                    {f.account.full_name} <span className="text-midnight-900/45">{f.account.email}</span>
                  </button>
                ) : (
                  <span className="text-midnight-900/55">No account · {f.email_fp}</span>
                )}
                <span className="tabular-nums text-red-700">{f.refused} refused</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <FilterBar searchValue={q} onSearchChange={filter(setQ)} searchPlaceholder="Search by account name or email…">
        <SearchableSelect
          value={kind}
          onChange={filter(setKind)}
          placeholder="Any type"
          className="input-field w-44"
          options={[{ value: "", label: "Any type" }, ...Object.entries(KINDS).map(([value, label]) => ({ value, label }))]}
        />
        <SearchableSelect
          value={result}
          onChange={filter(setResult)}
          placeholder="Any result"
          className="input-field w-56"
          options={[{ value: "", label: "Any result" }, ...Object.entries(RESULTS).map(([value, r]) => ({ value, label: r.label }))]}
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

      {rows === null ? (
        !error && <p className="text-midnight-900/50">Loading…</p>
      ) : rows.length === 0 ? (
        <div className="card p-10 text-center text-midnight-900/50">No reset emails match.</div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-midnight-900/10 text-left text-midnight-900/40 text-xs uppercase tracking-wider">
                <th className="px-5 py-3 font-semibold">Time</th>
                <th className="px-5 py-3 font-semibold">Account</th>
                <th className="px-5 py-3 font-semibold">Type</th>
                <th className="px-5 py-3 font-semibold">Result</th>
                <th className="px-5 py-3 font-semibold">Asked from</th>
                <th className="px-5 py-3 font-semibold"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const res = RESULTS[r.result];
                const a = r.account;
                return (
                  <tr key={r.id} className="border-b border-midnight-900/5 last:border-0 align-top">
                    <td className="px-5 py-3 whitespace-nowrap text-midnight-900/70">{when(r.at)}</td>
                    <td className="px-5 py-3">
                      {a ? (
                        <Link href={`/admin/monitoring/accounts?open=${a.id}`} className="hover:underline">
                          <div className="font-medium text-midnight-900">{a.full_name}</div>
                          <div className="text-xs text-midnight-900/45">{a.email}</div>
                        </Link>
                      ) : r.email_fp ? (
                        <span className="text-xs text-midnight-900/50">No account · {r.email_fp}</span>
                      ) : (
                        <span className="text-xs text-midnight-900/40">Refused before the email was read</span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-midnight-900/70">
                      {KINDS[r.kind] ?? r.kind}
                      {r.manual && <div className="text-xs text-midnight-900/45">Sent by an admin</div>}
                    </td>
                    <td className="px-5 py-3">
                      <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${res.badge}`}>{res.label}</span>
                    </td>
                    <td className="px-5 py-3 text-midnight-900/70">
                      {r.ip ? place(r.ip, r.country) : "—"}
                      {r.ip && r.result !== "sent" && (
                        <div>
                          <Link href={`/admin/monitoring/addresses?block=${encodeURIComponent(r.ip)}`} className="text-xs text-red-600 hover:underline">
                            Block address
                          </Link>
                        </div>
                      )}
                    </td>
                    <td className="px-5 py-3 text-xs whitespace-nowrap">
                      {a && !a.deactivated && (r.kind === "password_reset" || r.kind === "account_setup") && (
                        <button
                          type="button"
                          disabled={busy === a.id}
                          onClick={() => resend(a, r.kind as "password_reset" | "account_setup")}
                          className="inline-flex items-center gap-1 font-medium text-gold-700 hover:underline disabled:opacity-60"
                        >
                          <PaperPlaneTilt size={14} weight="bold" /> Resend by hand
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Pagination page={page} totalPages={Math.max(1, Math.ceil(total / PAGE_SIZE))} onPageChange={setPage} total={total} pageSize={PAGE_SIZE} />
      <p className="mt-4 text-xs text-midnight-900/40">{GEOIP_CREDIT}</p>
    </PortalShell>
  );
}
