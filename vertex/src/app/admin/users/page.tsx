"use client";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import PortalShell from "@/components/portal/PortalShell";
import { ADMIN_NAV_ITEMS } from "@/components/portal/adminNav";
import SearchableSelect from "@/components/SearchableSelect";
import SortableTh from "@/components/SortableTh";
import Pagination from "@/components/Pagination";
import { usePagination } from "@/lib/usePagination";
import { Plus, Copy, CheckCircle, Trash, Key, CaretDown, Check, SignOut } from "@phosphor-icons/react";
import FilterBar from "@/components/portal/FilterBar";

const ROLES = [
  { value: "candidate", label: "Candidate" },
  { value: "regional_recruiter", label: "Regional Recruiter" },
  { value: "country_supervisor", label: "Country Supervisor" },
  { value: "inhouse_supervisor", label: "In-House Supervisor" },
  { value: "director", label: "Director" },
  { value: "marketing", label: "Marketing" },
  { value: "hr", label: "HR" },
  { value: "operations_team", label: "Operations Team" },
  { value: "operations_director", label: "Operations Director" },
  { value: "finance", label: "Finance" },
  { value: "admin", label: "System Administrator" },
];

// Only real staff roles can be created directly — candidates self-register.
const STAFF_ROLES = ROLES.filter((r) => r.value !== "candidate");

interface StaffUser {
  id: string;
  full_name: string;
  email: string;
  role: string;
  supervisor_id: string | null;
  supervisor: { id: string; full_name: string } | null;
  assigned_country_id: string | null;
  assigned_country: { id: string; name: string } | null;
  assigned_countries: { id: string; name: string }[];
}

interface Country {
  id: string;
  name: string;
}

interface Draft {
  role: string;
  supervisor_id: string;
  assigned_country_id: string;
  assigned_country_ids: string[];
}

function draftFor(u: StaffUser): Draft {
  return {
    role: u.role,
    supervisor_id: u.supervisor_id ?? "",
    assigned_country_id: u.assigned_country_id ?? "",
    assigned_country_ids: u.assigned_countries.map((c) => c.id),
  };
}

function sameIds(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sortedB = [...b].sort();
  return [...a].sort().every((id, i) => id === sortedB[i]);
}

