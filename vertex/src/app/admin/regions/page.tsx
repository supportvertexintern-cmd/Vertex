"use client";

import { useEffect, useState } from "react";
import PortalShell from "@/components/portal/PortalShell";
import { ADMIN_NAV_ITEMS } from "@/components/portal/adminNav";
import SearchableSelect from "@/components/SearchableSelect";
import Pagination from "@/components/Pagination";
import { usePagination } from "@/lib/usePagination";
import { GlobeHemisphereWest, Plus, MapPin, PencilSimple, Check, X, Trash } from "@phosphor-icons/react";

interface Country {
  id: string;
  name: string;
  region: { id: string; name: string };
}

interface Region {
  id: string;
  name: string;
  countries: { id: string; name: string }[];
}

export default function RegionsPage() {
  const [regions, setRegions] = useState<Region[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [newRegionName, setNewRegionName] = useState("");
  const [creatingRegion, setCreatingRegion] = useState(false);

  const [newCountryName, setNewCountryName] = useState("");
  const [newCountryRegionId, setNewCountryRegionId] = useState("");
  const [creatingCountry, setCreatingCountry] = useState(false);

  const [editingRegionId, setEditingRegionId] = useState<string | null>(null);
  const [editRegionName, setEditRegionName] = useState("");
  const [editingCountryId, setEditingCountryId] = useState<string | null>(null);
  const [editCountryName, setEditCountryName] = useState("");
  const [editCountryRegionId, setEditCountryRegionId] = useState("");
  const [saving, setSaving] = useState(false);

  const load = () => {
    setLoading(true);
    fetch("/api/admin/regions")
      .then((r) => r.json())
      .then((res) => setRegions(res.data ?? []))
      .catch(() => setError("Failed to load regions."))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const { page, setPage, totalPages, paged, total, pageSize } = usePagination(regions);

  const handleCreateRegion = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreatingRegion(true);
    setError("");
    try {
      const res = await fetch("/api/admin/regions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newRegionName }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error?.message || "Failed to create region.");
      setNewRegionName("");
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create region.");
    } finally {
      setCreatingRegion(false);
    }
  };

  const handleCreateCountry = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreatingCountry(true);
    setError("");
    try {
      const res = await fetch("/api/admin/countries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newCountryName, region_id: newCountryRegionId }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error?.message || "Failed to create country.");
      setNewCountryName("");
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create country.");
    } finally {
      setCreatingCountry(false);
    }
  };

  const startEditRegion = (region: Region) => {
    setEditingRegionId(region.id);
    setEditRegionName(region.name);
  };

  const saveRegion = async (id: string) => {
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/regions/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: editRegionName }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error?.message || "Failed to update region.");
      setEditingRegionId(null);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update region.");
    } finally {
      setSaving(false);
    }
  };

  const startEditCountry = (country: { id: string; name: string }, regionId: string) => {
    setEditingCountryId(country.id);
    setEditCountryName(country.name);
    setEditCountryRegionId(regionId);
  };

  const saveCountry = async (id: string) => {
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/countries/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: editCountryName, region_id: editCountryRegionId }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error?.message || "Failed to update country.");
      setEditingCountryId(null);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update country.");
    } finally {
      setSaving(false);
    }
  };

  const deleteCountry = async (country: { id: string; name: string }) => {
    if (!window.confirm(`Remove ${country.name}? This can't be undone.`)) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/countries/${country.id}`, { method: "DELETE" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error?.message || "Failed to remove country.");
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove country.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <PortalShell roleLabel="System Administrator" navItems={ADMIN_NAV_ITEMS}>
      <p className="eyebrow mb-3">
        <span className="eyebrow-rule" />
        Reference data
      </p>
      <h1 className="section-title text-3xl md:text-4xl mb-2">Regions & Countries</h1>
      <p className="text-midnight-900/55 font-light mb-10 max-w-2xl">
        The structure recruiters and candidates are attributed to (SRS FR-1.4). Add regions first, then countries within them — click the pencil next to any name to rename it or move a country to a different region.
      </p>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4 text-sm mb-8">{error}</div>
      )}

      <div className="grid lg:grid-cols-2 gap-8 mb-10">
        <form onSubmit={handleCreateRegion} className="card p-6">
          <h2 className="font-semibold text-midnight-900 mb-4">Add a region</h2>
          <div className="flex gap-3">
            <input
              value={newRegionName}
              onChange={(e) => setNewRegionName(e.target.value)}
              placeholder="e.g. East Africa"
              required
              className="input-field flex-1"
            />
            <button type="submit" disabled={creatingRegion} className="btn-primary px-5 disabled:opacity-60">
              <Plus size={16} weight="bold" />
            </button>
          </div>
        </form>

        <form onSubmit={handleCreateCountry} className="card p-6">
          <h2 className="font-semibold text-midnight-900 mb-4">Add a country</h2>
          <div className="flex gap-3">
            <SearchableSelect
              value={newCountryRegionId}
              onChange={setNewCountryRegionId}
              required
              placeholder="Region…"
              className="input-field w-40"
              options={regions.map((r) => ({ value: r.id, label: r.name }))}
            />
            <input
              value={newCountryName}
              onChange={(e) => setNewCountryName(e.target.value)}
              placeholder="e.g. Kenya"
              required
              className="input-field flex-1"
            />
            <button type="submit" disabled={creatingCountry} className="btn-primary px-5 disabled:opacity-60">
              <Plus size={16} weight="bold" />
            </button>
          </div>
        </form>
      </div>

      {loading ? (
        <p className="text-midnight-900/50">Loading…</p>
      ) : regions.length === 0 ? (
        <div className="card p-10 text-center text-midnight-900/50">No regions yet — add one above.</div>
      ) : (
        <div className="grid md:grid-cols-2 gap-5">
          {paged.map((region) => (
            <div key={region.id} className="card p-6">
              <div className="flex items-center gap-2 mb-4 group">
                <GlobeHemisphereWest size={18} weight="regular" className="text-gold-600 shrink-0" />
                {editingRegionId === region.id ? (
                  <div className="flex items-center gap-2 flex-1">
                    <input
                      value={editRegionName}
                      onChange={(e) => setEditRegionName(e.target.value)}
                      className="input-field py-1 text-sm flex-1"
                      autoFocus
                    />
                    <button onClick={() => saveRegion(region.id)} disabled={saving} className="text-emerald-600 hover:text-emerald-700 disabled:opacity-50">
                      <Check size={16} weight="bold" />
                    </button>
                    <button onClick={() => setEditingRegionId(null)} className="text-midnight-900/40 hover:text-midnight-900">
                      <X size={16} weight="bold" />
                    </button>
                  </div>
                ) : (
                  <>
                    <h3 className="font-semibold text-midnight-900 tracking-tight flex-1">{region.name}</h3>
                    <button
                      onClick={() => startEditRegion(region)}
                      className="text-midnight-900/25 hover:text-gold-600 opacity-0 group-hover:opacity-100 transition-opacity"
                      aria-label="Rename region"
                    >
                      <PencilSimple size={15} weight="regular" />
                    </button>
                  </>
                )}
              </div>
              {region.countries.length === 0 ? (
                <p className="text-sm text-midnight-900/40">No countries yet.</p>
              ) : (
                <ul className="space-y-2">
                  {region.countries.map((c) => (
                    <li key={c.id} className="flex items-center gap-2 text-sm text-midnight-900/70 group">
                      {editingCountryId === c.id ? (
                        <div className="flex items-center gap-2 flex-1">
                          <input
                            value={editCountryName}
                            onChange={(e) => setEditCountryName(e.target.value)}
                            className="input-field py-1 text-sm flex-1"
                            autoFocus
                          />
                          <SearchableSelect
                            value={editCountryRegionId}
                            onChange={setEditCountryRegionId}
                            className="input-field py-1 text-sm w-32"
                            options={regions.map((r) => ({ value: r.id, label: r.name }))}
                          />
                          <button onClick={() => saveCountry(c.id)} disabled={saving} className="text-emerald-600 hover:text-emerald-700 disabled:opacity-50 shrink-0">
                            <Check size={16} weight="bold" />
                          </button>
                          <button onClick={() => setEditingCountryId(null)} className="text-midnight-900/40 hover:text-midnight-900 shrink-0">
                            <X size={16} weight="bold" />
                          </button>
                        </div>
                      ) : (
                        <>
                          <MapPin size={14} weight="regular" className="text-midnight-900/30 shrink-0" />
                          <span className="flex-1">{c.name}</span>
                          <button
                            onClick={() => startEditCountry(c, region.id)}
                            className="text-midnight-900/25 hover:text-gold-600 opacity-0 group-hover:opacity-100 transition-opacity"
                            aria-label="Edit country"
                          >
                            <PencilSimple size={13} weight="regular" />
                          </button>
                          <button
                            onClick={() => deleteCountry(c)}
                            disabled={saving}
                            className="text-midnight-900/25 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-50"
                            aria-label="Remove country"
                          >
                            <Trash size={13} weight="regular" />
                          </button>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}
      <Pagination page={page} totalPages={totalPages} onPageChange={setPage} total={total} pageSize={pageSize} />
    </PortalShell>
  );
}
