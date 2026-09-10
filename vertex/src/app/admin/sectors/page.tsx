"use client";

import { useEffect, useState } from "react";
import PortalShell from "@/components/portal/PortalShell";
import { ADMIN_NAV_ITEMS } from "@/components/portal/adminNav";
import SearchableSelect from "@/components/SearchableSelect";
import Pagination from "@/components/Pagination";
import { usePagination } from "@/lib/usePagination";
import { Briefcase, Plus, Trash, FileText, Files } from "@phosphor-icons/react";
import { NON_PROGRAMME_TYPE_KEYS } from "@/lib/documentTypes";

interface Sector {
  id: string;
  name: string;
}

interface Country {
  id: string;
  name: string;
  region: { id: string; name: string };
}

interface DocumentRequirementType {
  id: string;
  key: string;
  label: string;
  is_universal: boolean;
}

export default function SectorsPage() {
  const [sectors, setSectors] = useState<Sector[]>([]);
  const [countries, setCountries] = useState<Country[]>([]);
  const [documentTypes, setDocumentTypes] = useState<DocumentRequirementType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [newSectorName, setNewSectorName] = useState("");
  const [creatingSector, setCreatingSector] = useState(false);

  const [newDocTypeLabel, setNewDocTypeLabel] = useState("");
  const [creatingDocType, setCreatingDocType] = useState(false);

  const [selectedCountryId, setSelectedCountryId] = useState("");
  const [requiredTypes, setRequiredTypes] = useState<Set<string>>(new Set());
  const [loadingRequirements, setLoadingRequirements] = useState(false);
  const [savingRequirements, setSavingRequirements] = useState(false);

  const load = () => {
    setLoading(true);
    Promise.all([
      fetch("/api/admin/sectors").then((r) => r.json()),
      fetch("/api/admin/countries").then((r) => r.json()),
      fetch("/api/admin/document-types").then((r) => r.json()),
    ])
      .then(([sectorsRes, countriesRes, docTypesRes]) => {
        setSectors(sectorsRes.data ?? []);
        setCountries(countriesRes.data ?? []);
        setDocumentTypes(docTypesRes.data ?? []);
      })
      .catch(() => setError("Failed to load reference data."))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const { page, setPage, totalPages, paged, total, pageSize } = usePagination(sectors);
  const docTypesPage = usePagination(documentTypes);

  // Universal types (cv/passport/passport_photo) and the legacy Phase-4
  // mobility-lifecycle set aren't offered as per-country requirements —
  // they either apply everywhere already or have no country-requirement
  // concept at all.
  const requirementEligibleTypes = documentTypes.filter(
    (t) => !t.is_universal && !(NON_PROGRAMME_TYPE_KEYS as readonly string[]).includes(t.key)
  );

  useEffect(() => {
    if (!selectedCountryId) {
      setRequiredTypes(new Set());
      return;
    }
    setLoadingRequirements(true);
    fetch(`/api/admin/countries/${selectedCountryId}/document-requirements`)
      .then((r) => r.json())
      .then((res) => {
        const types: string[] = (res.data ?? []).map((r: { document_type: string }) => r.document_type);
        setRequiredTypes(new Set(types));
      })
      .catch(() => setError("Failed to load document requirements."))
      .finally(() => setLoadingRequirements(false));
  }, [selectedCountryId]);

  const handleCreateSector = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreatingSector(true);
    setError("");
    try {
      const res = await fetch("/api/admin/sectors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newSectorName }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error?.message || "Failed to create sector.");
      setNewSectorName("");
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create sector.");
    } finally {
      setCreatingSector(false);
    }
  };

  const handleDeleteSector = async (id: string) => {
    setError("");
    try {
      const res = await fetch(`/api/admin/sectors/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error?.message || "Failed to delete sector.");
      }
      setSectors((prev) => prev.filter((s) => s.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete sector.");
    }
  };

  const handleCreateDocType = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreatingDocType(true);
    setError("");
    try {
      const res = await fetch("/api/admin/document-types", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: newDocTypeLabel }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error?.message || "Failed to create document type.");
      setNewDocTypeLabel("");
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create document type.");
    } finally {
      setCreatingDocType(false);
    }
  };

  const handleDeleteDocType = async (id: string) => {
    setError("");
    try {
      const res = await fetch(`/api/admin/document-types/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error?.message || "Failed to delete document type.");
      }
      setDocumentTypes((prev) => prev.filter((t) => t.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete document type.");
    }
  };

  const toggleDocumentType = (value: string) => {
    setRequiredTypes((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  };

  const saveRequirements = async () => {
    if (!selectedCountryId) return;
    setSavingRequirements(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/countries/${selectedCountryId}/document-requirements`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ document_types: Array.from(requiredTypes) }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error?.message || "Failed to save document requirements.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save document requirements.");
    } finally {
      setSavingRequirements(false);
    }
  };

  return (
    <PortalShell roleLabel="System Administrator" navItems={ADMIN_NAV_ITEMS}>
      <p className="eyebrow mb-3">
        <span className="eyebrow-rule" />
        Reference data
      </p>
      <h1 className="section-title text-3xl md:text-4xl mb-2">Sectors & Document Requirements</h1>
      <p className="text-midnight-900/55 font-light mb-10 max-w-2xl">
        Manage the sectors candidates choose from as their preferred type of work, the document types the
        Candidate Information Form and Agency form can ask for, and which of those extras each destination
        country requires on top of the universal passport, photo, and CV set. A document type you add here
        appears on both forms' checklists immediately — no other change needed.
      </p>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4 text-sm mb-8">{error}</div>
      )}

      {loading ? (
        <p className="text-midnight-900/50">Loading…</p>
      ) : (
        <div className="grid lg:grid-cols-2 gap-8">
          <div>
            <form onSubmit={handleCreateSector} className="card p-6 mb-6">
              <h2 className="font-semibold text-midnight-900 mb-4 flex items-center gap-2">
                <Briefcase size={18} weight="regular" className="text-gold-600" /> Sectors
              </h2>
              <div className="flex gap-3">
                <input
                  value={newSectorName}
                  onChange={(e) => setNewSectorName(e.target.value)}
                  placeholder="e.g. Warehouse & Logistics"
                  required
                  className="input-field flex-1"
                />
                <button type="submit" disabled={creatingSector} className="btn-primary px-5 disabled:opacity-60">
                  <Plus size={16} weight="bold" />
                </button>
              </div>
            </form>

            {sectors.length === 0 ? (
              <div className="card p-8 text-center text-midnight-900/50">No sectors yet — add one above.</div>
            ) : (
              <div className="card p-4 mb-8">
                <ul className="divide-y divide-midnight-900/5">
                  {paged.map((s) => (
                    <li key={s.id} className="flex items-center justify-between py-2.5 px-2">
                      <span className="text-sm text-midnight-900/80">{s.name}</span>
                      <button
                        type="button"
                        onClick={() => handleDeleteSector(s.id)}
                        className="text-midnight-900/30 hover:text-red-500"
                      >
                        <Trash size={15} weight="regular" />
                      </button>
                    </li>
                  ))}
                </ul>
                <Pagination page={page} totalPages={totalPages} onPageChange={setPage} total={total} pageSize={pageSize} />
              </div>
            )}

            <form onSubmit={handleCreateDocType} className="card p-6 mb-6">
              <h2 className="font-semibold text-midnight-900 mb-4 flex items-center gap-2">
                <Files size={18} weight="regular" className="text-gold-600" /> Document Types
              </h2>
              <div className="flex gap-3">
                <input
                  value={newDocTypeLabel}
                  onChange={(e) => setNewDocTypeLabel(e.target.value)}
                  placeholder="e.g. Yellow Fever Certificate"
                  required
                  className="input-field flex-1"
                />
                <button type="submit" disabled={creatingDocType} className="btn-primary px-5 disabled:opacity-60">
                  <Plus size={16} weight="bold" />
                </button>
              </div>
            </form>

            {documentTypes.length === 0 ? (
              <div className="card p-8 text-center text-midnight-900/50">No document types yet.</div>
            ) : (
              <div className="card p-4">
                <ul className="divide-y divide-midnight-900/5">
                  {docTypesPage.paged.map((t) => (
                    <li key={t.id} className="flex items-center justify-between py-2.5 px-2">
                      <span className="text-sm text-midnight-900/80">
                        {t.label}
                        {t.is_universal && <span className="ml-2 text-[10px] uppercase tracking-wide text-gold-600">Universal</span>}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleDeleteDocType(t.id)}
                        className="text-midnight-900/30 hover:text-red-500"
                      >
                        <Trash size={15} weight="regular" />
                      </button>
                    </li>
                  ))}
                </ul>
                <Pagination page={docTypesPage.page} totalPages={docTypesPage.totalPages} onPageChange={docTypesPage.setPage} total={docTypesPage.total} pageSize={docTypesPage.pageSize} />
              </div>
            )}
          </div>

          <div className="card p-6 h-fit">
            <h2 className="font-semibold text-midnight-900 mb-4 flex items-center gap-2">
              <FileText size={18} weight="regular" className="text-gold-600" /> Document Requirements
            </h2>
            <SearchableSelect
              value={selectedCountryId}
              onChange={setSelectedCountryId}
              placeholder="Select a country…"
              className="input-field mb-4"
              options={countries.map((c) => ({ value: c.id, label: `${c.name} (${c.region.name})` }))}
            />

            {!selectedCountryId ? (
              <p className="text-sm text-midnight-900/40">Select a country to manage its extra document requirements.</p>
            ) : loadingRequirements ? (
              <p className="text-sm text-midnight-900/40">Loading…</p>
            ) : requirementEligibleTypes.length === 0 ? (
              <p className="text-sm text-midnight-900/40">No programme-specific document types yet — add one on the left.</p>
            ) : (
              <>
                <div className="space-y-2 mb-5 max-h-80 overflow-y-auto">
                  {requirementEligibleTypes.map((opt) => (
                    <label key={opt.key} className="flex items-center gap-2 text-sm text-midnight-900/75 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={requiredTypes.has(opt.key)}
                        onChange={() => toggleDocumentType(opt.key)}
                        className="w-4 h-4"
                      />
                      {opt.label}
                    </label>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={saveRequirements}
                  disabled={savingRequirements}
                  className="btn-primary text-sm py-2.5 px-5 disabled:opacity-60"
                >
                  {savingRequirements ? "Saving…" : "Save Requirements"}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </PortalShell>
  );
}
