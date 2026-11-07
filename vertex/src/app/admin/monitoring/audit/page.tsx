"use client";

// Admin → Monitoring → Audit Trail (owner's requirements 2026-11-07, phase
// 4): who did what and when, read-only. Filters come from the address too
// (?entity_type=&entity_id=&action=&actor_id=), so "View history" links open
// it on one record. FastAPI records every read (audit_trail_viewed); nothing
// here can change or delete an entry.

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import PortalShell from "@/components/portal/PortalShell";
import { ADMIN_NAV_ITEMS } from "@/components/portal/adminNav";
import SearchableSelect from "@/components/SearchableSelect";
import Pagination from "@/components/Pagination";

const PAGE_SIZE = 50;

const ACTIONS = [
  "create", "update", "delete", "restore", "login_succeeded", "login_failed", "logout", "sessions_revoked",
  "account_deactivated", "account_reactivated", "password_reset_requested", "password_reset_completed",
  "access_denied", "export", "alert_raised", "audit_trail_viewed", "document_downloaded", "malware_rejected",
];

const RECORD_TYPES = [
  "Auth", "User", "Partner", "PartnerCandidate", "Candidate", "Application", "Document", "Case", "CasePayment",
  "Payment", "Job", "SecurityAlert", "Session", "SystemSetting", "ReferralAgent", "AuditLog",
];

interface Change {
  field: string;
  before: unknown;
  after: unknown;
}

interface Entry {
  id: string;
  at: string;
  actor: { id: string; full_name: string } | null;
  action: string;
  entity_type: string;
  entity_id: string;
  record: string | null;
  changes: Change[];
  detail: Record<string, unknown> | null;
  ip: string | null;
  request_id: string | null;
}

function when(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "medium" });
}

function show(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  return typeof value === "string" ? value : JSON.stringify(value);
}

export default function AuditTrailPage() {
  return (
    <Suspense>
      <AuditTrail />
    </Suspense>
  );
}

