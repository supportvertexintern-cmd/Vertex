"use client";

// Admin → Monitoring → Security Overview (owner's requirements 2026-11-07,
// phase 5): the last 24 hours and 7 days at a glance, each card linking to
// the page that lists it, and the latest alerts. "Run account checks" runs
// the scheduled ones now (stale partner logins, inactive logins).

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowsClockwise, CheckCircle } from "@phosphor-icons/react";
import PortalShell from "@/components/portal/PortalShell";
import { ADMIN_NAV_ITEMS } from "@/components/portal/adminNav";
import { GEOIP_CREDIT } from "@/lib/monitoring";

type Severity = "critical" | "high" | "medium";

interface Window {
  last_24h: number;
  last_7d: number;
}

interface RecentAlert {
  id: string;
  rule: string;
  severity: Severity;
  summary: string;
  status: string;
  created_at: string;
  account: { id: string; full_name: string } | null;
}

interface Overview {
  open_alerts: Record<Severity, number>;
  retention_months: number;
  alerts_raised: Window;
  failed_sign_ins: Window;
  sign_ins: Window;
  accounts_deactivated: Window;
  partner_logins_not_activated: number;
  accounts_inactive: number;
  new_partners: Window;
  new_partner_logins: Window;
  active_sessions: number;
  locked_accounts: number;
  lockouts_needing_review: number;
  failed_sign_ins_previous_24h: number;
  reset_emails_refused: Window;
  addresses_limited_now: number | null;
  addresses_blocked: number;
  geoip_month: string | null;
  recent_alerts: RecentAlert[];
}

const SEVERITY: Record<Severity, string> = {
  critical: "bg-red-600 text-white",
  high: "bg-orange-100 text-orange-800",
  medium: "bg-amber-50 text-amber-800",
};

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

/** The last 24 hours against the 24 before. */
function trend(now: number, before: number): string {
  if (now === before) return `Same as the 24 hours before (${before}).`;
  return `${now > before ? "Up" : "Down"} from ${before} the 24 hours before.`;
}

