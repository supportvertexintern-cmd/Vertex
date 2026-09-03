"use client";

import { useEffect, useMemo, useState } from "react";
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

// Same canonical order/list ApplicationForm.tsx and PartnerCandidateForm.tsx
// use — matches the business's own Positions by Country & Sector sheet.
const SECTOR_ORDER = [
  "Agriculture",
  "Logistics & Warehousing",
  "Manufacturing & Production",
  "Construction & Trades",
  "Hospitality",
  "Healthcare",
  "Transport & Delivery",
  "General / Unskilled",
];

interface JobPositionOption {
  id: string;
  title: string;
  city: string | null;
}

interface JobSectorOption {
  id: string;
  sector: string;
  positions: JobPositionOption[];
}

interface JobOption {
  id: string;
  title: string;
  country: string;
  city: string;
  is_credit_service: boolean;
  sectors: JobSectorOption[];
}

// A position flattened out of whichever Job it belongs to (2026-09-03,
// Country -> Sector -> Position) — jobId carries which Job to derive
// form.job_id from once a position is chosen.
interface FlatPositionOption extends JobPositionOption {
  jobId: string;
}

export interface ApplicationEditableDetails {
  job_id: string | null;
  job_position_id: string | null;
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
  // Only present when the initial position is already known (2026-09-03) —
  // Country/is_credit_service are derived from job_id via the fetched
  // jobs list, but Sector isn't derivable from the job alone (a job can
  // have multiple sectors), so it rides along here. Absent for a
  // candidate with no position on file yet.
  job_sector_name?: string | null;
}

interface Props {
  candidateId: string;
  initial: ApplicationEditableDetails;
  onSaved: () => void;
}

// Staff correcting a candidate's Programme Information and travel/visa-
// readiness fields after submission (CRM Comments follow-up, 2026-08-10,
// widened 2026-08-12 to also cover Programme Information — the one
// section that had no edit path at all; widened again 2026-09-03 to the
// full Country -> Sector -> Position picker, matching the submission
// forms, and to persist job_position_id alongside job_id rather than
// leaving it silently mismatched after a programme change). Shared by
// CandidateDetail.tsx and PartnerSubmissionDetail.tsx rather than
// duplicated, since the fields and the backing route
// (PATCH /api/candidates/:id/application) are identical either way.
// audience=partner is always requested — for a partner-sourced candidate
// this surfaces the Credit Service programmes their submission may need;
// for a self-submitted one it's a no-op extra (harmless, gated server-side
// by the caller's own staff role either way).
export default function ApplicationEditDetails({ candidateId, initial, onSaved }: Props) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [jobs, setJobs] = useState<JobOption[]>([]);
  const [selectedCountry, setSelectedCountry] = useState("");
  const [sector, setSector] = useState("");
  const [form, setForm] = useState({
    job_id: initial.job_id ?? "",
    job_position_id: initial.job_position_id ?? "",
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
    fetch("/api/jobs?limit=50&audience=partner")
      .then((r) => r.json())
      .then((res) => {
        const list: JobOption[] = res.jobs ?? [];
        setJobs(list);
        const currentJob = list.find((j) => j.id === initial.job_id);
        if (currentJob) {
          setSelectedCountry(currentJob.is_credit_service ? `${currentJob.country}::credit` : currentJob.country);
        }
        if (initial.job_sector_name) setSector(initial.job_sector_name);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, jobs.length]);

  const countryOptions = useMemo(() => {
    const options: { value: string; label: string; countryName: string; isCreditService: boolean }[] = [];
    for (const countryName of [...new Set(jobs.map((j) => j.country))].sort()) {
      if (jobs.some((j) => j.country === countryName && !j.is_credit_service)) {
        options.push({ value: countryName, label: countryName, countryName, isCreditService: false });
      }
      if (jobs.some((j) => j.country === countryName && j.is_credit_service)) {
        options.push({
          value: `${countryName}::credit`,
          label: `${countryName} (Credit Service)`,
          countryName,
          isCreditService: true,
        });
      }
    }
    return options;
  }, [jobs]);
  const selectedCountryChoice = useMemo(
    () => countryOptions.find((o) => o.value === selectedCountry) ?? null,
    [countryOptions, selectedCountry]
  );
  const jobsInCountry = useMemo(
    () =>
      selectedCountryChoice
        ? jobs.filter((j) => j.country === selectedCountryChoice.countryName && j.is_credit_service === selectedCountryChoice.isCreditService)
        : [],
    [jobs, selectedCountryChoice]
  );
  const sectorOptions = useMemo(() => {
    const present = new Set(jobsInCountry.flatMap((j) => j.sectors.map((s) => s.sector)));
    return SECTOR_ORDER.filter((s) => present.has(s));
  }, [jobsInCountry]);
  const positionOptions = useMemo<FlatPositionOption[]>(() => {
    if (!selectedCountry || !sector) return [];
    return jobsInCountry.flatMap((j) =>
      j.sectors.filter((s) => s.sector === sector).flatMap((s) => s.positions.map((p) => ({ ...p, jobId: j.id })))
    );
  }, [jobsInCountry, sector, selectedCountry]);

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
          job_position_id: form.job_position_id || undefined,
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
    <form method="post" onSubmit={submit} className="bg-ivory-100 border border-midnight-900/10 rounded-lg p-4 space-y-4">
      <div>
        <div className="text-[11px] font-semibold text-midnight-900/50 uppercase tracking-wider mb-2">Programme Information</div>
        <div className="grid sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs text-midnight-900/50 mb-1">Country</label>
            <SearchableSelect
              value={selectedCountry}
              onChange={(value) => {
                setSelectedCountry(value);
                setSector("");
                setForm({ ...form, job_id: "", job_position_id: "" });
              }}
              placeholder="Select a country…"
              options={countryOptions.map((o) => ({ value: o.value, label: o.label }))}
              className="text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-midnight-900/50 mb-1">Sector</label>
            <SearchableSelect
              value={sector}
              onChange={(value) => {
                setSector(value);
                setForm({ ...form, job_id: "", job_position_id: "" });
              }}
              disabled={!selectedCountry}
              placeholder={selectedCountry ? "Select a sector…" : "Select a country first…"}
              options={sectorOptions.map((s) => ({ value: s, label: s }))}
              className="text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-midnight-900/50 mb-1">Position</label>
            <SearchableSelect
              value={form.job_position_id}
              onChange={(value) => {
                const pos = positionOptions.find((p) => p.id === value);
                setForm({ ...form, job_position_id: value, job_id: pos?.jobId ?? "" });
              }}
              disabled={!sector}
              placeholder={sector ? "Select a position…" : "Select a sector first…"}
              options={positionOptions.map((p) => ({ value: p.id, label: p.city ? `${p.title} — ${p.city}` : p.title }))}
              className="text-sm"
            />
          </div>
        </div>
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
