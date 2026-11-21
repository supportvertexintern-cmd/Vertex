"use client";

import { useEffect, useMemo, useState } from "react";
import PortalShell from "@/components/portal/PortalShell";
import { ADMIN_NAV_ITEMS } from "@/components/portal/adminNav";
import { useDialog } from "@/components/ui/DialogProvider";
import { LockSimple } from "@phosphor-icons/react";

// Role management (2026-11-21): which internal roles hold each permission.
// FastAPI decides (vertex_be/app/api/v1/roles.py): admin holds everything
// and can't be changed, external roles aren't listed and are refused, and
// every route checks the permission itself. This page only shows and sets
// the ticks.

interface PermissionInfo {
  key: string;
  group: string;
  label: string;
  description: string;
}

interface RoleRow {
  role: string;
  editable: boolean;
  permissions: string[];
}

const ROLE_LABELS: Record<string, string> = {
  admin: "System Administrator",
  regional_recruiter: "Regional Recruiter",
  country_supervisor: "Country Supervisor",
  inhouse_supervisor: "In-House Supervisor",
  director: "Director",
  marketing: "Marketing",
  hr: "HR",
  operations_team: "Operations Team",
  operations_director: "Operations Director",
  finance: "Finance",
  virtual_assistant: "Virtual Assistant",
};

const roleLabel = (role: string) => ROLE_LABELS[role] ?? role;

