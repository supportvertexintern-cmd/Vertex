"use client";

// Admin → Monitoring → Login Protection (login protection 4.5, 2026-11-09):
// the thresholds behind the lockout, the per-email reset limit and the
// per-address sign-in limit. Each shows its current value, default and
// allowed range. Saving needs a reason and a confirmed summary of what
// changes; FastAPI refuses a value outside its range (never clamps it) and
// records every change, which the history below lists. Changes reach every
// process within a minute.

import { useCallback, useEffect, useState } from "react";
import { ArrowCounterClockwise, CheckCircle, FloppyDisk } from "@phosphor-icons/react";
import PortalShell from "@/components/portal/PortalShell";
import { ADMIN_NAV_ITEMS } from "@/components/portal/adminNav";
import { useDialog } from "@/components/ui/DialogProvider";

interface Values {
  account_max_failures: number;
  account_window_minutes: number;
  cooldown_steps_minutes: number[];
  ip_login_max_per_minute: number;
  reset_per_email_hour: number;
  reset_per_email_day: number;
  lockout_notice_enabled: boolean;
}

interface Change {
  at: string;
  by: { id: string; full_name: string } | null;
  reason: string | null;
  before: Partial<Values> | null;
  after: Partial<Values> | null;
}

interface Page {
  values: Values;
  defaults: Values;
  bounds: Record<string, [number, number]>;
  history: Change[];
}

type NumberField = Exclude<keyof Values, "cooldown_steps_minutes" | "lockout_notice_enabled">;

const FIELDS: { key: NumberField; label: string; unit: string; help: string }[] = [
  { key: "account_max_failures", label: "Failed sign-ins before a lockout", unit: "attempts", help: "Per account, within the window below." },
  { key: "account_window_minutes", label: "Counting window", unit: "minutes", help: "Failures older than this stop counting." },
  { key: "ip_login_max_per_minute", label: "Sign-in attempts per network address", unit: "a minute", help: "The website's per-address limit." },
  { key: "reset_per_email_hour", label: "Reset or setup emails per address", unit: "an hour", help: "Per email address, from any network." },
  { key: "reset_per_email_day", label: "Reset or setup emails per address", unit: "a day", help: "At least the hourly limit." },
];

const LABELS: Record<keyof Values, string> = {
  account_max_failures: "Failed sign-ins before a lockout",
  account_window_minutes: "Counting window",
  cooldown_steps_minutes: "Cooldown steps",
  ip_login_max_per_minute: "Sign-in attempts per address a minute",
  reset_per_email_hour: "Reset emails an hour",
  reset_per_email_day: "Reset emails a day",
  lockout_notice_enabled: "Lockout notice email",
};

function show(key: keyof Values, value: unknown): string {
  if (Array.isArray(value)) return value.map((m) => `${m} min`).join(" → ");
  if (typeof value === "boolean") return value ? "on" : "off";
  return String(value ?? "—");
}

function differences(from: Partial<Values>, to: Partial<Values>): string[] {
  return (Object.keys(LABELS) as (keyof Values)[])
    .filter((k) => JSON.stringify(from[k]) !== JSON.stringify(to[k]))
    .map((k) => `${LABELS[k]}: ${show(k, from[k])} → ${show(k, to[k])}`);
}

