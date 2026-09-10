"use client";

import { useEffect, useMemo, useState } from "react";
import PortalShell from "@/components/portal/PortalShell";
import { MANAGEMENT_NAV_ITEMS } from "@/components/portal/managementNav";
import SearchableSelect from "@/components/SearchableSelect";
import Pagination from "@/components/Pagination";
import { usePagination } from "@/lib/usePagination";
import { Plus, Target, Trash, X } from "@phosphor-icons/react";
import FilterBar from "@/components/portal/FilterBar";

const METRICS = [
  { value: "verified_candidates", label: "Verified Candidates" },
  { value: "conversion_rate", label: "Conversion Rate (%)" },
];

interface Target {
  id: string;
  metric: string;
  target_value: number;
  country: { id: string; name: string } | null;
  region: { id: string; name: string } | null;
}

interface Campaign {
  id: string;
  name: string;
  status: string;
  start_date: string;
  end_date: string;
  creator: { id: string; full_name: string };
  targets: Target[];
}

interface Country { id: string; name: string; }
interface Region { id: string; name: string; }

const STATUS_STYLES: Record<string, string> = {
  draft: "bg-slate-100 text-slate-700",
  active: "bg-emerald-100 text-emerald-800",
  closed: "bg-midnight-900/10 text-midnight-900/50",
};

