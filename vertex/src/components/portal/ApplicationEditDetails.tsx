"use client";

import { useEffect, useState } from "react";
import { PencilSimple } from "@phosphor-icons/react";
import SearchableSelect from "@/components/SearchableSelect";
import YesNoDetailField from "@/components/YesNoDetailField";
import { WORLD_COUNTRIES } from "@/lib/worldCountries";

const WORLD_COUNTRY_OPTIONS = WORLD_COUNTRIES.map((name) => ({ value: name, label: name }));

const CONTACT_CHANNEL_OPTIONS = [
  { value: "email", label: "Email" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "phone", label: "Phone" },
];

interface JobOption {
  id: string;
  title: string;
  country: string;
  city: string;
}

export interface ApplicationEditableDetails {
  job_id: string | null;
  earliest_travel_date: string | null;
  current_location_country_name: string | null;
  prior_eu_visa_applied: boolean | null;
  prior_eu_visa_applied_details: string | null;
  holds_schengen_visa: boolean | null;
  holds_schengen_visa_details: string | null;
  prior_visa_refusals: boolean | null;
  prior_visa_refusals_details: string | null;
  available_for_embassy_appointment: boolean;
  willing_to_start_within_30_days: boolean;
  preferred_contact_channel: string | null;
}

interface Props {
  candidateId: string;
  initial: ApplicationEditableDetails;
  onSaved: () => void;
}

