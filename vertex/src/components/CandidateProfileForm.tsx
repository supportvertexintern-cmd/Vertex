"use client";

import { useState } from "react";
import SearchableSelect from "@/components/SearchableSelect";
import { WORLD_COUNTRIES } from "@/lib/worldCountries";
import { MARITAL_STATUS_OPTIONS } from "@/lib/maritalStatus";
import { GENDER_OPTIONS } from "@/lib/gender";

const WORLD_COUNTRY_OPTIONS = WORLD_COUNTRIES.map((name) => ({ value: name, label: name }));

interface ProfileFields {
  nationality?: string | null;
  second_nationality?: string | null;
  gender?: string | null;
  date_of_birth?: string | null;
  passport_number?: string | null;
  passport_expiry?: string | null;
  current_occupation?: string | null;
  highest_education?: string | null;
  home_address?: string | null;
  whatsapp_number?: string | null;
  marital_status?: string | null;
}

interface Props {
  initial: ProfileFields;
  onSaved: () => void;
}

const toDateInput = (v?: string | null) => (v ? v.slice(0, 10) : "");

/**
 * Standalone profile editor for a signed-in candidate's dashboard —
 * update-anytime account maintenance, independent of any CIF submission.
 * (The Candidate Information Form itself collects these same fields
 * inline as its own Section 2 — see ApplicationForm's initialProfile —
 * rather than embedding this component, since Section 2 is meant to be
 * fresh submitted data on every application, not a prerequisite edit
 * against an existing row.)
 */
export default function CandidateProfileForm({ initial, onSaved }: Props) {
  const [form, setForm] = useState({
    nationality: initial.nationality ?? "",
    second_nationality: initial.second_nationality ?? "",
    gender: initial.gender ?? "",
    date_of_birth: toDateInput(initial.date_of_birth),
    passport_number: initial.passport_number ?? "",
    passport_expiry: toDateInput(initial.passport_expiry),
    current_occupation: initial.current_occupation ?? "",
    highest_education: initial.highest_education ?? "",
    home_address: initial.home_address ?? "",
    whatsapp_number: initial.whatsapp_number ?? "",
    marital_status: initial.marital_status ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  const set = (key: keyof typeof form, value: string) => setForm((f) => ({ ...f, [key]: value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    setSaved(false);
    try {
      const res = await fetch("/api/candidates/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? "Failed to save profile.");
        return;
      }
      setSaved(true);
      onSaved();
    } catch {
      setError("Failed to save profile.");
    } finally {
      setSaving(false);
    }
  };

  const labelCls = "block text-xs font-medium text-midnight-900/60 mb-1";
  const inputCls = "input-field text-sm";

  return (
    <form method="post" onSubmit={submit} className="grid sm:grid-cols-2 gap-4">
      <div>
        <label className={labelCls}>Nationality</label>
        <SearchableSelect
          value={form.nationality}
          onChange={(value) => set("nationality", value)}
          placeholder="Select a country…"
          options={WORLD_COUNTRY_OPTIONS}
        />
      </div>
      <div>
        <label className={labelCls}>Second Nationality (if any)</label>
        <SearchableSelect
          value={form.second_nationality}
          onChange={(value) => set("second_nationality", value)}
          placeholder="None"
          options={WORLD_COUNTRY_OPTIONS}
        />
      </div>
      <div>
        <label className={labelCls}>Date of Birth</label>
        <input type="date" value={form.date_of_birth} onChange={(e) => set("date_of_birth", e.target.value)} className={inputCls} />
      </div>
      <div>
        <label className={labelCls}>Gender</label>
        <SearchableSelect
          value={form.gender}
          onChange={(value) => set("gender", value)}
          placeholder="Select…"
          options={GENDER_OPTIONS}
          className={inputCls}
        />
      </div>
      <div>
        <label className={labelCls}>Marital Status</label>
        <SearchableSelect
          value={form.marital_status}
          onChange={(value) => set("marital_status", value)}
          placeholder="Select…"
          options={MARITAL_STATUS_OPTIONS}
          className={inputCls}
        />
      </div>
      <div>
        <label className={labelCls}>Passport Number</label>
        <input value={form.passport_number} onChange={(e) => set("passport_number", e.target.value)} className={inputCls} />
      </div>
      <div>
        <label className={labelCls}>Passport Expiry Date <span className="text-midnight-900/35">(min. 6 months validity)</span></label>
        <input type="date" value={form.passport_expiry} onChange={(e) => set("passport_expiry", e.target.value)} className={inputCls} />
      </div>
      <div>
        <label className={labelCls}>Current Occupation</label>
        <input value={form.current_occupation} onChange={(e) => set("current_occupation", e.target.value)} className={inputCls} />
      </div>
      <div>
        <label className={labelCls}>Highest Education / Qualification</label>
        <input value={form.highest_education} onChange={(e) => set("highest_education", e.target.value)} className={inputCls} />
      </div>
      <div>
        <label className={labelCls}>WhatsApp Number</label>
        <input value={form.whatsapp_number} onChange={(e) => set("whatsapp_number", e.target.value)} className={inputCls} />
      </div>
      <div className="sm:col-span-2">
        <label className={labelCls}>Complete Home Address</label>
        <input value={form.home_address} onChange={(e) => set("home_address", e.target.value)} className={inputCls} />
      </div>

      {error && <div className="sm:col-span-2 text-xs text-red-600">{error}</div>}
      {saved && !error && <div className="sm:col-span-2 text-xs text-emerald-700">Saved.</div>}

      <div className="sm:col-span-2">
        <button type="submit" disabled={saving} className="btn-primary text-xs py-2.5 px-5 disabled:opacity-60">
          {saving ? "Saving…" : "Save Personal Information"}
        </button>
      </div>
    </form>
  );
}