function when(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function Card({ title, href, window, value, note }: { title: string; href: string; window?: Window; value?: number; note?: string }) {
  return (
    <Link href={href} className="card p-5 block hover:shadow-md transition-shadow">
      <p className="text-xs font-semibold uppercase tracking-wider text-midnight-900/45 mb-3">{title}</p>
      {window ? (
        <div className="flex items-end gap-6">
          <div>
            <div className="text-3xl font-semibold text-midnight-900 tabular-nums">{window.last_24h}</div>
            <div className="text-xs text-midnight-900/45">last 24 hours</div>
          </div>
          <div>
            <div className="text-xl font-medium text-midnight-900/70 tabular-nums">{window.last_7d}</div>
            <div className="text-xs text-midnight-900/45">last 7 days</div>
          </div>
        </div>
      ) : (
        <div className="text-3xl font-semibold text-midnight-900 tabular-nums">{value ?? 0}</div>
      )}
      {note && <p className="mt-2 text-xs text-midnight-900/45">{note}</p>}
    </Link>
  );
}

export default function SecurityOverviewPage() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState("");
  const [running, setRunning] = useState(false);
  const [notice, setNotice] = useState("");

  const load = useCallback(() => {
    fetch("/api/admin/monitoring/overview")
      .then(async (r) => {
        const body = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(body.error?.message || "Failed to load the overview.");
        setData(body.data as Overview);
        setError("");
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load the overview."));
  }, []);

  useEffect(load, [load]);

  const runChecks = async () => {
    setRunning(true);
    setNotice("");
    try {
      const res = await fetch("/api/admin/monitoring/checks/run", { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error?.message || "The checks failed.");
      const raised = Number(body.data?.raised ?? 0);
      setNotice(raised ? `${raised} new item${raised === 1 ? "" : "s"} in Suspicious Activity.` : "Nothing new found.");
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The checks failed.");
    } finally {
      setRunning(false);
    }
  };

  const open = data ? data.open_alerts.critical + data.open_alerts.high + data.open_alerts.medium : 0;

  return (
    <PortalShell roleLabel="System Administrator" navItems={ADMIN_NAV_ITEMS}>
      <div className="flex items-start justify-between gap-6 mb-2">
        <div>
          <p className="eyebrow mb-3">
            <span className="eyebrow-rule" />
            Monitoring
          </p>
          <h1 className="section-title text-3xl md:text-4xl">Security Overview</h1>
        </div>
        <button type="button" onClick={runChecks} disabled={running} className="btn-secondary text-xs shrink-0 disabled:opacity-60">
          <ArrowsClockwise size={16} weight="bold" /> {running ? "Running…" : "Run account checks"}
        </button>
      </div>
      <p className="text-midnight-900/55 font-light mb-8 max-w-2xl">
        The last day and week at a glance. Each card opens the page that lists it. Account checks also run on their own
        every few hours.
      </p>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4 text-sm mb-6">{error}</div>}
      {notice && (
        <div className="mb-6 flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
          <CheckCircle size={18} weight="fill" className="mt-0.5 shrink-0" /> {notice}
        </div>
      )}

      {!data ? (
        !error && <p className="text-midnight-900/50">Loading…</p>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4 mb-10">
            <Link href="/admin/monitoring/suspicious" className="card p-5 block hover:shadow-md transition-shadow">
              <p className="text-xs font-semibold uppercase tracking-wider text-midnight-900/45 mb-3">Open suspicious items</p>
              <div className="text-3xl font-semibold text-midnight-900 tabular-nums">{open}</div>
              <div className="mt-2 flex flex-wrap gap-2 text-xs">
                {(["critical", "high", "medium"] as Severity[]).map((s) => (
                  <span key={s} className={`rounded-full px-2 py-0.5 font-medium ${SEVERITY[s]}`}>
                    {data.open_alerts[s]} {s}
                  </span>
                ))}
              </div>
            </Link>
            <Card title="Alerts raised" href="/admin/monitoring/suspicious" window={data.alerts_raised} />
            <Card
              title="Failed sign-ins"
              href="/admin/monitoring/sign-ins?failures_only=true"
              window={data.failed_sign_ins}
              note={trend(data.failed_sign_ins.last_24h, data.failed_sign_ins_previous_24h)}
            />
            <Card title="Sign-ins" href="/admin/monitoring/sign-ins?result=success" window={data.sign_ins} />
            <Card title="Accounts deactivated" href="/admin/monitoring/accounts?status=deactivated" window={data.accounts_deactivated} />
            <Card
              title="Partner logins not activated"
              href="/admin/monitoring/partners?attention=setup_overdue"
              value={data.partner_logins_not_activated}
              note="Setup email more than 7 days old, never used."
            />
            <Card
              title="Inactive accounts"
              href="/admin/monitoring/accounts?status=active&inactive_days=60"
              value={data.accounts_inactive}
              note="Active staff and partner logins not signed in for 60+ days."
            />
            <Card title="New partners" href="/admin/monitoring/partners" window={data.new_partners} />
            <Card title="New partner logins" href="/admin/monitoring/partners" window={data.new_partner_logins} />
            <Card title="Active sessions now" href="/admin/monitoring/accounts" value={data.active_sessions} />
            <Card
              title="Locked accounts now"
              href="/admin/monitoring/locked"
              value={data.locked_accounts}
              note={
                data.lockouts_needing_review > 0
                  ? `${data.lockouts_needing_review} at the 24-hour step need review.`
                  : "10 failed sign-ins in 15 minutes; repeats hold longer."
              }
            />
            <Card
              title="Lockouts needing review"
              href="/admin/monitoring/locked?tab=history&needs_review=true"
              value={data.lockouts_needing_review}
              note="Locked 4 times in a row: the 24-hour step."
            />
            <Card
              title="Addresses limited now"
              href="/admin/monitoring/addresses"
              value={data.addresses_limited_now ?? 0}
              note={data.addresses_limited_now === null ? "Not countable on this stack (no shared store)." : "Refused by a per-address limit right now."}
            />
            <Card title="Addresses blocked" href="/admin/monitoring/addresses" value={data.addresses_blocked} note="Blocks in force now." />
            <Card
              title="Refused reset emails"
              href="/admin/monitoring/reset-emails?result=refused_email_limit"
              window={data.reset_emails_refused}
              note="Past the per-address limit of 3 an hour, 6 a day."
            />
          </div>

          <h2 className="text-lg font-semibold text-midnight-900 mb-3">Latest alerts</h2>
          {data.recent_alerts.length === 0 ? (
            <div className="card p-8 text-center text-midnight-900/50">No alerts yet.</div>
          ) : (
            <div className="card divide-y divide-midnight-900/5">
              {data.recent_alerts.map((a) => (
                <Link key={a.id} href="/admin/monitoring/suspicious" className="flex items-start justify-between gap-4 px-5 py-3 hover:bg-ivory-100/60">
                  <div className="min-w-0">
                    <div className="font-medium text-midnight-900">{RULES[a.rule] ?? a.rule}</div>
                    <div className="text-xs text-midnight-900/50">
                      {a.summary}
                      {a.account ? ` · ${a.account.full_name}` : ""}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${SEVERITY[a.severity]}`}>{a.severity}</span>
                    <div className="mt-1 text-xs text-midnight-900/45">
                      {when(a.created_at)} · {a.status}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
          <p className="mt-6 text-xs text-midnight-900/40">
            Alerts and sign-in history are kept {data.retention_months} months.{" "}
            {data.geoip_month
              ? `Country database: ${data.geoip_month}. ${GEOIP_CREDIT}`
              : "No country database in this build: countries show as unknown and the new-country check is off."}
          </p>
        </>
      )}
    </PortalShell>
  );
}