function AuditTrail() {
  const params = useSearchParams();
  const [rows, setRows] = useState<Entry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [action, setAction] = useState(params.get("action") ?? "");
  const [entityType, setEntityType] = useState(params.get("entity_type") ?? "");
  const [entityId, setEntityId] = useState(params.get("entity_id") ?? "");
  const [actorId, setActorId] = useState(params.get("actor_id") ?? "");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    const query = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
    for (const [key, value] of Object.entries({
      action, entity_type: entityType, entity_id: entityId.trim(), actor_id: actorId.trim(), date_from: dateFrom, date_to: dateTo,
    })) {
      if (value) query.set(key, value);
    }
    fetch(`/api/admin/monitoring/audit?${query}`)
      .then(async (r) => {
        const body = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(body.error?.message || "Failed to load the audit trail.");
        setRows(body.data ?? []);
        setTotal(Number(body.total ?? 0));
        setError("");
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load the audit trail."))
      .finally(() => setLoading(false));
  }, [action, entityType, entityId, actorId, dateFrom, dateTo, page]);

  useEffect(() => {
    const timeout = setTimeout(load, 300); // debounce typing in the id boxes
    return () => clearTimeout(timeout);
  }, [load]);

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
      <h1 className="section-title text-3xl md:text-4xl mb-2">Audit Trail</h1>
      <p className="text-midnight-900/55 font-light mb-8 max-w-2xl">
        Who did what and when, newest first. Read-only. Each time this page loads, that is recorded too.
      </p>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4 text-sm mb-6">{error}</div>}

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <SearchableSelect
          value={action}
          onChange={filter(setAction)}
          placeholder="Any action"
          className="input-field w-56"
          options={[{ value: "", label: "Any action" }, ...ACTIONS.map((a) => ({ value: a, label: a.replace(/_/g, " ") }))]}
        />
        <SearchableSelect
          value={entityType}
          onChange={filter(setEntityType)}
          placeholder="Any record type"
          className="input-field w-52"
          options={[{ value: "", label: "Any record type" }, ...RECORD_TYPES.map((t) => ({ value: t, label: t }))]}
        />
        <input
          value={entityId}
          onChange={(e) => filter(setEntityId)(e.target.value)}
          placeholder="Record id"
          aria-label="Record id"
          className="input-field py-2 text-xs w-56"
        />
        <input
          value={actorId}
          onChange={(e) => filter(setActorId)(e.target.value)}
          placeholder="Actor (user id)"
          aria-label="Actor user id"
          className="input-field py-2 text-xs w-56"
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
        <div className="card p-10 text-center text-midnight-900/50">No matching entries.</div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-midnight-900/10 text-left text-midnight-900/40 text-xs uppercase tracking-wider">
                <th className="px-5 py-3 font-semibold">Time</th>
                <th className="px-5 py-3 font-semibold">Actor</th>
                <th className="px-5 py-3 font-semibold">Action</th>
                <th className="px-5 py-3 font-semibold">Record</th>
                <th className="px-5 py-3 font-semibold">Changes</th>
                <th className="px-5 py-3 font-semibold">Address</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const items = r.changes.length
                  ? r.changes.map((c) => `${c.field}: ${show(c.before)} → ${show(c.after)}`)
                  : Object.entries(r.detail ?? {}).filter(([k]) => k !== "ip").map(([k, v]) => `${k}: ${show(v)}`);
                const open = expanded === r.id;
                return (
                  <tr key={r.id} className="border-b border-midnight-900/5 last:border-0 align-top">
                    <td className="px-5 py-3 whitespace-nowrap text-midnight-900/70">{when(r.at)}</td>
                    <td className="px-5 py-3 text-midnight-900/80">
                      {r.actor ? (
                        <button type="button" className="text-left hover:underline" onClick={() => filter(setActorId)(r.actor!.id)}>
                          {r.actor.full_name}
                        </button>
                      ) : (
                        <span className="text-midnight-900/40">system</span>
                      )}
                    </td>
                    <td className="px-5 py-3 font-medium text-midnight-900">{r.action.replace(/_/g, " ")}</td>
                    <td className="px-5 py-3">
                      <div className="text-midnight-900">
                        {r.entity_type}
                        {r.record ? ` “${r.record}”` : ""}
                      </div>
                      <button
                        type="button"
                        className="text-xs text-midnight-900/40 break-all text-left hover:underline"
                        onClick={() => filter(setEntityId)(r.entity_id.startsWith("user:") ? r.entity_id.slice(5) : r.entity_id)}
                      >
                        {r.entity_id}
                      </button>
                    </td>
                    <td className="px-5 py-3 text-xs text-midnight-900/70 max-w-md">
                      {items.length === 0 ? (
                        "—"
                      ) : (
                        <>
                          <ul className="space-y-0.5 break-words">
                            {(open ? items : items.slice(0, 3)).map((item, i) => (
                              <li key={i}>{item}</li>
                            ))}
                          </ul>
                          {items.length > 3 && (
                            <button type="button" className="mt-1 text-gold-700 hover:underline" onClick={() => setExpanded(open ? null : r.id)}>
                              {open ? "Show less" : `${items.length - 3} more`}
                            </button>
                          )}
                        </>
                      )}
                    </td>
                    <td className="px-5 py-3 text-xs text-midnight-900/60">{r.ip ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Pagination page={page} totalPages={Math.max(1, Math.ceil(total / PAGE_SIZE))} onPageChange={setPage} total={total} pageSize={PAGE_SIZE} />
      <p className="mt-4 text-xs text-midnight-900/40">
        A record&rsquo;s own history opens from <Link href="/admin/monitoring/accounts" className="underline">User Accounts</Link> and{" "}
        <Link href="/admin/monitoring/partners" className="underline">Partners &amp; Logins</Link> (&ldquo;View history&rdquo;).
      </p>
    </PortalShell>
  );
}
