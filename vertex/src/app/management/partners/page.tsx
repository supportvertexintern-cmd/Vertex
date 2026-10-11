"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import PortalShell from "@/components/portal/PortalShell";
import { MANAGEMENT_NAV_ITEMS } from "@/components/portal/managementNav";
import SearchableSelect from "@/components/SearchableSelect";
import SortableTh from "@/components/SortableTh";
import Pagination from "@/components/Pagination";
import { usePagination } from "@/lib/usePagination";
import { Handshake, Plus, Trash, Key } from "@phosphor-icons/react";
import FilterBar from "@/components/portal/FilterBar";

const PARTNER_TYPE_LABELS: Record<string, string> = {
  travel_agency: "Travel Agency",
  visa_consultancy: "Visa Consultancy",
  manpower_supplier: "Manpower Supplier",
  other: "Other",
};

const STATUS_STYLES: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-800",
  active: "bg-emerald-100 text-emerald-800",
  suspended: "bg-red-100 text-red-700",
};

const MOU_STYLES: Record<string, string> = {
  none: "bg-slate-100 text-slate-600",
  sent: "bg-blue-100 text-blue-700",
  signed: "bg-emerald-100 text-emerald-800",
};

const STATUS_FILTER_OPTIONS = [
  { value: "", label: "All statuses" },
  { value: "pending", label: "Pending" },
  { value: "active", label: "Active" },
  { value: "suspended", label: "Suspended" },
];

const TYPE_FILTER_OPTIONS = [
  { value: "", label: "All types" },
  { value: "travel_agency", label: "Travel Agency" },
  { value: "visa_consultancy", label: "Visa Consultancy" },
  { value: "manpower_supplier", label: "Manpower Supplier" },
  { value: "other", label: "Other" },
];

interface Partner {
  id: string;
  name: string;
  partner_type: string;
  country_of_operation: string;
  status: string;
  mou_status: string;
  contact_name: string;
  contact_email: string;
  user_id: string | null;
  _count: { candidates: number };
}

const emptyForm = {
  name: "",
  partner_type: "travel_agency",
  country_of_operation: "",
  business_registration_number: "",
  contact_name: "",
  contact_email: "",
  contact_phone: "",
};

