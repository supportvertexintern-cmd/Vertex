"use client";

// Admin → Monitoring → Sign-in Activity (login protection 4.2, 2026-11-09):
// every sign-in attempt in the retention window, so an admin can
// investigate rather than only react: who, the result, the address,
// country, device and method, with filters. Above it, failed sign-ins in
// the last 7 days: per hour, and the 10 addresses and accounts with the
// most. Reading the list is recorded on the audit trail (FastAPI).

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import PortalShell from "@/components/portal/PortalShell";
import { ADMIN_NAV_ITEMS } from "@/components/portal/adminNav";
import FilterBar from "@/components/portal/FilterBar";
import SearchableSelect from "@/components/SearchableSelect";
import Pagination from "@/components/Pagination";
import { GEOIP_CREDIT, place } from "@/lib/monitoring";

const PAGE_SIZE = 50;

type Result = "success" | "wrong_password" | "locked" | "address_limited" | "deactivated" | "not_activated" | "refused";

const RESULTS: Record<Result, { label: string; badge: string }> = {
  success: { label: "Success", badge: "bg-emerald-50 text-emerald-700" },
  wrong_password: { label: "Wrong password", badge: "bg-amber-50 text-amber-800" },
  locked: { label: "Locked", badge: "bg-red-50 text-red-700" },
  address_limited: { label: "Address limited", badge: "bg-red-50 text-red-700" },
  deactivated: { label: "Deactivated", badge: "bg-midnight-900/5 text-midnight-900/70" },
  not_activated: { label: "Not activated", badge: "bg-midnight-900/5 text-midnight-900/70" },
  refused: { label: "Refused", badge: "bg-amber-50 text-amber-800" },
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
  result: Result;
  account: Account | null;
  email_fp: string | null;
  reason: string | null;
  method: string | null;
  client: string | null;
  ip: string | null;
  country: string | null;
  device: string | null;
}

interface Stats {
  hours: { hour: string; n: number }[];
  top_addresses: { ip: string; country: string | null; n: number }[];
  top_accounts: { email_fp: string; account: Account | null; n: number }[];
}

function when(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function how(r: Row): string {
  const method = r.method === "google" ? "Google" : r.method === "password" ? "Password" : "—";
  return r.client === "app" ? `${method} · App` : method;
}

async function call(url: string): Promise<Record<string, unknown>> {
  const res = await fetch(url);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error?.message || "Something went wrong.");
  return body;
}

/** The last 7 days as 168 hourly buckets (UTC, as the trail keeps time). */
function hourly(hours: Stats["hours"]): { start: Date; n: number }[] {
  const counts = new Map(hours.map((h) => [h.hour, h.n]));
  const now = new Date();
  const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours());
  return Array.from({ length: 168 }, (_, i) => {
    const start = new Date(end - (167 - i) * 3_600_000);
    const key = start.toISOString().slice(0, 13) + ":00:00";
    return { start, n: counts.get(key) ?? 0 };
  });
}