function when(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export default function LoginProtectionPage() {
  const dialog = useDialog();
  const [page, setPage] = useState<Page | null>(null);
  const [form, setForm] = useState<Values | null>(null);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    fetch("/api/admin/monitoring/settings/login-protection")
      .then(async (r) => {
        const body = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(body.error?.message || "Failed to load the settings.");
        setPage(body.data);
        setForm(body.data.values);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load the settings."));
  }, []);

  useEffect(() => {
    const first = setTimeout(load, 0);
    return () => clearTimeout(first);
  }, [load]);

  const save = async (next: Values, title: string) => {
    if (!page) return;
    const changes = differences(page.values, next);
    if (changes.length === 0) {
      setNotice("Nothing to change.");
      return;
    }
    const reason = await dialog.prompt(`These change:\n\n${changes.join("\n")}\n\nEvery process uses them within a minute. Why?`, {
      title,
      confirmLabel: "Save",
      required: true,
      multiline: true,
      placeholder: "Reason (kept on the audit trail)",
    });
    if (reason === null) return;
    setBusy(true);
    setError("");
    setFieldErrors({});
    setNotice("");
    try {
      const res = await fetch("/api/admin/monitoring/settings/login-protection", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...next, reason }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        const details = (body.error?.details ?? {}) as Record<string, string[]>;
        setFieldErrors(Object.fromEntries(Object.entries(details).map(([k, v]) => [k, Array.isArray(v) ? v[0] : String(v)])));
        throw new Error(body.error?.message || "Failed to save.");
      }
      setPage(body.data);
      setForm(body.data.values);
      setNotice("Saved. Every process uses the new values within a minute.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save.");
    } finally {
      setBusy(false);
    }
  };

  const range = (key: string) => page?.bounds[key] ?? [0, 0];

  return (
    <PortalShell roleLabel="System Administrator" navItems={ADMIN_NAV_ITEMS}>
      <p className="eyebrow mb-3">
        <span className="eyebrow-rule" />
        Monitoring
      </p>
      <h1 className="section-title text-3xl md:text-4xl mb-2">Login Protection</h1>
      <p className="text-midnight-900/55 font-light mb-8 max-w-2xl">
        The thresholds behind account lockouts, reset-email limits and the per-address sign-in limit. Values outside their
        range are refused. Every change needs a reason and is on the audit trail.
      </p>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4 text-sm mb-6">{error}</div>}
      {notice && (
        <div className="mb-6 flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
          <CheckCircle size={18} weight="fill" className="mt-0.5 shrink-0" /> {notice}
        </div>
      )}

      {!page || !form ? (
        !error && <p className="text-midnight-900/50">Loading…</p>
      ) : (
        <>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              save(form, "Save login protection");
            }}
            className="card p-6 mb-10 space-y-5"
          >
            {FIELDS.map((f) => {
              const [low, high] = range(f.key);
              return (
                <div key={f.key} className="grid gap-2 md:grid-cols-[1fr_auto] md:items-center">
                  <div>
                    <label htmlFor={f.key} className="block text-sm font-medium text-midnight-900">
                      {f.label}
                    </label>
                    <p className="text-xs text-midnight-900/45">
                      {f.help} Default {page.defaults[f.key]}; allowed {low} to {high}.
                    </p>
                    {fieldErrors[f.key] && <p className="text-xs text-red-700 mt-1">{fieldErrors[f.key]}</p>}
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      id={f.key}
                      type="number"
                      min={low}
                      max={high}
                      required
                      value={form[f.key]}
                      onChange={(e) => setForm({ ...form, [f.key]: Number(e.target.value) })}
                      className="input-field w-28"
                    />
                    <span className="text-xs text-midnight-900/50 w-20">{f.unit}</span>
                  </div>
                </div>
              );
            })}

            <div className="grid gap-2 md:grid-cols-[1fr_auto] md:items-center">
              <div>
                <p className="text-sm font-medium text-midnight-900">Cooldown steps</p>
                <p className="text-xs text-midnight-900/45">
                  How long the 1st, 2nd, 3rd and 4th lockout in a row hold, each longer than the last. The 4th also flags
                  the account for review. Default {page.defaults.cooldown_steps_minutes.join(", ")} minutes; each{" "}
                  {range("cooldown_steps_minutes")[0]} to {range("cooldown_steps_minutes")[1]}.
                </p>
                {fieldErrors.cooldown_steps_minutes && <p className="text-xs text-red-700 mt-1">{fieldErrors.cooldown_steps_minutes}</p>}
              </div>
              <div className="flex items-center gap-2">
                {form.cooldown_steps_minutes.map((m, i) => (
                  <input
                    key={i}
                    aria-label={`Cooldown step ${i + 1} in minutes`}
                    type="number"
                    min={range("cooldown_steps_minutes")[0]}
                    max={range("cooldown_steps_minutes")[1]}
                    required
                    value={m}
                    onChange={(e) => {
                      const steps = [...form.cooldown_steps_minutes];
                      steps[i] = Number(e.target.value);
                      setForm({ ...form, cooldown_steps_minutes: steps });
                    }}
                    className="input-field w-20"
                  />
                ))}
                <span className="text-xs text-midnight-900/50">min</span>
              </div>
            </div>

            <label className="flex items-center gap-3 text-sm text-midnight-900">
              <input
                type="checkbox"
                checked={form.lockout_notice_enabled}
                onChange={(e) => setForm({ ...form, lockout_notice_enabled: e.target.checked })}
              />
              Email the owner when their account is locked (at most once a day). Default on.
            </label>

            <div className="flex flex-wrap gap-3 pt-2">
              <button type="submit" disabled={busy} className="btn-primary px-5 py-2.5 text-xs disabled:opacity-60">
                <FloppyDisk size={16} weight="bold" /> Save
              </button>
              <button type="button" disabled={busy} onClick={() => save(page.defaults, "Reset to defaults")} className="btn-secondary px-5 py-2.5 text-xs disabled:opacity-60">
                <ArrowCounterClockwise size={16} weight="bold" /> Reset to defaults
              </button>
            </div>
          </form>

          <section>
            <h2 className="text-lg font-semibold text-midnight-900 mb-3">Change history</h2>
            {page.history.length === 0 ? (
              <div className="card p-6 text-center text-midnight-900/50">No changes yet: the defaults are in force.</div>
            ) : (
              <div className="card overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-midnight-900/10 text-left text-midnight-900/40 text-xs uppercase tracking-wider">
                      <th className="px-5 py-3 font-semibold">When</th>
                      <th className="px-5 py-3 font-semibold">By</th>
                      <th className="px-5 py-3 font-semibold">What changed</th>
                      <th className="px-5 py-3 font-semibold">Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {page.history.map((h, i) => (
                      <tr key={i} className="border-b border-midnight-900/5 last:border-0 align-top">
                        <td className="px-5 py-3 whitespace-nowrap text-midnight-900/70">{when(h.at)}</td>
                        <td className="px-5 py-3 text-midnight-900/70">{h.by?.full_name ?? "—"}</td>
                        <td className="px-5 py-3 text-midnight-900/70">
                          {differences(h.before ?? {}, h.after ?? {}).map((d) => (
                            <div key={d}>{d}</div>
                          ))}
                        </td>
                        <td className="px-5 py-3 text-midnight-900/70">{h.reason ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </PortalShell>
  );
}