// Partner CRM (SRS FR-5.1) — travel agencies, visa consultancies, manpower
// suppliers that source candidate leads via the Agency Application Form.
// Staff-managed only: no partner self-service portal, since agency
// submissions still come in by email and get re-keyed here.
export default function PartnersPage() {
  const [partners, setPartners] = useState<Partner[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [form, setForm] = useState(emptyForm);
  const [creating, setCreating] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [actioningId, setActioningId] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");

  const load = () => {
    setLoading(true);
    fetch("/api/admin/partners")
      .then((r) => r.json())
      .then((res) => setPartners(res.data ?? []))
      .catch(() => setError("Failed to load partners."))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const [sortBy, setSortBy] = useState<"candidates" | "status">("candidates");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const handleSort = (key: string) => {
    if (sortBy === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortBy(key as "candidates" | "status"); setSortDir("asc"); }
  };

  const filteredPartners = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const rows = partners.filter((p) => {
      if (statusFilter && p.status !== statusFilter) return false;
      if (typeFilter && p.partner_type !== typeFilter) return false;
      if (!needle) return true;
      return (
        p.name.toLowerCase().includes(needle) ||
        p.contact_name.toLowerCase().includes(needle) ||
        p.contact_email.toLowerCase().includes(needle) ||
        p.country_of_operation.toLowerCase().includes(needle)
      );
    });
    return [...rows].sort((a, b) => {
      const diff = sortBy === "status" ? a.status.localeCompare(b.status) : a._count.candidates - b._count.candidates;
      return sortDir === "asc" ? diff : -diff;
    });
  }, [partners, q, statusFilter, typeFilter, sortBy, sortDir]);

  const { page, setPage, totalPages, paged, total, pageSize } = usePagination(filteredPartners);

  useEffect(() => setPage(1), [q, statusFilter, typeFilter]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setError("");
    try {
      const res = await fetch("/api/admin/partners", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error?.message || "Failed to create partner.");
      setForm(emptyForm);
      setShowForm(false);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create partner.");
    } finally {
      setCreating(false);
    }
  };

  const deletePartner = async (p: Partner) => {
    if (!window.confirm(`Remove ${p.name}? This can't be undone.`)) return;
    setActioningId(p.id);
    setError("");
    setNotice("");
    try {
      const res = await fetch(`/api/admin/partners/${p.id}`, { method: "DELETE" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error?.message || "Failed to remove partner.");
      setPartners((prev) => prev.filter((row) => row.id !== p.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove partner.");
    } finally {
      setActioningId(null);
    }
  };

  const resetPassword = async (p: Partner) => {
    if (!window.confirm(`Reset the password for ${p.name} (${p.contact_email})? Their current password will stop working, and they'll be emailed a link to set a new one.`)) return;
    setActioningId(p.id);
    setError("");
    setNotice("");
    try {
      const res = await fetch(`/api/admin/partners/${p.id}/reset-password`, { method: "POST" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error?.message || "Failed to reset password.");
      setNotice(`Password reset — an email has been sent to ${body.data.email} with a link to set a new one.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reset password.");
    } finally {
      setActioningId(null);
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
          <h1 className="section-title text-3xl md:text-4xl mb-2">Partners.</h1>
        </div>
        <button onClick={() => setShowForm((s) => !s)} className="btn-primary text-xs">
          <Plus size={16} weight="bold" /> Add Partner
        </button>
      </div>
      <p className="text-midnight-900/55 font-light mb-8 max-w-2xl">
        Travel agencies, visa consultancies, and manpower suppliers that source candidate leads (SRS FR-5.1).
        Agency submissions still arrive by email — add the agency here, then register the candidate against it.
      </p>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4 text-sm mb-8">{error}</div>}
      {notice && <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-lg p-4 text-sm mb-8">{notice}</div>}

      {showForm && (
        <form method="post" onSubmit={handleCreate} className="card p-6 mb-8 grid sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="partner-name" className="block text-xs font-medium text-midnight-900/60 mb-1.5">Agency Name</label>
            <input id="partner-name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="input-field" placeholder="e.g. Horizon Travel & Visa Services" />
          </div>
          <div>
            <label htmlFor="partner-type" className="block text-xs font-medium text-midnight-900/60 mb-1.5">Partner Type</label>
            <SearchableSelect
              id="partner-type"
              value={form.partner_type}
              onChange={(value) => setForm({ ...form, partner_type: value })}
              options={Object.entries(PARTNER_TYPE_LABELS).map(([value, label]) => ({ value, label }))}
            />
          </div>
          <div>
            <label htmlFor="partner-country" className="block text-xs font-medium text-midnight-900/60 mb-1.5">Country of Operation</label>
            <input id="partner-country" required value={form.country_of_operation} onChange={(e) => setForm({ ...form, country_of_operation: e.target.value })} className="input-field" placeholder="e.g. Kenya" />
          </div>
          <div>
            <label htmlFor="partner-reg-number" className="block text-xs font-medium text-midnight-900/60 mb-1.5">Business Registration No. <span className="text-midnight-900/35 font-normal">(optional)</span></label>
            <input id="partner-reg-number" value={form.business_registration_number} onChange={(e) => setForm({ ...form, business_registration_number: e.target.value })} className="input-field" />
          </div>
          <div>
            <label htmlFor="partner-contact-name" className="block text-xs font-medium text-midnight-900/60 mb-1.5">Contact Name</label>
            <input id="partner-contact-name" required value={form.contact_name} onChange={(e) => setForm({ ...form, contact_name: e.target.value })} className="input-field" />
          </div>
          <div>
            <label htmlFor="partner-contact-phone" className="block text-xs font-medium text-midnight-900/60 mb-1.5">Contact Phone</label>
            <input id="partner-contact-phone" required value={form.contact_phone} onChange={(e) => setForm({ ...form, contact_phone: e.target.value })} className="input-field" />
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="partner-contact-email" className="block text-xs font-medium text-midnight-900/60 mb-1.5">Contact Email</label>
            <input id="partner-contact-email" required type="email" value={form.contact_email} onChange={(e) => setForm({ ...form, contact_email: e.target.value })} className="input-field" />
          </div>
          <div className="sm:col-span-2 flex justify-end gap-3 pt-2">
            <button type="button" onClick={() => setShowForm(false)} className="btn-secondary text-xs px-5">Cancel</button>
            <button type="submit" disabled={creating} className="btn-primary text-xs px-5 disabled:opacity-60">
              {creating ? "Adding…" : "Add Partner"}
            </button>
          </div>
        </form>
      )}

      {partners.length > 0 && (
        <FilterBar searchValue={q} onSearchChange={setQ} searchPlaceholder="Search by agency, contact, email, or country…">
          <SearchableSelect value={statusFilter} onChange={setStatusFilter} className="input-field w-48" options={STATUS_FILTER_OPTIONS} />
          <SearchableSelect value={typeFilter} onChange={setTypeFilter} className="input-field w-56" options={TYPE_FILTER_OPTIONS} />
        </FilterBar>
      )}

      {loading ? (
        <p className="text-midnight-900/50">Loading…</p>
      ) : partners.length === 0 ? (
        <div className="card p-10 text-center text-midnight-900/50">No partners yet — add one above.</div>
      ) : filteredPartners.length === 0 ? (
        <div className="card p-10 text-center text-midnight-900/50">No partners match your filters.</div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-midnight-900/10 text-left text-midnight-900/40 text-xs uppercase tracking-wider">
                <th className="px-5 py-3 font-semibold">Agency</th>
                <th className="px-5 py-3 font-semibold">Type</th>
                <th className="px-5 py-3 font-semibold">Country</th>
                <SortableTh label="Status" sortKey="status" activeSort={sortBy} activeDir={sortDir} onSort={handleSort} />
                <th className="px-5 py-3 font-semibold">MOU</th>
                <SortableTh label="Candidates Sourced" sortKey="candidates" activeSort={sortBy} activeDir={sortDir} onSort={handleSort} />
                <th className="px-5 py-3 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {paged.map((p) => (
                <tr key={p.id} className="border-b border-midnight-900/5 last:border-0">
                  <td className="px-5 py-4">
                    <Link href={`/management/partners/${p.id}`} className="font-medium text-midnight-900 hover:text-gold-600 flex items-center gap-2">
                      <Handshake size={15} weight="regular" className="text-gold-600 shrink-0" />
                      {p.name}
                    </Link>
                    <div className="text-xs text-midnight-900/45 mt-0.5">{p.contact_name} · {p.contact_email}</div>
                  </td>
                  <td className="px-5 py-4 text-midnight-900/70">{PARTNER_TYPE_LABELS[p.partner_type] ?? p.partner_type}</td>
                  <td className="px-5 py-4 text-midnight-900/70">{p.country_of_operation}</td>
                  <td className="px-5 py-4">
                    <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold ${STATUS_STYLES[p.status] ?? "bg-slate-100 text-slate-700"}`}>
                      {p.status}
                    </span>
                  </td>
                  <td className="px-5 py-4">
                    <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold ${MOU_STYLES[p.mou_status] ?? "bg-slate-100 text-slate-700"}`}>
                      {p.mou_status}
                    </span>
                  </td>
                  <td className="px-5 py-4 text-midnight-900/70">{p._count.candidates}</td>
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-3">
                      {p.user_id && (
                        <button
                          onClick={() => resetPassword(p)}
                          disabled={actioningId === p.id}
                          title="Reset password"
                          className="text-midnight-900/40 hover:text-gold-600 disabled:opacity-40"
                        >
                          <Key size={16} weight="regular" />
                        </button>
                      )}
                      <button
                        onClick={() => deletePartner(p)}
                        disabled={actioningId === p.id}
                        title="Delete partner"
                        className="text-midnight-900/40 hover:text-red-600 disabled:opacity-40"
                      >
                        <Trash size={16} weight="regular" />
                      </button>
                    </div>
                  </td>
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