export default function RolesPage() {
  const dialog = useDialog();
  const [permissions, setPermissions] = useState<PermissionInfo[]>([]);
  const [roles, setRoles] = useState<RoleRow[]>([]);
  // The unsaved ticks, by role.
  const [edits, setEdits] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  // Once, on opening (loading starts true).
  const load = () => {
    fetch("/api/admin/roles")
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body.error?.message || "Failed to load roles.");
        setPermissions(body.data.permissions);
        setRoles(body.data.roles);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load roles."))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  // Column groups for the header: consecutive permissions sharing a group.
  const groups = useMemo(() => {
    const out: { group: string; span: number }[] = [];
    for (const p of permissions) {
      const last = out[out.length - 1];
      if (last && last.group === p.group) last.span += 1;
      else out.push({ group: p.group, span: 1 });
    }
    return out;
  }, [permissions]);

  const labelOf = (key: string) => {
    const p = permissions.find((x) => x.key === key);
    return p ? `${p.group}: ${p.label}` : key;
  };

  const ticks = (row: RoleRow) => edits[row.role] ?? row.permissions;
  const isDirty = (row: RoleRow) => {
    const now = edits[row.role];
    return now !== undefined && (now.length !== row.permissions.length || now.some((p) => !row.permissions.includes(p)));
  };

  const toggle = (row: RoleRow, key: string) => {
    setNotice("");
    const current = ticks(row);
    const next = current.includes(key) ? current.filter((p) => p !== key) : [...current, key];
    // In the permissions' own order, as FastAPI answers.
    setEdits((e) => ({ ...e, [row.role]: permissions.map((p) => p.key).filter((k) => next.includes(k)) }));
  };

  const reset = (row: RoleRow) =>
    setEdits((e) => {
      const { [row.role]: _dropped, ...rest } = e;
      return rest;
    });

  const save = async (row: RoleRow) => {
    const wanted = ticks(row);
    const added = wanted.filter((p) => !row.permissions.includes(p));
    const removed = row.permissions.filter((p) => !wanted.includes(p));
    const lines = [
      ...added.map((p) => `Give: ${labelOf(p)}`),
      ...removed.map((p) => `Take away: ${labelOf(p)}`),
    ];
    const ok = await dialog.confirm(
      `Change what ${roleLabel(row.role)} can do?\n\n${lines.join("\n")}\n\nIt applies to everyone with this role at once.`,
      { confirmLabel: "Save changes", danger: removed.length > 0 },
    );
    if (!ok) return;

    setSaving(row.role);
    setError("");
    setNotice("");
    try {
      const res = await fetch(`/api/admin/roles/${encodeURIComponent(row.role)}/permissions`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ permissions: wanted }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error?.message || "Failed to save.");
      const saved: RoleRow = body.data;
      setRoles((rs) => rs.map((r) => (r.role === saved.role ? saved : r)));
      reset(row);
      setNotice(`Saved: ${roleLabel(saved.role)}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save.");
    } finally {
      setSaving(null);
    }
  };

  return (
    <PortalShell roleLabel="System Administrator" navItems={ADMIN_NAV_ITEMS}>
      <p className="eyebrow mb-3">
        <span className="eyebrow-rule" />
        Access control
      </p>
      <h1 className="section-title text-3xl md:text-4xl mb-2">Roles & Permissions</h1>
      <p className="text-midnight-900/55 font-light mb-10 max-w-2xl">
        Choose which roles can do each task. A change applies to everyone with that role straight away, and is recorded in the
        audit trail. System Administrator always has every permission. Candidates, partners and referral agents can&apos;t be
        given any. Each user&apos;s role is set on Staff &amp; Roles.
      </p>

      {error && (
        <div role="alert" className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4 text-sm mb-8">
          {error}
        </div>
      )}
      {notice && (
        <div role="status" className="bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-lg p-4 text-sm mb-8">
          {notice}
        </div>
      )}

      {loading ? (
        <div className="card p-10 text-center text-midnight-900/50">Loading…</div>
      ) : roles.length > 0 && (
        <>
          <div className="card overflow-x-auto mb-8">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-midnight-900/40 text-xs uppercase tracking-wider">
                  <th className="px-5 pt-4" />
                  {groups.map((g) => (
                    <th key={g.group} colSpan={g.span} className="px-5 pt-4 font-semibold text-center">
                      {g.group}
                    </th>
                  ))}
                  <th className="px-5 pt-4" />
                </tr>
                <tr className="border-b border-midnight-900/10 text-left text-midnight-900/40 text-xs uppercase tracking-wider">
                  <th className="px-5 py-3 font-semibold">Role</th>
                  {permissions.map((p) => (
                    <th key={p.key} className="px-5 py-3 font-semibold text-center" title={p.description}>
                      {p.label}
                    </th>
                  ))}
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody>
                {roles.map((row) => {
                  const dirty = isDirty(row);
                  return (
                    <tr key={row.role} className={`border-b border-midnight-900/5 ${dirty ? "bg-ivory-100" : ""}`}>
                      <td className="px-5 py-3 font-medium text-midnight-900 whitespace-nowrap">
                        <span className="inline-flex items-center gap-2">
                          {roleLabel(row.role)}
                          {!row.editable && <LockSimple size={14} className="text-midnight-900/40" aria-label="Always has every permission" />}
                        </span>
                      </td>
                      {permissions.map((p) => (
                        <td key={p.key} className="px-5 py-3 text-center">
                          <input
                            type="checkbox"
                            className="h-4 w-4 accent-midnight-800 disabled:opacity-50"
                            checked={ticks(row).includes(p.key)}
                            disabled={!row.editable || saving === row.role}
                            onChange={() => toggle(row, p.key)}
                            aria-label={`${roleLabel(row.role)}: ${p.group}: ${p.label}`}
                          />
                        </td>
                      ))}
                      <td className="px-5 py-3 text-right whitespace-nowrap">
                        {dirty && (
                          <span className="inline-flex gap-2">
                            <button
                              type="button"
                              onClick={() => reset(row)}
                              disabled={saving === row.role}
                              className="px-3 py-1.5 text-xs font-semibold text-midnight-900/60 hover:text-midnight-900"
                            >
                              Undo
                            </button>
                            <button
                              type="button"
                              onClick={() => save(row)}
                              disabled={saving === row.role}
                              className="btn-primary px-3 py-1.5 text-xs disabled:opacity-60"
                              aria-label={`Save ${roleLabel(row.role)}`}
                            >
                              {saving === row.role ? "Saving…" : "Save"}
                            </button>
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="card p-6">
            <h2 className="font-semibold text-midnight-900 mb-4">What each permission allows</h2>
            <dl className="space-y-3 text-sm">
              {permissions.map((p) => (
                <div key={p.key}>
                  <dt className="font-medium text-midnight-900">
                    {p.group}: {p.label}
                  </dt>
                  <dd className="text-midnight-900/55 font-light">{p.description}</dd>
                </div>
              ))}
            </dl>
          </div>
        </>
      )}
    </PortalShell>
  );
}
