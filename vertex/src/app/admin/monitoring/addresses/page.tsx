"use client";

// Admin → Monitoring → Address Controls (login protection 4.3, 2026-11-09).
//   Limited now: the addresses this site's per-address limits refuse now
//     (which limit, how many requests, when it resets); Clear lifts one.
//   Blocks and allows: a block refuses sign-in, registration and password
//     reset from an address or range (403) for 1 to 30 days; an allow
//     exempts one from the per-address limits (an office or agency on one
//     connection), never from the per-account lockout. Where both match, the
//     block wins. Every change needs a reason and is on the audit trail.
// "Block address" on Sign-in Activity opens this page with the address filled in.

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CheckCircle, Prohibit, ShieldCheck, Trash } from "@phosphor-icons/react";
import PortalShell from "@/components/portal/PortalShell";
import { ADMIN_NAV_ITEMS } from "@/components/portal/adminNav";
import { useDialog } from "@/components/ui/DialogProvider";
import { place } from "@/lib/monitoring";

interface Person {
  id: string;
  full_name: string;
}

interface Rule {
  id: string;
  network: string;
  kind: "block" | "allow";
  reason: string;
  created_by: Person | null;
  created_at: string;
  expires_at: string | null;
  active: boolean;
  removed_at: string | null;
  removed_by: Person | null;
  removed_reason: string | null;
}

interface Limited {
  key: string;
  scope: string;
  ip: string;
  country: string | null;
  hits: number;
  resets_in_seconds: number;
  blocked: boolean;
}

const SCOPES: Record<string, string> = {
  login: "Sign-in",
  "forgot-password": "Forgot password",
  "reset-password": "Reset password",
  register: "Registration",
  "register-invite": "Invite lookup",
  "verify-email": "Email verification",
  "google-signin": "Google sign-in",
  "google-callback": "Google sign-in",
  contact: "Contact form",
  "public-intake": "Application form",
  "applications-new": "Application form",
};

function when(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—";
}