// Staff correcting a candidate's Programme Information and travel/visa-
// readiness fields after submission (CRM Comments follow-up, 2026-08-10,
// widened 2026-08-12 to also cover Programme Information — the one
// section that had no edit path at all) — previously frozen forever
// regardless of pipeline (self-submitted, recruiter-sourced, partner-
// sourced). Shared by CandidateDetail.tsx and PartnerSubmissionDetail.tsx
// rather than duplicated, since the fields and the backing route
// (PATCH /api/candidates/:id/application) are identical either way.
export default function ApplicationEditDetails({ candidateId, initial, onSaved }: Props) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [jobs, setJobs] = useState<JobOption[]>([]);
  const [form, setForm] = useState({
    job_id: initial.job_id ?? "",
    earliest_travel_date: initial.earliest_travel_date ? initial.earliest_travel_date.slice(0, 10) : "",
    current_location_country_name: initial.current_location_country_name ?? "",
    prior_eu_visa_applied: initial.prior_eu_visa_applied,
    prior_eu_visa_applied_details: initial.prior_eu_visa_applied_details ?? "",
    holds_schengen_visa: initial.holds_schengen_visa,
    holds_schengen_visa_details: initial.holds_schengen_visa_details ?? "",
    prior_visa_refusals: initial.prior_visa_refusals,
    prior_visa_refusals_details: initial.prior_visa_refusals_details ?? "",
    available_for_embassy_appointment: initial.available_for_embassy_appointment,
    willing_to_start_within_30_days: initial.willing_to_start_within_30_days,
    preferred_contact_channel: initial.preferred_contact_channel ?? "",
  });

  useEffect(() => {
    if (!open || jobs.length > 0) return;
    fetch("/api/jobs?limit=50")
      .then((r) => r.json())
      .then((res) => setJobs(res.jobs ?? []))
      .catch(() => {});
  }, [open, jobs.length]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/candidates/${candidateId}/application`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          job_id: form.job_id || undefined,
          prior_eu_visa_applied: form.prior_eu_visa_applied ?? undefined,
          holds_schengen_visa: form.holds_schengen_visa ?? undefined,
          prior_visa_refusals: form.prior_visa_refusals ?? undefined,
          preferred_contact_channel: form.preferred_contact_channel || undefined,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error?.message ?? "Update failed.");
        return;
      }
      setOpen(false);
      onSaved();
    } catch {
      setError("Update failed.");
    } finally {
      setSaving(false);
    }
  };

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-1 text-xs text-gold-600 hover:underline">
        <PencilSimple size={12} weight="bold" /> Edit Application Details
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="bg-ivory-100 border border-midnight-900/10 rounded-lg p-4 space-y-4">
      <div>
        <div className="text-[11px] font-semibold text-midnight-900/50 uppercase tracking-wider mb-2">Programme Information</div>
        <label className="block text-xs text-midnight-900/50 mb-1">Opportunity</label>
        <SearchableSelect
          value={form.job_id}
          onChange={(value) => setForm({ ...form, job_id: value })}
          placeholder="Select an opportunity…"
          options={jobs.map((j) => ({ value: j.id, label: `${j.title} — ${j.city}, ${j.country}` }))}
          className="text-sm"
        />
      </div>

      <div className="text-[11px] font-semibold text-midnight-900/50 uppercase tracking-wider">Visa &amp; Travel Readiness</div>
      <div className="grid sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-xs text-midnight-900/50 mb-1">Earliest travel date</label>
          <input
            type="date"
            value={form.earliest_travel_date}
            onChange={(e) => setForm({ ...form, earliest_travel_date: e.target.value })}
            className="input-field text-sm w-full"
          />
        </div>
        <div>
          <label className="block text-xs text-midnight-900/50 mb-1">Current location</label>
          <SearchableSelect
            value={form.current_location_country_name}
            onChange={(value) => setForm({ ...form, current_location_country_name: value })}
            options={WORLD_COUNTRY_OPTIONS}
            className="text-sm"
          />
        </div>
        <div>
          <label className="block text-xs text-midnight-900/50 mb-1">Preferred contact channel</label>
          <SearchableSelect
            value={form.preferred_contact_channel}
            onChange={(value) => setForm({ ...form, preferred_contact_channel: value })}
            options={CONTACT_CHANNEL_OPTIONS}
            className="text-sm"
          />
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <YesNoDetailField
          label="Prior EU visa applied"
          value={form.prior_eu_visa_applied}
          detail={form.prior_eu_visa_applied_details}
          onChange={(v) => setForm({ ...form, prior_eu_visa_applied: v })}
          onDetailChange={(v) => setForm({ ...form, prior_eu_visa_applied_details: v })}
        />
        <YesNoDetailField
          label="Holds Schengen/EU visa"
          value={form.holds_schengen_visa}
          detail={form.holds_schengen_visa_details}
          onChange={(v) => setForm({ ...form, holds_schengen_visa: v })}
          onDetailChange={(v) => setForm({ ...form, holds_schengen_visa_details: v })}
        />
        <YesNoDetailField
          label="Prior visa refusals"
          value={form.prior_visa_refusals}
          detail={form.prior_visa_refusals_details}
          onChange={(v) => setForm({ ...form, prior_visa_refusals: v })}
          onDetailChange={(v) => setForm({ ...form, prior_visa_refusals_details: v })}
        />
      </div>

      <div className="flex items-center gap-4">
        <label className="flex items-center gap-1.5 text-xs text-midnight-900/70">
          <input
            type="checkbox"
            checked={form.available_for_embassy_appointment}
            onChange={(e) => setForm({ ...form, available_for_embassy_appointment: e.target.checked })}
            className="w-3.5 h-3.5"
          />
          Available for embassy appointment
        </label>
        <label className="flex items-center gap-1.5 text-xs text-midnight-900/70">
          <input
            type="checkbox"
            checked={form.willing_to_start_within_30_days}
            onChange={(e) => setForm({ ...form, willing_to_start_within_30_days: e.target.checked })}
            className="w-3.5 h-3.5"
          />
          Willing to start within 30 days
        </label>
      </div>

      <div className="flex items-center gap-2">
        <button type="submit" disabled={saving} className="btn-primary py-1.5 px-3 text-xs disabled:opacity-50">
          {saving ? "Saving…" : "Save"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="btn-secondary py-1.5 px-3 text-xs">
          Cancel
        </button>
      </div>
      {error && <div className="text-xs text-red-500">{error}</div>}
    </form>
  );
}
