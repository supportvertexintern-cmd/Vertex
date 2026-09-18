"use client";

import { useState, useEffect, use, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import PortalShell from "@/components/portal/PortalShell";
import { MARKETING_NAV_ITEMS } from "@/components/portal/marketingNav";
import SearchableSelect from "@/components/SearchableSelect";
import PaymentStageBuilder, { type PaymentStageDraft } from "@/components/portal/PaymentStageBuilder";
import { Plus, Trash, PencilSimple, Check, X } from "@phosphor-icons/react";

interface EmployerClient {
  id: string;
  name: string;
}

interface JobPositionData {
  id: string;
  title: string;
  city: string | null;
}

interface JobSectorData {
  id: string;
  sector: string;
  positions: JobPositionData[];
}

export default function EditJobPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const { id: jobId } = use(params);

  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(true);
  const [error, setError] = useState("");
  const [employerClients, setEmployerClients] = useState<EmployerClient[]>([]);
  const [syncingStripe, setSyncingStripe] = useState(false);
  const [stripeSyncMessage, setStripeSyncMessage] = useState("");
  const [formData, setFormData] = useState({
    title: "",
    country: "",
    city: "",
    category: "",
    salary_range: "",
    job_description: "",
    requirements: "",
    status: "active",
    employer_client_id: "",
    visa_type: "",
    duration_permit: "",
    processing_time: "",
    service_fee_gbp: "",
    visa_success_rates: "",
    is_credit_service: false,
    partner_only: false,
  });
  const [paymentStages, setPaymentStages] = useState<PaymentStageDraft[]>([]);
  const initialPaymentStages = useRef<PaymentStageDraft[]>([]);

  // Sectors & Positions (2026-09-02) — a live-saving sub-resource of this
  // Job, independent of the main "Save Changes" button above (each add/
  // edit/delete call hits its own /api/jobs/:id/sectors... route
  // immediately, same as the referral-agent commission-rules grid's
  // per-row Save pattern).
  const [sectors, setSectors] = useState<JobSectorData[]>([]);
  const [addingSector, setAddingSector] = useState("");
  const [savingSector, setSavingSector] = useState(false);
  const [positionDrafts, setPositionDrafts] = useState<Record<string, { title: string; city: string }>>({});
  const [savingPositionFor, setSavingPositionFor] = useState<string | null>(null);
  const [editingPosition, setEditingPosition] = useState<{ id: string; title: string; city: string } | null>(null);
  const [sectorsError, setSectorsError] = useState("");

  useEffect(() => {
    fetch("/api/admin/employer-clients")
      .then((r) => r.json())
      .then((res) => setEmployerClients(res.data ?? []))
      .catch(() => {});
  }, []);

  // The real work-permit programme sectors (2026-08-31), matching the
  // business's own Positions by Country & Sector reference sheet and the
  // Candidate Information Form's Section 1 sector picker exactly — was
  // previously a stale, unrelated placeholder list.
  const categories = [
    "Agriculture", "Logistics & Warehousing", "Manufacturing & Production",
    "Construction & Trades", "Hospitality", "Healthcare", "Transport & Delivery",
    "General / Unskilled",
  ];

  useEffect(() => {
    fetch(`/api/jobs/${jobId}`)
      .then(res => res.json())
      .then(data => {
        if (data.error) throw new Error(data.error);
        setFormData({
          title: data.title,
          country: data.country,
          city: data.city,
          category: data.category || "",
          salary_range: data.salary_range || "",
          job_description: data.job_description,
          requirements: data.requirements,
          status: data.status,
          employer_client_id: data.employer_client_id || "",
          visa_type: data.visa_type || "",
          duration_permit: data.duration_permit || "",
          processing_time: data.processing_time || "",
          service_fee_gbp: data.service_fee_gbp != null ? String(data.service_fee_gbp) : "",
          visa_success_rates: data.visa_success_rates || "",
          is_credit_service: data.is_credit_service ?? false,
          partner_only: data.partner_only ?? false,
        });
        const loadedPaymentStages =
          (data.payment_stages ?? [])
            .sort((a: { order: number }, b: { order: number }) => a.order - b.order)
            .map((s: { order: number; label: string; percent: number; trigger_stage: string }, index: number) => ({
              // A few older rows were saved with a zero-based order. The
              // current API correctly requires a positive order, so repair
              // that legacy shape as it is loaded rather than preventing an
              // unrelated edit (such as closing the posting).
              order: index + 1,
              label: s.label,
              percent: String(s.percent),
              trigger_stage: s.trigger_stage,
            }));
        setPaymentStages(loadedPaymentStages);
        initialPaymentStages.current = loadedPaymentStages;
        setSectors(data.sectors ?? []);
        setFetching(false);
      })
      .catch(() => {
        setError("Failed to load job details.");
        setFetching(false);
      });
  }, [jobId]);

const stagesTotal = paymentStages.reduce((sum, s) => sum + (Number(s.percent) || 0), 0);
  const stagesTotalIsValid = Math.abs(stagesTotal - 100) < 0.01;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    const paymentStagesChanged = JSON.stringify(paymentStages) !== JSON.stringify(initialPaymentStages.current);

    if (formData.service_fee_gbp && paymentStagesChanged && !stagesTotalIsValid) {
      setError("Payment stages must sum to exactly 100% when a service fee is set.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`/api/jobs/${jobId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...formData,
          // null (not undefined) for a blank field — JSON.stringify drops
          // undefined keys entirely, which meant clearing one of these
          // fields never reached the server and the old value silently
          // stuck around (2026-09-14 fix; see createJobSchema's matching
          // .nullish() change).
          employer_client_id: formData.employer_client_id || null,
          visa_type: formData.visa_type || null,
          duration_permit: formData.duration_permit || null,
          processing_time: formData.processing_time || null,
          visa_success_rates: formData.visa_success_rates || null,
          service_fee_gbp: formData.service_fee_gbp ? Number(formData.service_fee_gbp) : null,
          payment_stages: formData.service_fee_gbp
            ? (paymentStagesChanged
              ? paymentStages.map((s, index) => ({ order: index + 1, label: s.label, percent: Number(s.percent), trigger_stage: s.trigger_stage }))
              : undefined)
            // Clearing a fee must also remove its payment plan. Sending an
            // explicit empty array lets the API distinguish this from an
            // edit that simply leaves payment stages untouched.
            : [],
        }),
      });

      if (res.ok) {
        router.push("/marketing/jobs");
      } else {
        const data = await res.json();
        setError(data.error || "Failed to edit job.");
      }
    } catch {
      setError("An unexpected error occurred.");
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const availableSectorsToAdd = categories.filter((c) => !sectors.some((s) => s.sector === c));

  const addSector = async () => {
    if (!addingSector) return;
    setSavingSector(true);
    setSectorsError("");
    try {
      const res = await fetch(`/api/jobs/${jobId}/sectors`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sector: addingSector }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error?.message || "Failed to add sector.");
      setSectors((prev) => [...prev, body.data]);
      setAddingSector("");
    } catch (err) {
      setSectorsError(err instanceof Error ? err.message : "Failed to add sector.");
    } finally {
      setSavingSector(false);
    }
  };

  const deleteSector = async (sectorId: string) => {
    if (!window.confirm("Remove this sector? Its positions will be removed too.")) return;
    setSectorsError("");
    try {
      const res = await fetch(`/api/jobs/${jobId}/sectors/${sectorId}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error?.message || "Failed to remove sector.");
      }
      setSectors((prev) => prev.filter((s) => s.id !== sectorId));
    } catch (err) {
      setSectorsError(err instanceof Error ? err.message : "Failed to remove sector.");
    }
  };

  const addPosition = async (sectorId: string) => {
    const draft = positionDrafts[sectorId];
    if (!draft?.title) return;
    setSavingPositionFor(sectorId);
    setSectorsError("");
    try {
      const res = await fetch(`/api/jobs/${jobId}/sectors/${sectorId}/positions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: draft.title, city: draft.city || undefined }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error?.message || "Failed to add position.");
      setSectors((prev) => prev.map((s) => (s.id === sectorId ? { ...s, positions: [...s.positions, body.data] } : s)));
      setPositionDrafts((prev) => ({ ...prev, [sectorId]: { title: "", city: "" } }));
    } catch (err) {
      setSectorsError(err instanceof Error ? err.message : "Failed to add position.");
    } finally {
      setSavingPositionFor(null);
    }
  };

  const deletePosition = async (sectorId: string, positionId: string) => {
    setSectorsError("");
    try {
      const res = await fetch(`/api/jobs/${jobId}/sectors/${sectorId}/positions/${positionId}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error?.message || "Failed to remove position.");
      }
      setSectors((prev) => prev.map((s) => (s.id === sectorId ? { ...s, positions: s.positions.filter((p) => p.id !== positionId) } : s)));
    } catch (err) {
      setSectorsError(err instanceof Error ? err.message : "Failed to remove position.");
    }
  };

  const saveEditPosition = async (sectorId: string) => {
    if (!editingPosition) return;
    setSectorsError("");
    try {
      const res = await fetch(`/api/jobs/${jobId}/sectors/${sectorId}/positions/${editingPosition.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: editingPosition.title, city: editingPosition.city || null }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error?.message || "Failed to update position.");
      setSectors((prev) =>
        prev.map((s) => (s.id === sectorId ? { ...s, positions: s.positions.map((p) => (p.id === editingPosition.id ? body.data : p)) } : s))
      );
      setEditingPosition(null);
    } catch (err) {
      setSectorsError(err instanceof Error ? err.message : "Failed to update position.");
    }
  };

  // Job creation/edits already trigger this automatically (best-effort,
  // never blocking the save) — this is the manual fallback for when that
  // attempt failed (e.g. Stripe was unreachable) and needs re-running
  // without changing any other field.
  const retryStripeSync = async () => {
    setSyncingStripe(true);
    setStripeSyncMessage("");
    try {
      const res = await fetch(`/api/jobs/${jobId}/sync-stripe-pricing`, { method: "POST" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error?.message || "Failed to sync Stripe pricing.");
      setStripeSyncMessage(`Synced — ${body.data.length} milestone price(s) on file.`);
    } catch (err) {
      setStripeSyncMessage(err instanceof Error ? err.message : "Failed to sync Stripe pricing.");
    } finally {
      setSyncingStripe(false);
    }
  };

  return (
    <PortalShell roleLabel="Marketing" navItems={MARKETING_NAV_ITEMS}>
      <div className="flex items-center justify-between mb-8">
        <div>
          <p className="eyebrow mb-3">
            <span className="eyebrow-rule" />
            Recruitment
          </p>
          <h1 className="section-title text-3xl md:text-4xl">Edit Job Posting.</h1>
        </div>
        <Link href="/marketing/jobs" className="text-sm font-medium text-midnight-900/50 hover:text-gold-600">
          ← Back to Jobs
        </Link>
      </div>

      {fetching ? (
        <p className="text-midnight-900/50">Loading job details…</p>
      ) : (
        <div className="card p-6 md:p-8 max-w-3xl">
          {error && <div className="mb-6 bg-red-50 text-red-700 p-4 rounded-lg border border-red-200 text-sm">{error}</div>}

          <form method="post" onSubmit={handleSubmit} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="col-span-1 md:col-span-2">
                <label className="block text-sm font-medium text-midnight-900/70 mb-1.5">Job Title</label>
                <input required type="text" name="title" value={formData.title} onChange={handleChange} className="input-field w-full" />
              </div>

              <div>
                <label className="block text-sm font-medium text-midnight-900/70 mb-1.5">Country</label>
                <input required type="text" name="country" value={formData.country} onChange={handleChange} className="input-field w-full" />
              </div>

              <div>
                <label className="block text-sm font-medium text-midnight-900/70 mb-1.5">City</label>
                <input required type="text" name="city" value={formData.city} onChange={handleChange} className="input-field w-full" />
              </div>

              <div>
                <label className="block text-sm font-medium text-midnight-900/70 mb-1.5">Category</label>
                <SearchableSelect
                  value={formData.category}
                  onChange={(value) => setFormData({ ...formData, category: value })}
                  placeholder="Select a Category"
                  options={categories.map((cat) => ({ value: cat, label: cat }))}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-midnight-900/70 mb-1.5">Salary Range <span className="text-midnight-900/35 font-normal">(Optional)</span></label>
                <input type="text" name="salary_range" value={formData.salary_range} onChange={handleChange} className="input-field w-full" />
              </div>

              <div className="col-span-1 md:col-span-2">
                <label className="block text-sm font-medium text-midnight-900/70 mb-1.5">Employer / Client <span className="text-midnight-900/35 font-normal">(Optional)</span></label>
                <SearchableSelect
                  value={formData.employer_client_id}
                  onChange={(value) => setFormData({ ...formData, employer_client_id: value })}
                  placeholder="No linked client"
                  options={employerClients.map((c) => ({ value: c.id, label: c.name }))}
                />
              </div>

              <div className="col-span-1 md:col-span-2 border-t border-midnight-900/10 pt-6 mt-2">
                <p className="text-xs font-semibold uppercase tracking-[0.1em] text-midnight-900/40 mb-4">
                  Work-Permit Programme Details <span className="font-normal normal-case">(Optional — shown on the public Opportunities page when filled in)</span>
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-midnight-900/70 mb-1.5">Visa Type</label>
                <input type="text" name="visa_type" value={formData.visa_type} onChange={handleChange} className="input-field w-full" placeholder="e.g. Visa D" />
              </div>

              <div>
                <label className="block text-sm font-medium text-midnight-900/70 mb-1.5">Duration / Permit</label>
                <input type="text" name="duration_permit" value={formData.duration_permit} onChange={handleChange} className="input-field w-full" placeholder="e.g. 2-year resident card" />
              </div>

              <div>
                <label className="block text-sm font-medium text-midnight-900/70 mb-1.5">Processing Time</label>
                <input type="text" name="processing_time" value={formData.processing_time} onChange={handleChange} className="input-field w-full" placeholder="e.g. 3 months" />
              </div>

              <div>
                <label className="block text-sm font-medium text-midnight-900/70 mb-1.5">Service Fee (GBP)</label>
                <input type="number" min="0" step="1" name="service_fee_gbp" value={formData.service_fee_gbp} onChange={handleChange} className="input-field w-full" placeholder="e.g. 1400" />
                <button
                  type="button"
                  onClick={retryStripeSync}
                  disabled={syncingStripe}
                  className="text-xs text-gold-600 hover:underline mt-1.5 disabled:opacity-50"
                >
                  {syncingStripe ? "Syncing…" : "Retry Stripe Pricing"}
                </button>
                {stripeSyncMessage && <p className="text-xs text-midnight-900/50 mt-1">{stripeSyncMessage}</p>}
              </div>

              <div className="col-span-1 md:col-span-2">
                <label className="block text-sm font-medium text-midnight-900/70 mb-1.5">Visa Success Rates</label>
                <input type="text" name="visa_success_rates" value={formData.visa_success_rates} onChange={handleChange} className="input-field w-full" placeholder="e.g. Asia: 70–80% · Africa: 85–95% · South America: above 95%" />
              </div>

              <div className="col-span-1 md:col-span-2 border-t border-midnight-900/10 pt-6 mt-2">
                <p className="text-xs font-semibold uppercase tracking-[0.1em] text-midnight-900/40 mb-4">
                  Payment Stages <span className="font-normal normal-case">(Required when a Service Fee is set — must sum to 100%)</span>
                </p>
              </div>

              <div className="col-span-1 md:col-span-2 flex items-center gap-2">
                <input
                  type="checkbox"
                  id="is_credit_service"
                  checked={formData.is_credit_service}
                  onChange={(e) => setFormData({ ...formData, is_credit_service: e.target.checked })}
                  className="w-4 h-4"
                />
                <label htmlFor="is_credit_service" className="text-sm font-medium text-midnight-900/70">
                  Display as a Credit Service Programme (grouping/badge only — doesn&apos;t affect the payment math below)
                </label>
              </div>

              <div className="col-span-1 md:col-span-2">
                <PaymentStageBuilder stages={paymentStages} onChange={setPaymentStages} />
              </div>

              <div className="col-span-1 md:col-span-2 flex items-center gap-2">
                <input
                  type="checkbox"
                  id="partner_only"
                  checked={formData.partner_only}
                  onChange={(e) => setFormData({ ...formData, partner_only: e.target.checked })}
                  className="w-4 h-4"
                />
                <label htmlFor="partner_only" className="text-sm font-medium text-midnight-900/70">
                  Partner-only — hide from the public /jobs site and self-service Candidate Information Form
                </label>
              </div>

              <div className="col-span-1 md:col-span-2">
                <label className="block text-sm font-medium text-midnight-900/70 mb-1.5">Status</label>
                <SearchableSelect
                  value={formData.status}
                  onChange={(value) => setFormData({ ...formData, status: value })}
                  className="input-field w-full max-w-xs"
                  options={[
                    { value: "active", label: "Active (Open)" },
                    { value: "closed", label: "Closed" },
                  ]}
                />
              </div>

              <div className="col-span-1 md:col-span-2">
                <label className="block text-sm font-medium text-midnight-900/70 mb-1.5">Job Description</label>
                <textarea required name="job_description" value={formData.job_description} onChange={handleChange} rows={5} className="input-field w-full resize-y" />
              </div>

              <div className="col-span-1 md:col-span-2">
                <label className="block text-sm font-medium text-midnight-900/70 mb-1.5">Requirements</label>
                <textarea required name="requirements" value={formData.requirements} onChange={handleChange} rows={5} className="input-field w-full resize-y" />
              </div>

              <div className="col-span-1 md:col-span-2 border-t border-midnight-900/10 pt-6 mt-2 flex justify-end gap-4">
                <Link href="/marketing/jobs" className="btn-secondary py-2.5 px-6">Cancel</Link>
                <button type="submit" disabled={loading} className="btn-primary py-2.5 px-8 disabled:opacity-70">
                  {loading ? "Saving..." : "Save Changes"}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      {!fetching && (
        <div className="card p-6 md:p-8 max-w-3xl mt-8">
          <h2 className="text-sm font-semibold text-midnight-900 mb-1">Sectors & Positions</h2>
          <p className="text-xs text-midnight-900/50 mb-5">
            Which sectors this programme falls under, and the specific positions available in each — this drives the
            Sector → Opportunity → Position picker on both the Candidate Information Form and the Partner Agency
            Application Form.
          </p>

          {sectorsError && <div className="mb-5 bg-red-50 text-red-700 p-3 rounded-lg border border-red-200 text-sm">{sectorsError}</div>}

          <div className="flex items-end gap-3 mb-6">
            <div className="flex-1">
              <label className="block text-xs font-medium text-midnight-900/60 mb-1.5">Add a Sector</label>
              <SearchableSelect
                value={addingSector}
                onChange={setAddingSector}
                placeholder={availableSectorsToAdd.length === 0 ? "All sectors attached" : "Select a sector…"}
                options={availableSectorsToAdd.map((s) => ({ value: s, label: s }))}
              />
            </div>
            <button
              type="button"
              onClick={addSector}
              disabled={!addingSector || savingSector}
              className="btn-primary px-4 py-2.5 disabled:opacity-60"
            >
              <Plus size={16} weight="bold" />
            </button>
          </div>

          {sectors.length === 0 ? (
            <p className="text-sm text-midnight-900/50">No sectors attached yet — add one above.</p>
          ) : (
            <div className="space-y-5">
              {sectors.map((sector) => (
                <div key={sector.id} className="border border-midnight-900/10 rounded-xl p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="font-semibold text-midnight-900 text-sm">{sector.sector}</h3>
                    <button
                      type="button"
                      onClick={() => deleteSector(sector.id)}
                      className="text-midnight-900/30 hover:text-red-500"
                      title="Remove sector"
                    >
                      <Trash size={15} weight="regular" />
                    </button>
                  </div>

                  {sector.positions.length === 0 ? (
                    <p className="text-xs text-midnight-900/40 mb-3">No positions yet.</p>
                  ) : (
                    <ul className="divide-y divide-midnight-900/5 mb-3">
                      {sector.positions.map((position) => (
                        <li key={position.id} className="flex items-center justify-between py-2">
                          {editingPosition?.id === position.id ? (
                            <div className="flex items-center gap-2 flex-1">
                              <input
                                value={editingPosition.title}
                                onChange={(e) => setEditingPosition({ ...editingPosition, title: e.target.value })}
                                className="input-field text-sm flex-1"
                                placeholder="Position title"
                              />
                              <input
                                value={editingPosition.city}
                                onChange={(e) => setEditingPosition({ ...editingPosition, city: e.target.value })}
                                className="input-field text-sm w-32"
                                placeholder="City (optional)"
                              />
                              <button type="button" onClick={() => saveEditPosition(sector.id)} className="text-emerald-600 hover:text-emerald-700">
                                <Check size={16} weight="bold" />
                              </button>
                              <button type="button" onClick={() => setEditingPosition(null)} className="text-midnight-900/40 hover:text-midnight-900/70">
                                <X size={16} weight="bold" />
                              </button>
                            </div>
                          ) : (
                            <>
                              <span className="text-sm text-midnight-900">
                                {position.title}
                                {position.city && <span className="text-midnight-900/45"> — {position.city}</span>}
                              </span>
                              <div className="flex items-center gap-3">
                                <button
                                  type="button"
                                  onClick={() => setEditingPosition({ id: position.id, title: position.title, city: position.city ?? "" })}
                                  className="text-midnight-900/30 hover:text-gold-600"
                                  title="Edit position"
                                >
                                  <PencilSimple size={14} weight="regular" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => deletePosition(sector.id, position.id)}
                                  className="text-midnight-900/30 hover:text-red-500"
                                  title="Remove position"
                                >
                                  <Trash size={14} weight="regular" />
                                </button>
                              </div>
                            </>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}

                  <div className="flex items-center gap-2">
                    <input
                      value={positionDrafts[sector.id]?.title ?? ""}
                      onChange={(e) => setPositionDrafts((prev) => ({ ...prev, [sector.id]: { title: e.target.value, city: prev[sector.id]?.city ?? "" } }))}
                      className="input-field text-sm flex-1"
                      placeholder="e.g. Grape Picker"
                    />
                    <input
                      value={positionDrafts[sector.id]?.city ?? ""}
                      onChange={(e) => setPositionDrafts((prev) => ({ ...prev, [sector.id]: { title: prev[sector.id]?.title ?? "", city: e.target.value } }))}
                      className="input-field text-sm w-32"
                      placeholder="City (optional)"
                    />
                    <button
                      type="button"
                      onClick={() => addPosition(sector.id)}
                      disabled={!positionDrafts[sector.id]?.title || savingPositionFor === sector.id}
                      className="btn-secondary px-3 py-2 disabled:opacity-60"
                    >
                      <Plus size={14} weight="bold" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </PortalShell>
  );
}