function wait(seconds: number): string {
  return seconds < 90 ? `${seconds} s` : `${Math.ceil(seconds / 60)} min`;
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

const send = (url: string, method: string, body: unknown) =>
  call(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export default function AddressControlsPage() {
  return (
    <Suspense>
      <AddressControls />
    </Suspense>
  );
}

function AddressControls() {
  const search = useSearchParams();
  const dialog = useDialog();
  const [limited, setLimited] = useState<{ available: boolean; rows: Limited[] } | null>(null);
  const [rules, setRules] = useState<Rule[] | null>(null);
  const [showEnded, setShowEnded] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [network, setNetwork] = useState(search.get("block") ?? "");
  const [kind, setKind] = useState<"block" | "allow">("block");
  const [days, setDays] = useState("7");
  const [reason, setReason] = useState("");

  const load = useCallback(() => {
    call("/api/admin/monitoring/addresses/limited")
      .then((body) => setLimited(body.data as { available: boolean; rows: Limited[] }))
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load the limits."));
    call(`/api/admin/monitoring/addresses/controls${showEnded ? "?include_ended=true" : ""}`)
      .then((body) => setRules((body.data as Rule[]) ?? []))
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load the controls."));
  }, [showEnded]);

  useEffect(() => {
    const first = setTimeout(load, 0);
    const every = setInterval(load, 30_000); // limits expire by themselves
    return () => {
      clearTimeout(first);
      clearInterval(every);
    };
  }, [load]);

  const act = async (run: () => Promise<string>) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      setNotice(await run());
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    const summary =
      kind === "block"
        ? `Block ${network.trim()} for ${days} day${days === "1" ? "" : "s"}? Sign-in, registration and password reset from it are refused until then.`
        : `Allow ${network.trim()}${days ? ` for ${days} days` : ""}? It skips the per-address limits; each account's lockout still applies.`;
    if (!(await dialog.confirm(summary, { confirmLabel: kind === "block" ? "Block" : "Allow", danger: kind === "block" }))) return;
    await act(async () => {
      await send("/api/admin/monitoring/addresses/controls", "POST", { network: network.trim(), kind, reason, days: days ? Number(days) : null });
      setNetwork("");
      setReason("");
      return kind === "block" ? `Blocked ${network.trim()}.` : `Allowed ${network.trim()}.`;
    });
  };

  const remove = async (rule: Rule) => {
    const why = await dialog.prompt(`End the ${rule.kind} on ${rule.network} now? Why?`, {
      title: rule.kind === "block" ? "Remove block" : "Remove allow",
      confirmLabel: "Remove",
      required: true,
      multiline: true,
      placeholder: "Reason (kept on the audit trail)",
    });
    if (why === null) return;
    await act(async () => {
      await send(`/api/admin/monitoring/addresses/controls/${rule.id}`, "DELETE", { reason: why });
      return `Removed the ${rule.kind} on ${rule.network}.`;
    });
  };

  const clear = async (row: Limited) => {
    const why = await dialog.prompt(`Lift the ${SCOPES[row.scope] ?? row.scope} limit on ${row.ip} now? Why?`, {
      title: "Clear limit",
      confirmLabel: "Clear",
      required: true,
      multiline: true,
      placeholder: "Reason (kept on the audit trail)",
    });
    if (why === null) return;
    await act(async () => {
      const body = await send(`/api/admin/monitoring/addresses/limited/${encodeURIComponent(row.key)}/clear`, "POST", { reason: why });
      return (body.data as { cleared: boolean }).cleared ? `Cleared the limit on ${row.ip}.` : `The limit on ${row.ip} had already expired.`;
    });
  };

  return (
    <PortalShell roleLabel="System Administrator" navItems={ADMIN_NAV_ITEMS}>
      <p className="eyebrow mb-3">
        <span className="eyebrow-rule" />
        Monitoring
      </p>
      <h1 className="section-title text-3xl md:text-4xl mb-2">Address Controls</h1>
      <p className="text-midnight-900/55 font-light mb-8 max-w-2xl">
        The addresses this site&rsquo;s limits refuse now, and your blocks and allows. A block refuses sign-in,
        registration and password reset from an address or range for up to 30 days. An allow lets an office or agency on
        one connection past the per-address limits; each account&rsquo;s own lockout still applies. Where both match, the
        block wins. Every change needs a reason and is on the audit trail.
      </p>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4 text-sm mb-6">{error}</div>}
      {notice && (
        <div className="mb-6 flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
          <CheckCircle size={18} weight="fill" className="mt-0.5 shrink-0" /> {notice}
        </div>
      )}

      <section className="mb-10">
        <h2 className="text-lg font-semibold text-midnight-900 mb-3">Limited now</h2>
        {limited === null ? (
          !error && <p className="text-midnight-900/50">Loading…</p>
        ) : !limited.available ? (
          <div className="card p-6 text-sm text-midnight-900/55">
            This stack keeps its limits in each process (no shared store), so they can&rsquo;t be listed here.
          </div>
        ) : limited.rows.length === 0 ? (
          <div className="card p-6 text-center text-midnight-900/50">No address is limited right now.</div>
        ) : (
          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-midnight-900/10 text-left text-midnight-900/40 text-xs uppercase tracking-wider">
                  <th className="px-5 py-3 font-semibold">Address</th>
                  <th className="px-5 py-3 font-semibold">Limit</th>
                  <th className="px-5 py-3 font-semibold">Requests</th>
                  <th className="px-5 py-3 font-semibold">Resets in</th>
                  <th className="px-5 py-3 font-semibold"></th>
                </tr>
              </thead>
              <tbody>
                {limited.rows.map((r) => (
                  <tr key={r.key} className="border-b border-midnight-900/5 last:border-0">
                    <td className="px-5 py-3">
                      {place(r.ip, r.country)}
                      {r.blocked && <div className="text-xs font-medium text-red-700">Also blocked</div>}
                    </td>
                    <td className="px-5 py-3 text-midnight-900/70">{SCOPES[r.scope] ?? r.scope}</td>
                    <td className="px-5 py-3 tabular-nums text-midnight-900/70">{r.hits}</td>
                    <td className="px-5 py-3 text-midnight-900/70">{wait(r.resets_in_seconds)}</td>
                    <td className="px-5 py-3 text-right whitespace-nowrap text-xs">
                      <button type="button" disabled={busy} onClick={() => clear(r)} className="btn-secondary px-3 py-1.5 text-xs disabled:opacity-60">
                        Clear
                      </button>{" "}
                      {!r.blocked && (
                        <button type="button" onClick={() => setNetwork(r.ip)} className="ml-2 font-medium text-red-600 hover:underline">
                          Block…
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="mb-6">
        <h2 className="text-lg font-semibold text-midnight-900 mb-3">Add a block or allow</h2>
        <form onSubmit={add} className="card p-5 grid gap-3 md:grid-cols-[1fr_auto_auto] items-end">
          <label className="text-xs text-midnight-900/55">
            Address or range
            <input value={network} onChange={(e) => setNetwork(e.target.value)} required placeholder="203.0.113.7 or 203.0.113.0/24" className="input-field mt-1 w-full" />
          </label>
          <label className="text-xs text-midnight-900/55">
            Type
            <select
              value={kind}
              onChange={(e) => {
                const next = e.target.value as "block" | "allow";
                setKind(next);
                if (next === "block" && !days) setDays("7");
              }}
              className="input-field mt-1 w-40"
            >
              <option value="block">Block</option>
              <option value="allow">Allow</option>
            </select>
          </label>
          <label className="text-xs text-midnight-900/55">
            {kind === "block" ? "Days (1 to 30)" : "Days (empty: until removed)"}
            <input
              type="number"
              min={1}
              max={kind === "block" ? 30 : 365}
              required={kind === "block"}
              value={days}
              onChange={(e) => setDays(e.target.value)}
              className="input-field mt-1 w-40"
            />
          </label>
          <label className="text-xs text-midnight-900/55 md:col-span-2">
            Reason
            <input value={reason} onChange={(e) => setReason(e.target.value)} required minLength={3} placeholder="Kept on the audit trail" className="input-field mt-1 w-full" />
          </label>
          <button type="submit" disabled={busy} className={`${kind === "block" ? "btn-primary" : "btn-secondary"} px-5 py-2.5 text-xs disabled:opacity-60`}>
            {kind === "block" ? (
              <>
                <Prohibit size={16} weight="bold" /> Block
              </>
            ) : (
              <>
                <ShieldCheck size={16} weight="bold" /> Allow
              </>
            )}
          </button>
          <p className="md:col-span-3 text-xs text-midnight-900/45">
            A block covers at most a /16 (IPv4) or /48 (IPv6) and can&rsquo;t include your own address; an allow at most a /24 or /64.
          </p>
        </form>
      </section>

      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-midnight-900">Blocks and allows</h2>
          <label className="flex items-center gap-2 text-xs text-midnight-900/60">
            <input type="checkbox" checked={showEnded} onChange={(e) => setShowEnded(e.target.checked)} /> Show removed and expired
          </label>
        </div>
        {rules === null ? (
          !error && <p className="text-midnight-900/50">Loading…</p>
        ) : rules.length === 0 ? (
          <div className="card p-6 text-center text-midnight-900/50">No blocks or allows.</div>
        ) : (
          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-midnight-900/10 text-left text-midnight-900/40 text-xs uppercase tracking-wider">
                  <th className="px-5 py-3 font-semibold">Address or range</th>
                  <th className="px-5 py-3 font-semibold">Type</th>
                  <th className="px-5 py-3 font-semibold">Reason</th>
                  <th className="px-5 py-3 font-semibold">Added</th>
                  <th className="px-5 py-3 font-semibold">Until</th>
                  <th className="px-5 py-3 font-semibold"></th>
                </tr>
              </thead>
              <tbody>
                {rules.map((r) => (
                  <tr key={r.id} className={`border-b border-midnight-900/5 last:border-0 align-top ${r.active ? "" : "opacity-60"}`}>
                    <td className="px-5 py-3 font-mono text-xs">{r.network}</td>
                    <td className="px-5 py-3">
                      <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${r.kind === "block" ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700"}`}>
                        {r.kind === "block" ? "Block" : "Allow"}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-midnight-900/70">{r.reason}</td>
                    <td className="px-5 py-3 text-midnight-900/70">
                      <div>{when(r.created_at)}</div>
                      {r.created_by && <div className="text-xs text-midnight-900/45">by {r.created_by.full_name}</div>}
                    </td>
                    <td className="px-5 py-3 text-midnight-900/70">
                      {r.removed_at ? (
                        <>
                          <div>Removed {when(r.removed_at)}</div>
                          {r.removed_by && <div className="text-xs text-midnight-900/45">by {r.removed_by.full_name}</div>}
                          {r.removed_reason && <div className="text-xs text-midnight-900/55">&ldquo;{r.removed_reason}&rdquo;</div>}
                        </>
                      ) : r.expires_at ? (
                        <>{r.active ? when(r.expires_at) : `Expired ${when(r.expires_at)}`}</>
                      ) : (
                        "Until removed"
                      )}
                    </td>
                    <td className="px-5 py-3 text-right">
                      {r.active && (
                        <button type="button" disabled={busy} onClick={() => remove(r)} className="inline-flex items-center gap-1 text-xs font-medium text-red-600 hover:underline disabled:opacity-60">
                          <Trash size={14} weight="bold" /> Remove
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </PortalShell>
  );
}