export default function CampaignsPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [countries, setCountries] = useState<Country[]>([]);
  const [regions, setRegions] = useState<Region[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: "", start_date: "", end_date: "", notes: "" });
  const [targetForms, setTargetForms] = useState<Record<string, { metric: string; scope: string; target_value: string }>>({});

  const load = () => {
    setLoading(true);
    fetch("/api/campaigns")
      .then((r) => r.json())
      .then((res) => setCampaigns(res.data ?? []))
      .catch(() => setError("Failed to load campaigns."))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    fetch("/api/admin/countries").then((r) => r.json()).then((res) => setCountries(res.data ?? []));
    fetch("/api/admin/regions").then((r) => r.json()).then((res) => setRegions(res.data ?? []));
  }, []);

  const createCampaign = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          start_date: form.start_date,
          end_date: form.end_date,
          criteria: form.notes ? { notes: form.notes } : {},
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error?.message ?? "Failed to create campaign.");
      setForm({ name: "", start_date: "", end_date: "", notes: "" });
      setShowCreate(false);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create campaign.");
    } finally {
      setSaving(false);
    }
  };

  const updateStatus = async (id: string, status: string) => {
    await fetch(`/api/campaigns/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    load();
  };

  const deleteCampaign = async (id: string) => {
    if (!confirm("Delete this campaign and all its targets?")) return;
    await fetch(`/api/campaigns/${id}`, { method: "DELETE" });
    load();
  };

  const addTarget = async (campaignId: string) => {
    const draft = targetForms[campaignId];
    if (!draft?.metric || !draft?.target_value) return;
    const [scopeType, scopeId] = draft.scope.split(":");
    await fetch(`/api/campaigns/${campaignId}/targets`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        metric: draft.metric,
        target_value: Number(draft.target_value),
        ...(scopeType === "country" ? { country_id: scopeId } : {}),
        ...(scopeType === "region" ? { region_id: scopeId } : {}),
      }),
    });
    setTargetForms((prev) => ({ ...prev, [campaignId]: { metric: "verified_candidates", scope: "", target_value: "" } }));
    load();
  };

  const removeTarget = async (campaignId: string, targetId: string) => {
    await fetch(`/api/campaigns/${campaignId}/targets/${targetId}`, { method: "DELETE" });
    load();
  };

  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const visibleCampaigns = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return campaigns.filter((c) => {
      if (statusFilter && c.status !== statusFilter) return false;
      if (needle && !c.name.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [campaigns, q, statusFilter]);
  const { page, setPage, totalPages, paged, total, pageSize } = usePagination(visibleCampaigns);

  return (
    <PortalShell roleLabel="Management" navItems={MANAGEMENT_NAV_ITEMS}>
      <div className="flex items-start justify-between gap-6 mb-2">
        <div>
          <p className="eyebrow mb-3">
            <span className="eyebrow-rule" />
            Control
          </p>
          <h1 className="section-title text-3xl md:text-4xl">Campaigns</h1>
        </div>
        <button onClick={() => setShowCreate((v) => !v)} className="btn-primary text-xs shrink-0">
          <Plus size={16} weight="bold" /> New Campaign
        </button>
      </div>
      <p className="text-midnight-900/55 font-light mb-8 max-w-2xl">
        Define recruitment criteria, requirements, targets and timelines, and cascade them to countries or regions.
      </p>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4 text-sm mb-6">{error}</div>}

      {showCreate && (
        <form onSubmit={createCampaign} className="card p-6 mb-6 space-y-4">
          <h3 className="font-semibold text-midnight-900">New campaign</h3>
          <div className="grid sm:grid-cols-3 gap-4">
            <input required placeholder="Campaign name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="input-field sm:col-span-3" />
            <div>
              <label className="text-xs text-midnight-900/45 uppercase tracking-wider">Start date</label>
              <input required type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} className="input-field" />
            </div>
            <div>
              <label className="text-xs text-midnight-900/45 uppercase tracking-wider">End date</label>
              <input required type="date" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} className="input-field" />
            </div>
          </div>
          <textarea placeholder="Criteria / requirements notes (optional)" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={3} className="input-field w-full resize-none" />
          <button type="submit" disabled={saving} className="btn-primary text-xs disabled:opacity-60">
            {saving ? "Creating…" : "Create Campaign"}
          </button>
        </form>
      )}

      {!loading && campaigns.length > 0 && (
        <FilterBar searchValue={q} onSearchChange={setQ} searchPlaceholder="Search by campaign name…">
          <SearchableSelect
            value={statusFilter}
            onChange={setStatusFilter}
            placeholder="All statuses"
            className="input-field w-48"
            options={[
              { value: "", label: "All statuses" },
              { value: "draft", label: "Draft" },
              { value: "active", label: "Active" },
              { value: "closed", label: "Closed" },
            ]}
          />
        </FilterBar>
      )}

      {loading ? (
        <p className="text-midnight-900/50">Loading…</p>
      ) : campaigns.length === 0 ? (
        <div className="card p-10 text-center text-midnight-900/50">No campaigns yet.</div>
      ) : visibleCampaigns.length === 0 ? (
        <div className="card p-10 text-center text-midnight-900/50">No campaigns match your filters.</div>
      ) : (
        <div className="space-y-5">
          {paged.map((c) => (
            <div key={c.id} className="card p-6">
              <div className="flex items-start justify-between gap-4 mb-4">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-semibold text-midnight-900">{c.name}</h3>
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider ${STATUS_STYLES[c.status]}`}>
                      {c.status}
                    </span>
                  </div>
                  <div className="text-xs text-midnight-900/45">
                    {new Date(c.start_date).toLocaleDateString()} – {new Date(c.end_date).toLocaleDateString()} · by {c.creator.full_name}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <SearchableSelect
                    value={c.status}
                    onChange={(value) => updateStatus(c.id, value)}
                    className="input-field py-1.5 text-xs"
                    options={[
                      { value: "draft", label: "Draft" },
                      { value: "active", label: "Active" },
                      { value: "closed", label: "Closed" },
                    ]}
                  />
                  <button onClick={() => deleteCampaign(c.id)} className="text-red-400 hover:text-red-600 p-1.5" aria-label="Delete campaign">
                    <Trash size={16} weight="regular" />
                  </button>
                </div>
              </div>

              <div className="border-t border-midnight-900/10 pt-4">
                <div className="text-xs font-semibold text-midnight-900/50 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                  <Target size={13} weight="bold" /> Targets
                </div>
                {c.targets.length === 0 ? (
                  <p className="text-xs text-midnight-900/40 mb-3">No targets set.</p>
                ) : (
                  <div className="flex flex-wrap gap-2 mb-3">
                    {c.targets.map((t) => (
                      <span key={t.id} className="inline-flex items-center gap-2 bg-ivory-100 border border-midnight-900/10 rounded-full px-3 py-1.5 text-xs">
                        <span className="font-medium">{METRICS.find((m) => m.value === t.metric)?.label ?? t.metric}</span>
                        <span className="text-midnight-900/50">{t.target_value}{t.metric === "conversion_rate" ? "%" : ""}</span>
                        <span className="text-midnight-900/40">{t.country?.name ?? t.region?.name ?? "Campaign-wide"}</span>
                        <button onClick={() => removeTarget(c.id, t.id)} aria-label="Remove target">
                          <X size={12} weight="bold" className="text-midnight-900/30 hover:text-red-500" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-2">
                  <SearchableSelect
                    value={targetForms[c.id]?.metric ?? "verified_candidates"}
                    onChange={(value) => setTargetForms((prev) => ({ ...prev, [c.id]: { ...prev[c.id], metric: value, scope: prev[c.id]?.scope ?? "", target_value: prev[c.id]?.target_value ?? "" } }))}
                    className="input-field py-1.5 text-xs w-auto"
                    options={METRICS.map((m) => ({ value: m.value, label: m.label }))}
                  />
                  <SearchableSelect
                    value={targetForms[c.id]?.scope ?? ""}
                    onChange={(value) => setTargetForms((prev) => ({ ...prev, [c.id]: { metric: prev[c.id]?.metric ?? "verified_candidates", scope: value, target_value: prev[c.id]?.target_value ?? "" } }))}
                    className="input-field py-1.5 text-xs w-auto"
                    placeholder="Campaign-wide"
                    options={[
                      { value: "", label: "Campaign-wide" },
                      ...regions.map((r) => ({ value: `region:${r.id}`, label: `Region — ${r.name}` })),
                      ...countries.map((co) => ({ value: `country:${co.id}`, label: `Country — ${co.name}` })),
                    ]}
                  />
                  <input
                    type="number"
                    placeholder="Target value"
                    value={targetForms[c.id]?.target_value ?? ""}
                    onChange={(e) => setTargetForms((prev) => ({ ...prev, [c.id]: { metric: prev[c.id]?.metric ?? "verified_candidates", scope: prev[c.id]?.scope ?? "", target_value: e.target.value } }))}
                    className="input-field py-1.5 text-xs w-28"
                  />
                  <button onClick={() => addTarget(c.id)} className="btn-secondary py-1.5 px-3 text-xs">
                    <Plus size={12} weight="bold" /> Add Target
                  </button>
                </div>
              </div>
            </div>
          ))}
          <Pagination page={page} totalPages={totalPages} onPageChange={setPage} total={total} pageSize={pageSize} />
        </div>
      )}
    </PortalShell>
  );
}