// A compact checkbox-popover multi-select, matching SearchableSelect's
// visual language — In-House Supervisor is the only role that can be
// assigned more than one country (2026-07), so this stays a small,
// locally-scoped component rather than a shared/generic one.
function CountryMultiSelect({
  values,
  onChange,
  countries,
  disabled,
}: {
  values: string[];
  onChange: (next: string[]) => void;
  countries: Country[];
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  const selectedNames = countries.filter((c) => values.includes(c.id)).map((c) => c.name);
  const toggle = (id: string) => {
    onChange(values.includes(id) ? values.filter((v) => v !== id) : [...values, id]);
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className="input-field py-2 text-xs flex items-center justify-between text-left disabled:opacity-40 w-full"
      >
        <span className={selectedNames.length ? "" : "text-midnight-900/35"}>
          {selectedNames.length ? selectedNames.join(", ") : "— None —"}
        </span>
        <CaretDown size={12} weight="bold" className="text-midnight-900/30 shrink-0 ml-2" />
      </button>
      {open && (
        <div className="absolute z-30 mt-1 w-full min-w-[200px] bg-white border border-midnight-900/15 rounded-lg shadow-xl overflow-hidden">
          <ul className="max-h-56 overflow-y-auto py-1">
            {countries.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => toggle(c.id)}
                  className="w-full flex items-center justify-between gap-2 px-3 py-2 text-sm text-left text-midnight-900/80 hover:bg-ivory-100"
                >
                  {c.name}
                  {values.includes(c.id) && <Check size={14} weight="bold" className="text-gold-600 shrink-0" />}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default function StaffUsersPage() {
  const [users, setUsers] = useState<StaffUser[]>([]);
  const [countries, setCountries] = useState<Country[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newStaff, setNewStaff] = useState({ full_name: "", email: "", role: "regional_recruiter" });
  const [createdCredentials, setCreatedCredentials] = useState<{ email: string; temporaryPassword: string; heading: string } | null>(null);
  const [copied, setCopied] = useState(false);
  // Staff creation no longer hands back a temp password (2026-07-27) — an
  // invite email lets the new staff member set their own, so this is just
  // a confirmation banner, not credentials to copy/share.
  const [inviteSentEmail, setInviteSentEmail] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (roleFilter) params.set("role", roleFilter);
    if (q) params.set("q", q);
    fetch(`/api/admin/users?${params}`)
      .then((r) => r.json())
      .then((res) => {
        const list: StaffUser[] = res.data ?? [];
        setUsers(list);
        setDrafts(Object.fromEntries(list.map((u) => [u.id, draftFor(u)])));
      })
      .catch(() => setError("Failed to load users."))
      .finally(() => setLoading(false));
  }, [roleFilter, q]);

  useEffect(() => {
    fetch("/api/admin/countries")
      .then((r) => r.json())
      .then((res) => setCountries(res.data ?? []));
  }, []);

  useEffect(() => {
    const timeout = setTimeout(load, 250); // debounce search-as-you-type
    return () => clearTimeout(timeout);
  }, [load]);

  const setDraft = (id: string, patch: Partial<Draft>) => {
    setDrafts((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  };

  const isDirty = (u: StaffUser) => {
    const d = drafts[u.id];
    if (!d) return false;
    if (d.role === "inhouse_supervisor") {
      return d.role !== u.role || d.supervisor_id !== (u.supervisor_id ?? "") || !sameIds(d.assigned_country_ids, u.assigned_countries.map((c) => c.id));
    }
    return d.role !== u.role || d.supervisor_id !== (u.supervisor_id ?? "") || d.assigned_country_id !== (u.assigned_country_id ?? "");
  };

  const saveRow = async (u: StaffUser) => {
    const d = drafts[u.id];
    setSavingId(u.id);
    setError("");
    try {
      const res = await fetch(`/api/admin/users/${u.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          role: d.role,
          supervisor_id: d.supervisor_id || null,
          ...(d.role === "inhouse_supervisor"
            ? { assigned_country_ids: d.assigned_country_ids }
            : { assigned_country_id: d.assigned_country_id || null }),
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error?.message || "Update failed.");
      setUsers((prev) => prev.map((row) => (row.id === u.id ? { ...row, ...body.data } : row)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed.");
    } finally {
      setSavingId(null);
    }
  };

  const deleteUser = async (u: StaffUser) => {
    if (!window.confirm(`Remove ${u.full_name} (${u.email})? This can't be undone.`)) return;
    setSavingId(u.id);
    setError("");
    try {
      const res = await fetch(`/api/admin/users/${u.id}`, { method: "DELETE" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error?.message || "Failed to remove user.");
      setUsers((prev) => prev.filter((row) => row.id !== u.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove user.");
    } finally {
      setSavingId(null);
    }
  };

  const resetPassword = async (u: StaffUser) => {
    if (!window.confirm(`Reset the password for ${u.full_name} (${u.email})? Their current password will stop working.`)) return;
    setSavingId(u.id);
    setError("");
    try {
      const res = await fetch(`/api/admin/users/${u.id}/reset-password`, { method: "POST" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error?.message || "Failed to reset password.");
      setCreatedCredentials({ email: u.email, temporaryPassword: body.temporaryPassword, heading: "Password reset" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reset password.");
    } finally {
      setSavingId(null);
    }
  };

  // G19: ends every session of the user at once; their next request is refused.
  const signOutEverywhere = async (u: StaffUser) => {
    if (!window.confirm(`Sign ${u.full_name} (${u.email}) out of every browser and device now?`)) return;
    setSavingId(u.id);
    setError("");
    try {
      const res = await fetch(`/api/admin/users/${u.id}/sessions`, { method: "DELETE" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error?.message || "Failed to end sessions.");
      window.alert(`${u.full_name}: ${body.data.ended} session${body.data.ended === 1 ? "" : "s"} ended.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to end sessions.");
    } finally {
      setSavingId(null);
    }
  };

  const staffOptions = users.filter((u) => u.role !== "candidate");
  const [sortBy, setSortBy] = useState<"full_name" | "role">("full_name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const handleSort = (key: string) => {
    if (sortBy === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortBy(key as "full_name" | "role"); setSortDir("asc"); }
  };
  const sortedUsers = useMemo(() => {
    return [...users].sort((a, b) => {
      const diff = sortBy === "role" ? a.role.localeCompare(b.role) : a.full_name.localeCompare(b.full_name);
      return sortDir === "asc" ? diff : -diff;
    });
  }, [users, sortBy, sortDir]);
  const { page, setPage, totalPages, paged, total, pageSize } = usePagination(sortedUsers);

  const handleCreateStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setError("");
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newStaff),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error?.message || "Failed to create staff member.");
      setInviteSentEmail(newStaff.email);
      setNewStaff({ full_name: "", email: "", role: "regional_recruiter" });
      setShowCreateForm(false);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create staff member.");
    } finally {
      setCreating(false);
    }
  };

  const copyTempPassword = () => {
    if (!createdCredentials) return;
    navigator.clipboard.writeText(createdCredentials.temporaryPassword);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <PortalShell roleLabel="System Administrator" navItems={ADMIN_NAV_ITEMS}>
      <div className="flex items-start justify-between gap-6 mb-2">
        <div>
          <p className="eyebrow mb-3">
            <span className="eyebrow-rule" />
            Team & access
          </p>
          <h1 className="section-title text-3xl md:text-4xl">Staff & Roles</h1>
        </div>
        <button
          onClick={() => { setShowCreateForm((v) => !v); setCreatedCredentials(null); setInviteSentEmail(null); }}
          className="btn-primary text-xs shrink-0"
        >
          <Plus size={16} weight="bold" /> Add Staff Member
        </button>
      </div>
      <p className="text-midnight-900/55 font-light mb-8 max-w-2xl">
        Create and manage every staff account — recruiters, supervisors, management, marketing, and other
        admins. Role, supervisor, and country changes are staged until you click Save on that row. You can also
        reset a user&rsquo;s password or remove their account entirely from here.
      </p>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4 text-sm mb-6">{error}</div>
      )}

      {createdCredentials && (
        <div className="card p-6 mb-6 border-l-4 border-gold-400">
          <div className="flex items-start gap-3">
            <CheckCircle size={22} weight="fill" className="text-gold-600 shrink-0 mt-0.5" />
            <div className="flex-1">
              <h3 className="font-semibold text-midnight-900 mb-1">{createdCredentials.heading}</h3>
              <p className="text-sm text-midnight-900/60 mb-3">
                Share this temporary password with <span className="font-medium">{createdCredentials.email}</span> now —
                it will not be shown again.
              </p>
              <div className="flex items-center gap-3">
                <code className="bg-ivory-100 border border-midnight-900/10 rounded-lg px-4 py-2 text-sm font-mono text-midnight-900">
                  {createdCredentials.temporaryPassword}
                </code>
                <button onClick={copyTempPassword} className="btn-secondary py-2 px-4 text-xs">
                  <Copy size={14} weight="bold" /> {copied ? "Copied!" : "Copy"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {inviteSentEmail && (
        <div className="card p-6 mb-6 border-l-4 border-gold-400">
          <div className="flex items-start gap-3">
            <CheckCircle size={22} weight="fill" className="text-gold-600 shrink-0 mt-0.5" />
            <div className="flex-1">
              <h3 className="font-semibold text-midnight-900 mb-1">Invite sent</h3>
              <p className="text-sm text-midnight-900/60">
                An email has been sent to <span className="font-medium">{inviteSentEmail}</span> with a link to set
                their own password.
              </p>
            </div>
          </div>
        </div>
      )}

      {showCreateForm && (
        <form method="post" onSubmit={handleCreateStaff} className="card p-6 mb-6 space-y-4">
          <h3 className="font-semibold text-midnight-900">New staff member</h3>
          <div className="grid sm:grid-cols-3 gap-4">
            <input
              required
              placeholder="Full name"
              value={newStaff.full_name}
              onChange={(e) => setNewStaff({ ...newStaff, full_name: e.target.value })}
              className="input-field"
            />
            <input
              required
              type="email"
              placeholder="Email address"
              value={newStaff.email}
              onChange={(e) => setNewStaff({ ...newStaff, email: e.target.value })}
              className="input-field"
            />
            <SearchableSelect
              value={newStaff.role}
              onChange={(value) => setNewStaff({ ...newStaff, role: value })}
              options={STAFF_ROLES.map((r) => ({ value: r.value, label: r.label }))}
            />
          </div>
          <button type="submit" disabled={creating} className="btn-primary text-xs disabled:opacity-60">
            {creating ? "Creating…" : "Create Account"}
          </button>
        </form>
      )}

      <FilterBar searchValue={q} onSearchChange={setQ} searchPlaceholder="Search by name or email…">
        <SearchableSelect
          value={roleFilter}
          onChange={setRoleFilter}
          placeholder="All staff roles"
          className="input-field w-56"
          options={[{ value: "", label: "All staff roles" }, ...ROLES.map((r) => ({ value: r.value, label: r.label }))]}
        />
      </FilterBar>

      {loading ? (
        <p className="text-midnight-900/50">Loading…</p>
      ) : users.length === 0 ? (
        <div className="card p-10 text-center text-midnight-900/50">No matching users.</div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-midnight-900/10 text-left text-midnight-900/40 text-xs uppercase tracking-wider">
                <SortableTh label="User" sortKey="full_name" activeSort={sortBy} activeDir={sortDir} onSort={handleSort} />
                <SortableTh label="Role" sortKey="role" activeSort={sortBy} activeDir={sortDir} onSort={handleSort} />
                <th className="px-5 py-3 font-semibold">Supervisor</th>
                <th className="px-5 py-3 font-semibold">Country</th>
                <th className="px-5 py-3 font-semibold"></th>
              </tr>
            </thead>
            <tbody>
              {paged.map((u) => {
                const d = drafts[u.id] ?? draftFor(u);
                const dirty = isDirty(u);
                const rowSaving = savingId === u.id;
                return (
                  <tr key={u.id} className="border-b border-midnight-900/5 last:border-0">
                    <td className="px-5 py-4">
                      <div className="font-medium text-midnight-900">{u.full_name}</div>
                      <div className="text-xs text-midnight-900/45">{u.email}</div>
                    </td>
                    <td className="px-5 py-4">
                      <SearchableSelect
                        value={d.role}
                        disabled={rowSaving}
                        onChange={(value) => setDraft(u.id, { role: value })}
                        className="input-field py-2 text-xs"
                        options={ROLES.map((r) => ({ value: r.value, label: r.label }))}
                      />
                    </td>
                    <td className="px-5 py-4">
                      <SearchableSelect
                        value={d.supervisor_id}
                        disabled={rowSaving || d.role === "candidate"}
                        onChange={(value) => setDraft(u.id, { supervisor_id: value })}
                        className="input-field py-2 text-xs disabled:opacity-40"
                        options={[
                          { value: "", label: "— None —" },
                          ...staffOptions.filter((s) => s.id !== u.id).map((s) => ({ value: s.id, label: s.full_name })),
                        ]}
                      />
                    </td>
                    <td className="px-5 py-4">
                      {d.role === "inhouse_supervisor" ? (
                        <CountryMultiSelect
                          values={d.assigned_country_ids}
                          disabled={rowSaving}
                          onChange={(next) => setDraft(u.id, { assigned_country_ids: next })}
                          countries={countries}
                        />
                      ) : (
                        <SearchableSelect
                          value={d.assigned_country_id}
                          disabled={rowSaving || d.role === "candidate"}
                          onChange={(value) => setDraft(u.id, { assigned_country_id: value })}
                          className="input-field py-2 text-xs disabled:opacity-40"
                          options={[{ value: "", label: "— None —" }, ...countries.map((c) => ({ value: c.id, label: c.name }))]}
                        />
                      )}
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-3 justify-end">
                        {dirty && (
                          <button
                            onClick={() => saveRow(u)}
                            disabled={rowSaving}
                            className="btn-primary py-1.5 px-4 text-xs disabled:opacity-60"
                          >
                            {rowSaving ? "Saving…" : "Save"}
                          </button>
                        )}
                        <button
                          onClick={() => resetPassword(u)}
                          disabled={rowSaving}
                          className="text-midnight-900/35 hover:text-gold-600 disabled:opacity-40"
                          aria-label="Reset password"
                          title="Reset password"
                        >
                          <Key size={16} weight="regular" />
                        </button>
                        <button
                          onClick={() => signOutEverywhere(u)}
                          disabled={rowSaving}
                          className="text-midnight-900/35 hover:text-gold-600 disabled:opacity-40"
                          aria-label="Sign out everywhere"
                          title="Sign out everywhere"
                        >
                          <SignOut size={16} weight="regular" />
                        </button>
                        <button
                          onClick={() => deleteUser(u)}
                          disabled={rowSaving}
                          className="text-midnight-900/35 hover:text-red-600 disabled:opacity-40"
                          aria-label="Remove user"
                          title="Remove user"
                        >
                          <Trash size={16} weight="regular" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="px-5">
            <Pagination page={page} totalPages={totalPages} onPageChange={setPage} total={total} pageSize={pageSize} />
          </div>
        </div>
      )}
    </PortalShell>
  );
}
