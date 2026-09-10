"use client";

import { useEffect, useMemo, useState } from "react";
import PortalShell from "@/components/portal/PortalShell";
import { MANAGEMENT_NAV_ITEMS } from "@/components/portal/managementNav";
import SearchableSelect from "@/components/SearchableSelect";
import SortableTh from "@/components/SortableTh";
import Pagination from "@/components/Pagination";
import { usePagination } from "@/lib/usePagination";
import { Buildings, Plus } from "@phosphor-icons/react";
import FilterBar from "@/components/portal/FilterBar";

const STATUS_STYLES: Record<string, string> = {
  active: "bg-emerald-100 text-emerald-800",
  inactive: "bg-slate-100 text-slate-600",
};

interface EmployerClient {
  id: string;
  name: string;
  country: string;
  industry: string | null;
  contact_name: string;
  contact_email: string;
  status: string;
  _count: { jobs: number };
}

const emptyForm = {
  name: "",
  country: "",
  industry: "",
  contact_name: "",
  contact_email: "",
  contact_phone: "",
};

// Employer/Client CRM (SRS FR-5.2) — the employer a vacancy is actually
// for. Simpler than Partner: no MOU/agreement workflow, just status.
export default function EmployerClientsPage() {
  const [clients, setClients] = useState<EmployerClient[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [form, setForm] = useState(emptyForm);
  const [creating, setCreating] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [countryFilter, setCountryFilter] = useState("");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const load = () => {
    setLoading(true);
    fetch("/api/admin/employer-clients")
      .then((r) => r.json())
      .then((res) => setClients(res.data ?? []))
      .catch(() => setError("Failed to load employer clients."))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const countries = useMemo(() => {
    const set = new Set(clients.map((c) => c.country));
    return [...set].map((c) => ({ value: c, label: c }));
  }, [clients]);

  const visibleClients = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let rows = clients;
    if (statusFilter) rows = rows.filter((c) => c.status === statusFilter);
    if (countryFilter) rows = rows.filter((c) => c.country === countryFilter);
    if (needle) {
      rows = rows.filter(
        (c) =>
          c.name.toLowerCase().includes(needle) ||
          c.contact_name.toLowerCase().includes(needle) ||
          c.contact_email.toLowerCase().includes(needle)
      );
    }
    return [...rows].sort((a, b) => (sortDir === "asc" ? a._count.jobs - b._count.jobs : b._count.jobs - a._count.jobs));
  }, [clients, q, statusFilter, countryFilter, sortDir]);

  const { page, setPage, totalPages, paged, total, pageSize } = usePagination(visibleClients);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setError("");
    try {
      const res = await fetch("/api/admin/employer-clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error?.message || "Failed to create employer client.");
      setForm(emptyForm);
      setShowForm(false);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create employer client.");
    } finally {
      setCreating(false);
    }
  };

  const toggleStatus = async (client: EmployerClient) => {
    const nextStatus = client.status === "active" ? "inactive" : "active";
    const res = await fetch(`/api/admin/employer-clients/${client.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: nextStatus }),
    });
    if (res.ok) {
      setClients((prev) => prev.map((c) => (c.id === client.id ? { ...c, status: nextStatus } : c)));
    }
  };

  return (
    <PortalShell roleLabel="Management" navItems={MANAGEMENT_NAV_ITEMS}>
      <div className="flex items-center justify-between mb-2">
        <div>
          <p className="eyebrow mb-3">
            <span className="eyebrow-rule" />
            Partner CRM
          </p>
          <h1 className="section-title text-3xl md:text-4xl mb-2">Employer Clients.</h1>
        </div>
        <button onClick={() => setShowForm((s) => !s)} className="btn-primary text-xs">
          <Plus size={16} weight="bold" /> Add Employer Client
        </button>
      </div>
      <p className="text-midnight-900/55 font-light mb-8 max-w-2xl">
        Employers vacancies are actually posted for (SRS FR-5.2) — link a job posting to a client on the Marketing portal.
      </p>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4 text-sm mb-8">{error}</div>}

      {showForm && (
        <form onSubmit={handleCreate} className="card p-6 mb-8 grid sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="employer-name" className="block text-xs font-medium text-midnight-900/60 mb-1.5">Client Name</label>
            <input id="employer-name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="input-field" placeholder="e.g. Nordic Logistics AB" />
          </div>
          <div>
            <label htmlFor="employer-country" className="block text-xs font-medium text-midnight-900/60 mb-1.5">Country</label>
            <input id="employer-country" required value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })} className="input-field" placeholder="e.g. Poland" />
          </div>
          <div>
            <label htmlFor="employer-industry" className="block text-xs font-medium text-midnight-900/60 mb-1.5">Industry <span className="text-midnight-900/35 font-normal">(optional)</span></label>
            <input id="employer-industry" value={form.industry} onChange={(e) => setForm({ ...form, industry: e.target.value })} className="input-field" placeholder="e.g. Warehousing & Logistics" />
          </div>
          <div>
            <label htmlFor="employer-contact-name" className="block text-xs font-medium text-midnight-900/60 mb-1.5">Contact Name</label>
            <input id="employer-contact-name" required value={form.contact_name} onChange={(e) => setForm({ ...form, contact_name: e.target.value })} className="input-field" />
          </div>
          <div>
            <label htmlFor="employer-contact-phone" className="block text-xs font-medium text-midnight-900/60 mb-1.5">Contact Phone</label>
            <input id="employer-contact-phone" required value={form.contact_phone} onChange={(e) => setForm({ ...form, contact_phone: e.target.value })} className="input-field" />
          </div>
          <div>
            <label htmlFor="employer-contact-email" className="block text-xs font-medium text-midnight-900/60 mb-1.5">Contact Email</label>
            <input id="employer-contact-email" required type="email" value={form.contact_email} onChange={(e) => setForm({ ...form, contact_email: e.target.value })} className="input-field" />
          </div>
          <div className="sm:col-span-2 flex justify-end gap-3 pt-2">
            <button type="button" onClick={() => setShowForm(false)} className="btn-secondary text-xs px-5">Cancel</button>
            <button type="submit" disabled={creating} className="btn-primary text-xs px-5 disabled:opacity-60">
              {creating ? "Adding…" : "Add Client"}
            </button>
          </div>
        </form>
      )}

      {!loading && clients.length > 0 && (
        <FilterBar searchValue={q} onSearchChange={setQ} searchPlaceholder="Search by name or contact…">
          <SearchableSelect
            value={countryFilter}
            onChange={setCountryFilter}
            placeholder="All countries"
            className="input-field w-48"
            options={[{ value: "", label: "All countries" }, ...countries]}
          />
          <SearchableSelect
            value={statusFilter}
            onChange={setStatusFilter}
            placeholder="All statuses"
            className="input-field w-44"
            options={[{ value: "", label: "All statuses" }, { value: "active", label: "Active" }, { value: "inactive", label: "Inactive" }]}
          />
        </FilterBar>
      )}

      {loading ? (
        <p className="text-midnight-900/50">Loading…</p>
      ) : clients.length === 0 ? (
        <div className="card p-10 text-center text-midnight-900/50">No employer clients yet — add one above.</div>
      ) : visibleClients.length === 0 ? (
        <div className="card p-10 text-center text-midnight-900/50">No clients match your filters.</div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-midnight-900/10 text-left text-midnight-900/40 text-xs uppercase tracking-wider">
                <th className="px-5 py-3 font-semibold">Client</th>
                <th className="px-5 py-3 font-semibold">Country</th>
                <th className="px-5 py-3 font-semibold">Industry</th>
                <th className="px-5 py-3 font-semibold">Status</th>
                <SortableTh label="Jobs" sortKey="jobs" activeSort="jobs" activeDir={sortDir} onSort={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))} />
              </tr>
            </thead>
            <tbody>
              {paged.map((c) => (
                <tr key={c.id} className="border-b border-midnight-900/5 last:border-0">
                  <td className="px-5 py-4">
                    <div className="font-medium text-midnight-900 flex items-center gap-2">
                      <Buildings size={15} weight="regular" className="text-gold-600 shrink-0" />
                      {c.name}
                    </div>
                    <div className="text-xs text-midnight-900/45 mt-0.5">{c.contact_name} · {c.contact_email}</div>
                  </td>
                  <td className="px-5 py-4 text-midnight-900/70">{c.country}</td>
                  <td className="px-5 py-4 text-midnight-900/70">{c.industry ?? "—"}</td>
                  <td className="px-5 py-4">
                    <button
                      onClick={() => toggleStatus(c)}
                      className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold ${STATUS_STYLES[c.status] ?? "bg-slate-100 text-slate-700"}`}
                    >
                      {c.status}
                    </button>
                  </td>
                  <td className="px-5 py-4 text-midnight-900/70">{c._count.jobs}</td>
                </tr>
              ))}
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