function FailuresChart({ hours }: { hours: Stats["hours"] }) {
  const buckets = useMemo(() => hourly(hours), [hours]);
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...buckets.map((b) => b.n));
  const total = buckets.reduce((sum, b) => sum + b.n, 0);
  const peak = buckets.reduce((best, b) => (b.n > best.n ? b : best), buckets[0]);
  const shown = hover === null ? null : buckets[hover];
  return (
    <div className="card p-5">
      <div className="flex items-baseline justify-between gap-4 mb-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-midnight-900/45">Failed sign-ins per hour, last 7 days</p>
        <p className="text-xs text-midnight-900/55 tabular-nums" aria-live="polite">
          {shown
            ? `${shown.start.toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}: ${shown.n}`
            : `${total} in all${peak && peak.n > 0 ? `; most in one hour: ${peak.n}` : ""}`}
        </p>
      </div>
      <div
        className="flex h-28 items-end gap-px border-b border-midnight-900/15"
        role="img"
        aria-label={`Failed sign-ins per hour over the last 7 days: ${total} in all, at most ${peak?.n ?? 0} in one hour.`}
        onMouseLeave={() => setHover(null)}
      >
        {buckets.map((b, i) => (
          <div key={i} className="flex h-full flex-1 items-end" onMouseEnter={() => setHover(i)}>
            <div
              className={`w-full rounded-t-[2px] ${hover === i ? "bg-gold-700" : "bg-gold-500"}`}
              style={{ height: b.n ? `${Math.max(4, (b.n / max) * 100)}%` : 0 }}
            />
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-midnight-900/40">
        <span>{buckets[0].start.toLocaleDateString(undefined, { day: "numeric", month: "short" })}</span>
        <span>now</span>
      </div>
    </div>
  );
}

export default function SignInActivityPage() {
  return (
    <Suspense>
      <SignInActivity />
    </Suspense>
  );
}

function SignInActivity() {
  const search = useSearchParams();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [result, setResult] = useState(search.get("result") ?? "");
  const [failuresOnly, setFailuresOnly] = useState(search.get("failures_only") === "true");
  const [userId, setUserId] = useState(search.get("user_id") ?? "");
  const [ip, setIp] = useState(search.get("ip") ?? "");
  const [country, setCountry] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const load = useCallback(() => {
    const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
    for (const [key, value] of Object.entries({
      q, result, failures_only: failuresOnly ? "true" : "", user_id: userId, ip: ip.trim(), country: country.trim(), date_from: dateFrom, date_to: dateTo,
    })) {
      if (value) params.set(key, value);
    }
    call(`/api/admin/monitoring/sign-ins?${params}`)
      .then((body) => {
        setRows((body.data as Row[]) ?? []);
        setTotal(Number(body.total ?? 0));
        setError("");
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load sign-ins."));
  }, [page, q, result, failuresOnly, userId, ip, country, dateFrom, dateTo]);

  useEffect(() => {
    const timeout = setTimeout(load, 300); // debounce typing
    return () => clearTimeout(timeout);
  }, [load]);

  useEffect(() => {
    call("/api/admin/monitoring/sign-ins/stats")
      .then((body) => setStats(body.data as Stats))
      .catch(() => {});
  }, []);

  const filter = (set: (value: string) => void) => (value: string) => {
    set(value);
    setPage(1);
  };

  return (
    <PortalShell roleLabel="System Administrator" navItems={ADMIN_NAV_ITEMS}>
      <p className="eyebrow mb-3">
        <span className="eyebrow-rule" />
        Monitoring
      </p>
      <h1 className="section-title text-3xl md:text-4xl mb-2">Sign-in Activity</h1>
      <p className="text-midnight-900/55 font-light mb-8 max-w-2xl">
        Every sign-in attempt: who, the result, the address, country, device and method. Opening this list is recorded on
        the audit trail.
      </p>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4 text-sm mb-6">{error}</div>}

      {stats && (
        <div className="grid gap-4 lg:grid-cols-3 mb-8">
          <div className="lg:col-span-3">
            <FailuresChart hours={stats.hours} />
          </div>
          <div className="card p-5 lg:col-span-1">
            <p className="text-xs font-semibold uppercase tracking-wider text-midnight-900/45 mb-3">Most failures by address</p>
            {stats.top_addresses.length === 0 ? (
              <p className="text-sm text-midnight-900/45">None in the last 7 days.</p>
            ) : (
              <table className="w-full text-sm">
                <tbody>
                  {stats.top_addresses.map((a) => (
                    <tr key={a.ip} className="border-b border-midnight-900/5 last:border-0">
                      <td className="py-1.5">
                        <button type="button" onClick={() => filter(setIp)(a.ip)} className="text-left hover:underline">
                          {place(a.ip, a.country)}
                        </button>
                      </td>
                      <td className="py-1.5 text-right tabular-nums text-midnight-900/70">{a.n}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <div className="card p-5 lg:col-span-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-midnight-900/45 mb-3">Most failures by account</p>
            {stats.top_accounts.length === 0 ? (
              <p className="text-sm text-midnight-900/45">None in the last 7 days.</p>
            ) : (
              <table className="w-full text-sm">
                <tbody>
                  {stats.top_accounts.map((a) => (
                    <tr key={a.email_fp} className="border-b border-midnight-900/5 last:border-0">
                      <td className="py-1.5">
                        {a.account ? (
                          <button type="button" onClick={() => filter(setUserId)(a.account!.id)} className="text-left hover:underline">
                            {a.account.full_name} <span className="text-midnight-900/45">{a.account.email}</span>
                          </button>
                        ) : (
                          <span className="text-midnight-900/55">No account with this address · {a.email_fp}</span>
                        )}
                      </td>
                      <td className="py-1.5 text-right tabular-nums text-midnight-900/70">{a.n}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      <FilterBar searchValue={q} onSearchChange={filter(setQ)} searchPlaceholder="Search by account name or email…">
        <SearchableSelect
          value={result}
          onChange={filter(setResult)}
          placeholder="Any result"
          className="input-field w-48"
          options={[{ value: "", label: "Any result" }, ...Object.entries(RESULTS).map(([value, r]) => ({ value, label: r.label }))]}
        />
        <label className="flex items-center gap-2 text-xs text-midnight-900/60">
          <input type="checkbox" checked={failuresOnly} onChange={(e) => { setFailuresOnly(e.target.checked); setPage(1); }} />
          Failures only
        </label>
        <input value={ip} onChange={(e) => filter(setIp)(e.target.value)} placeholder="IP address" className="input-field py-2 text-xs w-40" />
        <input value={country} onChange={(e) => filter(setCountry)(e.target.value.toUpperCase().slice(0, 2))} placeholder="Country (KE)" className="input-field py-2 text-xs w-28" />
        <label className="flex items-center gap-2 text-xs text-midnight-900/50">
          From
          <input type="date" value={dateFrom} onChange={(e) => filter(setDateFrom)(e.target.value)} className="input-field py-2 text-xs w-40" />
        </label>
        <label className="flex items-center gap-2 text-xs text-midnight-900/50">
          to
          <input type="date" value={dateTo} onChange={(e) => filter(setDateTo)(e.target.value)} className="input-field py-2 text-xs w-40" />
        </label>
        {userId && (
          <button type="button" onClick={() => filter(setUserId)("")} className="text-xs text-gold-700 hover:underline">
            Showing one account · show all
          </button>
        )}
      </FilterBar>

      {rows === null ? (
        !error && <p className="text-midnight-900/50">Loading…</p>
      ) : rows.length === 0 ? (
        <div className="card p-10 text-center text-midnight-900/50">No sign-in attempts match.</div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-midnight-900/10 text-left text-midnight-900/40 text-xs uppercase tracking-wider">
                <th className="px-5 py-3 font-semibold">Time</th>
                <th className="px-5 py-3 font-semibold">Account</th>
                <th className="px-5 py-3 font-semibold">Result</th>
                <th className="px-5 py-3 font-semibold">Address</th>
                <th className="px-5 py-3 font-semibold">Device</th>
                <th className="px-5 py-3 font-semibold">Method</th>
                <th className="px-5 py-3 font-semibold"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const result = RESULTS[r.result];
                return (
                  <tr key={r.id} className="border-b border-midnight-900/5 last:border-0 align-top">
                    <td className="px-5 py-3 whitespace-nowrap text-midnight-900/70">{when(r.at)}</td>
                    <td className="px-5 py-3">
                      {r.account ? (
                        <Link href={`/admin/monitoring/accounts?open=${r.account.id}`} className="hover:underline">
                          <div className="font-medium text-midnight-900">{r.account.full_name}</div>
                          <div className="text-xs text-midnight-900/45">{r.account.email}</div>
                        </Link>
                      ) : r.email_fp ? (
                        <span className="text-xs text-midnight-900/50">No account · {r.email_fp}</span>
                      ) : (
                        <span className="text-xs text-midnight-900/40">Refused before the email was read</span>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${result.badge}`}>{result.label}</span>
                      {r.result === "refused" && r.reason && <div className="text-xs text-midnight-900/45 mt-1">{r.reason.replace(/_/g, " ")}</div>}
                    </td>
                    <td className="px-5 py-3 text-midnight-900/70">
                      {r.ip ? (
                        <button type="button" onClick={() => filter(setIp)(r.ip!)} className="text-left hover:underline">
                          {place(r.ip, r.country)}
                        </button>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-5 py-3 text-midnight-900/70">{r.device ?? "—"}</td>
                    <td className="px-5 py-3 text-midnight-900/70 whitespace-nowrap">{how(r)}</td>
                    <td className="px-5 py-3 text-xs whitespace-nowrap">
                      {r.account && (
                        <Link href={`/admin/monitoring/suspicious?user=${r.account.id}`} className="text-midnight-900/50 hover:underline">
                          Related alerts
                        </Link>
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
