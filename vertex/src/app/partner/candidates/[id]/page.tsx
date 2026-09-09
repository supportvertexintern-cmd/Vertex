"use client";

import { use, useEffect, useMemo, useState } from "react";
import PortalShell from "@/components/portal/PortalShell";
import { PARTNER_NAV_ITEMS } from "@/components/portal/partnerNav";
import DocumentLink from "@/components/DocumentLink";
import CandidateMessages from "@/components/CandidateMessages";
import SearchableSelect from "@/components/SearchableSelect";
import YesNoDetailField from "@/components/YesNoDetailField";
import SupportingDocumentUpload from "@/components/portal/SupportingDocumentUpload";
import { NON_PROGRAMME_TYPE_KEYS } from "@/lib/documentTypes";
import { formatPartnerCandidateStatus } from "@/lib/partnerCandidateStatus";
import { computeCreditServiceSchedule } from "@/lib/fees";
import { WORLD_COUNTRIES } from "@/lib/worldCountries";
import { MARITAL_STATUS_OPTIONS } from "@/lib/maritalStatus";
import { GENDER_OPTIONS } from "@/lib/gender";
import { CheckCircle, WarningCircle, CircleNotch, PencilSimple } from "@phosphor-icons/react";

const WORLD_COUNTRY_OPTIONS = WORLD_COUNTRIES.map((name) => ({ value: name, label: name }));

const CONTACT_CHANNEL_OPTIONS = [
  { value: "email", label: "Email" },
  { value: "whatsapp", label: "WhatsApp" },
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
// Country -> Sector -> Position, same pattern PartnerCandidateForm.tsx
// uses at submission time) — jobId carries which Job to derive
// editForm.job_id from once a position is chosen.
interface FlatPositionOption extends JobPositionOption {
  jobId: string;
}

// Widened (CRM Comments item 1/6, 2026-08-10, per business follow-up:
// "not capturing all the fields that may need changes, mostly only
// biodata") — covers everything PartnerCandidateForm collects at
// submission (Sections 3 + 6), not just name/email/nationality/passport.
interface EditForm {
  job_id: string;
  job_position_id: string;
  full_name: string;
  email: string;
  nationality: string;
  second_nationality: string;
  gender: string;
  passport_number: string;
  date_of_birth: string;
  passport_expiry: string;
  current_occupation: string;
  highest_education: string;
  home_address: string;
  whatsapp_number: string;
  marital_status: string;
  earliest_travel_date: string;
  current_location_country_name: string;
  prior_eu_visa_applied: boolean | null;
  prior_eu_visa_applied_details: string;
  holds_schengen_visa: boolean | null;
  holds_schengen_visa_details: string;
  prior_visa_refusals: boolean | null;
  prior_visa_refusals_details: string;
  available_for_embassy_appointment: boolean;
  willing_to_start_within_30_days: boolean;
  preferred_contact_channel: string;
}

interface PartnerCandidateDetail {
  id: string;
  status: string;
  full_name: string;
  email: string;
  nationality: string;
  second_nationality: string | null;
  gender: string | null;
  passport_number: string;
  date_of_birth: string;
  passport_expiry: string;
  current_occupation: string | null;
  highest_education: string | null;
  home_address: string | null;
  whatsapp_number: string | null;
  marital_status: string | null;
  earliest_travel_date: string;
  current_location_country_name: string;
  current_location_country: { name: string } | null;
  prior_eu_visa_applied: boolean | null;
  prior_eu_visa_applied_details: string | null;
  holds_schengen_visa: boolean | null;
  holds_schengen_visa_details: string | null;
  prior_visa_refusals: boolean | null;
  prior_visa_refusals_details: string | null;
  available_for_embassy_appointment: boolean;
  willing_to_start_within_30_days: boolean;
  preferred_contact_channel: string | null;
  rejection_reason: string | null;
  bridged_candidate_id: string | null;
  submitted_at: string;
  job_position_id: string | null;
  job: {
    id: string;
    title: string;
    country: string;
    city: string;
    service_fee_gbp: number | null;
    is_credit_service: boolean;
    financing_percent: number | null;
    installment_count: number | null;
  } | null;
  job_position: {
    title: string;
    city: string | null;
    job_sector: { sector: string };
  } | null;
  bridged_candidate: {
    id: string;
    documents: { id: string; type: string; verification_status: string; uploaded_at: string; label: string | null }[];
  } | null;
}

function yesNoWithDetail(value: boolean | null | undefined, detail?: string | null): string | undefined {
  if (value === null || value === undefined) return undefined;
  const base = value ? "Yes" : "No";
  return detail ? `${base} — ${detail}` : base;
}

const STATUS_STYLES: Record<string, string> = {
  submitted: "bg-blue-100 text-blue-700",
  under_review: "bg-yellow-100 text-yellow-800",
  job_assigned: "bg-emerald-100 text-emerald-800",
  rejected: "bg-red-100 text-red-700",
};

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] text-midnight-900/40 uppercase tracking-wider mb-0.5">{label}</div>
      <div className="text-sm text-midnight-900">{value || "—"}</div>
    </div>
  );
}

// A partner's own read-only view of a submission it made (SRS FR-5.1,
// 2026-07-31 per the Operational Workflow SOP) — the message thread here
// is the same one HR sees from its review page (Phase 11's shared access
// widening), so the back-and-forth over a documentation issue happens on
// one continuous thread, not two separate views of it.
export default function PartnerCandidateDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [data, setData] = useState<PartnerCandidateDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [docTypes, setDocTypes] = useState<{ key: string; label: string }[]>([]);
  const [replacingType, setReplacingType] = useState<string | null>(null);
  const [replaceFile, setReplaceFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadType, setUploadType] = useState("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [justReplaced, setJustReplaced] = useState(false);

  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<EditForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Country -> Sector -> Position editor state (2026-09-03) — same pattern
  // as PartnerCandidateForm.tsx's submission-time picker, reused here so a
  // partner can correct their own submission's programme, not just
  // personal-info/visa-readiness fields. Fetched once on mount (not gated
  // on editing) so it's ready the moment "Edit" is clicked.
  const [jobs, setJobs] = useState<JobOption[]>([]);
  const [selectedCountry, setSelectedCountry] = useState("");
  const [sector, setSector] = useState("");

  useEffect(() => {
    fetch("/api/jobs?limit=50&audience=partner")
      .then((r) => r.json())
      .then((res) => setJobs(res.jobs ?? []))
      .catch(() => {});
  }, []);

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

  const startEditing = () => {
    if (!data) return;
    const currentJob = jobs.find((j) => j.id === data.job?.id);
    setSelectedCountry(currentJob ? (currentJob.is_credit_service ? `${currentJob.country}::credit` : currentJob.country) : "");
    setSector(data.job_position?.job_sector.sector ?? "");
    setEditForm({
      job_id: data.job?.id ?? "",
      job_position_id: data.job_position_id ?? "",
      full_name: data.full_name,
      email: data.email,
      nationality: data.nationality,
      second_nationality: data.second_nationality ?? "",
      gender: data.gender ?? "",
      passport_number: data.passport_number,
      date_of_birth: data.date_of_birth.slice(0, 10),
      passport_expiry: data.passport_expiry.slice(0, 10),
      current_occupation: data.current_occupation ?? "",
      highest_education: data.highest_education ?? "",
      home_address: data.home_address ?? "",
      whatsapp_number: data.whatsapp_number ?? "",
      marital_status: data.marital_status ?? "",
      earliest_travel_date: data.earliest_travel_date.slice(0, 10),
      current_location_country_name: data.current_location_country?.name ?? data.current_location_country_name,
      prior_eu_visa_applied: data.prior_eu_visa_applied,
      prior_eu_visa_applied_details: data.prior_eu_visa_applied_details ?? "",
      holds_schengen_visa: data.holds_schengen_visa,
      holds_schengen_visa_details: data.holds_schengen_visa_details ?? "",
      prior_visa_refusals: data.prior_visa_refusals,
      prior_visa_refusals_details: data.prior_visa_refusals_details ?? "",
      available_for_embassy_appointment: data.available_for_embassy_appointment,
      willing_to_start_within_30_days: data.willing_to_start_within_30_days,
      preferred_contact_channel: data.preferred_contact_channel ?? "",
    });
    setSaveError(null);
    setEditing(true);
  };

  const saveEdits = async () => {
    if (!editForm) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(`/api/partner/candidates/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...editForm,
          job_id: editForm.job_id || undefined,
          job_position_id: editForm.job_position_id || undefined,
          prior_eu_visa_applied: editForm.prior_eu_visa_applied ?? undefined,
          holds_schengen_visa: editForm.holds_schengen_visa ?? undefined,
          prior_visa_refusals: editForm.prior_visa_refusals ?? undefined,
          preferred_contact_channel: editForm.preferred_contact_channel || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setSaveError(json.error?.message ?? "Failed to save changes.");
        return;
      }
      setEditing(false);
      load();
    } finally {
      setSaving(false);
    }
  };

  const load = () => {
    fetch(`/api/partner/candidates/${id}`)
      .then((r) => r.json())
      .then((res) => {
        if (!res.data) { setError(res.error?.message ?? "Failed to load submission."); return; }
        setData(res.data);
      })
      .catch(() => setError("Failed to load submission."))
      .finally(() => setLoading(false));
  };

  useEffect(load, [id]);

  useEffect(() => {
    fetch("/api/apply/options")
      .then((r) => r.json())
      .then((res) => {
        const types = (res.documentTypes ?? []).filter((t: { key: string }) => !(NON_PROGRAMME_TYPE_KEYS as readonly string[]).includes(t.key));
        setDocTypes(types);
        setUploadType((prev) => prev || types[0]?.key || "");
      })
      .catch(() => {});
  }, []);

  const uploadDocument = async (type: string, file: File | null, onDone: () => void) => {
    if (!file || !data?.bridged_candidate_id) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch(`/api/upload?type=${type}&candidate_id=${data.bridged_candidate_id}`, { method: "POST", body: formData });
      const json = await res.json();
      if (!res.ok) { alert(json.error ?? "Upload failed."); return; }
      onDone();
      load();
    } finally {
      setUploading(false);
    }
  };

  if (loading) {
    return (
      <PortalShell roleLabel="Partner" navItems={PARTNER_NAV_ITEMS}>
        <div className="flex flex-col items-center justify-center gap-3 py-24 text-midnight-900/50">
          <CircleNotch size={28} weight="bold" className="animate-spin text-gold-500" />
          <p className="text-sm">Loading submission…</p>
        </div>
      </PortalShell>
    );
  }
  if (!data) {
    return (
      <PortalShell roleLabel="Partner" navItems={PARTNER_NAV_ITEMS}>
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4 text-sm">{error}</div>
      </PortalShell>
    );
  }
  // This read-only detail view assumes a finished submission (full_name/
  // passport/etc. all populated) — a draft's fields can be partially or
  // entirely empty (2026-09-09) and is reached through the "My Candidates"
  // list's resume-in-modal flow instead, never this page. Guard direct
  // navigation (a stale link, browser back, etc.) rather than letting a
  // null field below crash the render.
  if (data.status === "draft") {
    return (
      <PortalShell roleLabel="Partner" navItems={PARTNER_NAV_ITEMS}>
        <div className="card p-10 text-center text-midnight-900/50">
          This submission is still a draft — resume it from your{" "}
          <a href="/partner" className="text-gold-600 underline">candidate list</a>.
        </div>
      </PortalShell>
    );
  }

  return (
    <PortalShell roleLabel="Partner" navItems={PARTNER_NAV_ITEMS}>
      <p className="eyebrow mb-3">
        <span className="eyebrow-rule" />
        My Candidates
      </p>
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="section-title text-3xl md:text-4xl mb-2">{data.full_name}.</h1>
          <p className="text-midnight-900/55 font-light max-w-2xl">
            Submitted {new Date(data.submitted_at).toLocaleDateString()}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {!editing && (
            <button
              type="button"
              onClick={startEditing}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-gold-600 hover:underline"
            >
              <PencilSimple size={14} weight="bold" /> Edit
            </button>
          )}
          <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold ${STATUS_STYLES[data.status] ?? "bg-slate-100 text-slate-700"}`}>
            {formatPartnerCandidateStatus(data.status)}
          </span>
        </div>
      </div>

      {data.status === "rejected" && data.rejection_reason && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-lg p-4 text-sm mb-6">
          <strong>Needs attention:</strong> {data.rejection_reason} — message our team below with any updated documents.
        </div>
      )}

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <div className="card p-6">
            <h3 className="text-sm font-semibold text-midnight-900/70 uppercase tracking-wider mb-4">Opportunity</h3>
            {editing && editForm ? (
              <div className="space-y-4">
                <div>
                  <div className="text-[11px] font-semibold text-midnight-900/50 uppercase tracking-wider mb-2">Programme Information</div>
                  <div className="grid sm:grid-cols-3 gap-4">
                    <div>
                      <div className="text-[11px] text-midnight-900/40 uppercase tracking-wider mb-0.5">Country</div>
                      <SearchableSelect
                        value={selectedCountry}
                        onChange={(value) => {
                          setSelectedCountry(value);
                          setSector("");
                          setEditForm({ ...editForm, job_id: "", job_position_id: "" });
                        }}
                        placeholder="Select a country…"
                        options={countryOptions.map((o) => ({ value: o.value, label: o.label }))}
                        className="text-sm"
                      />
                    </div>
                    <div>
                      <div className="text-[11px] text-midnight-900/40 uppercase tracking-wider mb-0.5">Sector</div>
                      <SearchableSelect
                        value={sector}
                        onChange={(value) => {
                          setSector(value);
                          setEditForm({ ...editForm, job_id: "", job_position_id: "" });
                        }}
                        disabled={!selectedCountry}
                        placeholder={selectedCountry ? "Select a sector…" : "Select a country first…"}
                        options={sectorOptions.map((s) => ({ value: s, label: s }))}
                        className="text-sm"
                      />
                    </div>
                    <div>
                      <div className="text-[11px] text-midnight-900/40 uppercase tracking-wider mb-0.5">Position</div>
                      <SearchableSelect
                        value={editForm.job_position_id}
                        onChange={(value) => {
                          const pos = positionOptions.find((p) => p.id === value);
                          setEditForm({ ...editForm, job_position_id: value, job_id: pos?.jobId ?? "" });
                        }}
                        disabled={!sector}
                        placeholder={sector ? "Select a position…" : "Select a sector first…"}
                        options={positionOptions.map((p) => ({ value: p.id, label: p.city ? `${p.title} — ${p.city}` : p.title }))}
                        className="text-sm"
                      />
                    </div>
                  </div>
                </div>
                <div className="grid sm:grid-cols-2 gap-4">
                  <div>
                    <div className="text-[11px] text-midnight-900/40 uppercase tracking-wider mb-0.5">Earliest Travel Date</div>
                    <input
                      type="date"
                      value={editForm.earliest_travel_date}
                      onChange={(e) => setEditForm({ ...editForm, earliest_travel_date: e.target.value })}
                      className="input-field text-sm w-full"
                    />
                  </div>
                  <div>
                    <div className="text-[11px] text-midnight-900/40 uppercase tracking-wider mb-0.5">Current Location</div>
                    <SearchableSelect
                      value={editForm.current_location_country_name}
                      onChange={(value) => setEditForm({ ...editForm, current_location_country_name: value })}
                      options={WORLD_COUNTRY_OPTIONS}
                    />
                  </div>
                </div>
              </div>
            ) : (
              <div className="grid sm:grid-cols-2 gap-4">
                <Field
                  label="Programme"
                  value={
                    data.job?.title ? (
                      <span className="inline-flex items-center gap-2">
                        {data.job.title}
                        {data.job.is_credit_service && (
                          <span className="inline-flex items-center rounded-full bg-gold-500/15 text-gold-700 border border-gold-500/40 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
                            Credit Service
                          </span>
                        )}
                      </span>
                    ) : null
                  }
                />
                <Field label="Destination" value={data.job ? `${data.job.city}, ${data.job.country}` : null} />
                <Field
                  label="Position"
                  value={data.job_position ? (data.job_position.city ? `${data.job_position.title} — ${data.job_position.city}` : data.job_position.title) : null}
                />
                {data.job?.is_credit_service && data.job.service_fee_gbp != null && data.job.financing_percent != null && data.job.installment_count != null && (() => {
                  const s = computeCreditServiceSchedule(data.job.service_fee_gbp, data.job.financing_percent, data.job.installment_count);
                  return (
                    <Field
                      label="Credit Service Terms"
                      value={`£${data.job.service_fee_gbp.toLocaleString()} total · £${s.upfrontGbp.toLocaleString()} upfront · ${s.installmentCount}× £${s.installmentAmountGbp.toLocaleString()}`}
                    />
                  );
                })()}
                <Field label="Earliest Travel Date" value={new Date(data.earliest_travel_date).toLocaleDateString()} />
                <Field label="Current Location" value={data.current_location_country?.name ?? data.current_location_country_name} />
              </div>
            )}
          </div>

          <div className="card p-6">
            <h3 className="text-sm font-semibold text-midnight-900/70 uppercase tracking-wider mb-4">Candidate Details</h3>
            {editing && editForm ? (
              <div className="space-y-4">
                <div className="grid sm:grid-cols-2 gap-4">
                  <div>
                    <div className="text-[11px] text-midnight-900/40 uppercase tracking-wider mb-0.5">Full Name</div>
                    <input value={editForm.full_name} onChange={(e) => setEditForm({ ...editForm, full_name: e.target.value })} className="input-field text-sm w-full" />
                  </div>
                  <div>
                    <div className="text-[11px] text-midnight-900/40 uppercase tracking-wider mb-0.5">Email</div>
                    <input type="email" value={editForm.email} onChange={(e) => setEditForm({ ...editForm, email: e.target.value })} className="input-field text-sm w-full" />
                  </div>
                  <div>
                    <div className="text-[11px] text-midnight-900/40 uppercase tracking-wider mb-0.5">Nationality</div>
                    <SearchableSelect value={editForm.nationality} onChange={(value) => setEditForm({ ...editForm, nationality: value })} options={WORLD_COUNTRY_OPTIONS} />
                  </div>
                  <div>
                    <div className="text-[11px] text-midnight-900/40 uppercase tracking-wider mb-0.5">Second Nationality</div>
                    <SearchableSelect value={editForm.second_nationality} onChange={(value) => setEditForm({ ...editForm, second_nationality: value })} options={WORLD_COUNTRY_OPTIONS} placeholder="None" />
                  </div>
                  <div>
                    <div className="text-[11px] text-midnight-900/40 uppercase tracking-wider mb-0.5">Gender</div>
                    <SearchableSelect value={editForm.gender} onChange={(value) => setEditForm({ ...editForm, gender: value })} options={GENDER_OPTIONS} placeholder="Select…" />
                  </div>
                  <div>
                    <div className="text-[11px] text-midnight-900/40 uppercase tracking-wider mb-0.5">Passport Number</div>
                    <input value={editForm.passport_number} onChange={(e) => setEditForm({ ...editForm, passport_number: e.target.value })} className="input-field text-sm w-full" />
                  </div>
                  <div>
                    <div className="text-[11px] text-midnight-900/40 uppercase tracking-wider mb-0.5">Date of Birth</div>
                    <input type="date" value={editForm.date_of_birth} onChange={(e) => setEditForm({ ...editForm, date_of_birth: e.target.value })} className="input-field text-sm w-full" />
                  </div>
                  <div>
                    <div className="text-[11px] text-midnight-900/40 uppercase tracking-wider mb-0.5">Passport Expiry</div>
                    <input type="date" value={editForm.passport_expiry} onChange={(e) => setEditForm({ ...editForm, passport_expiry: e.target.value })} className="input-field text-sm w-full" />
                  </div>
                  <div>
                    <div className="text-[11px] text-midnight-900/40 uppercase tracking-wider mb-0.5">Current Occupation</div>
                    <input value={editForm.current_occupation} onChange={(e) => setEditForm({ ...editForm, current_occupation: e.target.value })} className="input-field text-sm w-full" />
                  </div>
                  <div>
                    <div className="text-[11px] text-midnight-900/40 uppercase tracking-wider mb-0.5">Highest Education</div>
                    <input value={editForm.highest_education} onChange={(e) => setEditForm({ ...editForm, highest_education: e.target.value })} className="input-field text-sm w-full" />
                  </div>
                  <div>
                    <div className="text-[11px] text-midnight-900/40 uppercase tracking-wider mb-0.5">WhatsApp Number</div>
                    <input value={editForm.whatsapp_number} onChange={(e) => setEditForm({ ...editForm, whatsapp_number: e.target.value })} className="input-field text-sm w-full" />
                  </div>
                  <div>
                    <div className="text-[11px] text-midnight-900/40 uppercase tracking-wider mb-0.5">Marital Status</div>
                    <SearchableSelect value={editForm.marital_status} onChange={(value) => setEditForm({ ...editForm, marital_status: value })} options={MARITAL_STATUS_OPTIONS} placeholder="Select…" />
                  </div>
                  <div className="sm:col-span-2">
                    <div className="text-[11px] text-midnight-900/40 uppercase tracking-wider mb-0.5">Home Address</div>
                    <input value={editForm.home_address} onChange={(e) => setEditForm({ ...editForm, home_address: e.target.value })} className="input-field text-sm w-full" />
                  </div>
                </div>
              </div>
            ) : (
              <div className="grid sm:grid-cols-2 gap-4">
                <Field label="Email" value={data.email} />
                <Field label="Nationality" value={data.nationality} />
                <Field label="Second Nationality" value={data.second_nationality} />
                <Field label="Gender" value={data.gender ? data.gender[0].toUpperCase() + data.gender.slice(1) : null} />
                <Field label="Passport Number" value={data.passport_number} />
                <Field label="Date of Birth" value={new Date(data.date_of_birth).toLocaleDateString()} />
                <Field label="Passport Expiry" value={new Date(data.passport_expiry).toLocaleDateString()} />
                <Field label="Current Occupation" value={data.current_occupation} />
                <Field label="Highest Education" value={data.highest_education} />
                <Field label="WhatsApp Number" value={data.whatsapp_number} />
                <Field label="Marital Status" value={data.marital_status} />
                <div className="sm:col-span-2">
                  <Field label="Home Address" value={data.home_address} />
                </div>
              </div>
            )}
          </div>

          <div className="card p-6">
            <h3 className="text-sm font-semibold text-midnight-900/70 uppercase tracking-wider mb-4">Visa &amp; Travel Readiness</h3>
            {editing && editForm ? (
              <div className="space-y-4">
                <div className="grid sm:grid-cols-2 gap-4">
                  <YesNoDetailField
                    label="Prior EU Visa Applied"
                    value={editForm.prior_eu_visa_applied}
                    detail={editForm.prior_eu_visa_applied_details}
                    onChange={(v) => setEditForm({ ...editForm, prior_eu_visa_applied: v })}
                    onDetailChange={(v) => setEditForm({ ...editForm, prior_eu_visa_applied_details: v })}
                  />
                  <YesNoDetailField
                    label="Holds Schengen Visa"
                    value={editForm.holds_schengen_visa}
                    detail={editForm.holds_schengen_visa_details}
                    onChange={(v) => setEditForm({ ...editForm, holds_schengen_visa: v })}
                    onDetailChange={(v) => setEditForm({ ...editForm, holds_schengen_visa_details: v })}
                  />
                  <YesNoDetailField
                    label="Prior Visa Refusals"
                    value={editForm.prior_visa_refusals}
                    detail={editForm.prior_visa_refusals_details}
                    onChange={(v) => setEditForm({ ...editForm, prior_visa_refusals: v })}
                    onDetailChange={(v) => setEditForm({ ...editForm, prior_visa_refusals_details: v })}
                  />
                  <div>
                    <div className="text-[11px] text-midnight-900/40 uppercase tracking-wider mb-0.5">Preferred Contact Channel</div>
                    <SearchableSelect
                      value={editForm.preferred_contact_channel}
                      onChange={(value) => setEditForm({ ...editForm, preferred_contact_channel: value })}
                      options={CONTACT_CHANNEL_OPTIONS}
                    />
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <label className="flex items-center gap-1.5 text-xs text-midnight-900/70">
                    <input
                      type="checkbox"
                      checked={editForm.available_for_embassy_appointment}
                      onChange={(e) => setEditForm({ ...editForm, available_for_embassy_appointment: e.target.checked })}
                      className="w-3.5 h-3.5"
                    />
                    Available for embassy appointment
                  </label>
                  <label className="flex items-center gap-1.5 text-xs text-midnight-900/70">
                    <input
                      type="checkbox"
                      checked={editForm.willing_to_start_within_30_days}
                      onChange={(e) => setEditForm({ ...editForm, willing_to_start_within_30_days: e.target.checked })}
                      className="w-3.5 h-3.5"
                    />
                    Willing to start within 30 days
                  </label>
                </div>
                {saveError && <p className="text-xs text-red-600">{saveError}</p>}
                <div className="flex items-center gap-3 pt-2 border-t border-midnight-900/10">
                  <button type="button" disabled={saving} onClick={saveEdits} className="btn-primary text-xs px-4 py-2 disabled:opacity-50">
                    {saving ? "Saving…" : "Save Changes"}
                  </button>
                  <button type="button" onClick={() => setEditing(false)} className="text-xs text-midnight-900/40 hover:underline">
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="grid sm:grid-cols-2 gap-4">
                <Field label="Prior EU Visa Applied" value={yesNoWithDetail(data.prior_eu_visa_applied, data.prior_eu_visa_applied_details)} />
                <Field label="Holds Schengen Visa" value={yesNoWithDetail(data.holds_schengen_visa, data.holds_schengen_visa_details)} />
                <Field label="Prior Visa Refusals" value={yesNoWithDetail(data.prior_visa_refusals, data.prior_visa_refusals_details)} />
                <Field label="Available for Embassy Appointment" value={data.available_for_embassy_appointment ? "Yes" : "No"} />
                <Field label="Willing to Start Within 30 Days" value={data.willing_to_start_within_30_days ? "Yes" : "No"} />
                <Field label="Preferred Contact Channel" value={data.preferred_contact_channel} />
              </div>
            )}
          </div>

          <div className="card p-6">
            <h3 className="text-sm font-semibold text-midnight-900/70 uppercase tracking-wider mb-4">Documents</h3>
            <div className="space-y-2 mb-4">
              {(!data.bridged_candidate || data.bridged_candidate.documents.length === 0) && (
                <p className="text-sm text-midnight-900/40">No documents uploaded yet.</p>
              )}
              {data.bridged_candidate?.documents.map((d) => (
                <div key={d.id} className="border-b border-midnight-900/5 pb-2">
                  <div className="flex items-center justify-between text-sm">
                    <DocumentLink documentId={d.id} label={d.type} className="text-gold-600 hover:underline capitalize" />
                    <span className={`inline-flex items-center gap-1 text-xs capitalize ${d.verification_status === "verified" ? "text-emerald-700" : d.verification_status === "rejected" ? "text-red-600" : "text-midnight-900/40"}`}>
                      {d.verification_status === "verified" ? (
                        <CheckCircle size={13} weight="fill" className="text-emerald-600" />
                      ) : (
                        <WarningCircle size={13} weight="fill" className={d.verification_status === "rejected" ? "text-red-600" : "text-amber-600"} />
                      )}
                      {d.verification_status}
                    </span>
                  </div>
                  {d.verification_status === "rejected" && (
                    <div className="mt-2 flex items-center gap-2 bg-red-50 rounded-lg p-2">
                      <span className="text-xs text-red-700 flex-1">Rejected — attach a new version to replace it.</span>
                      <input
                        type="file"
                        accept="application/pdf,image/*"
                        onChange={(e) => { setReplacingType(d.type); setReplaceFile(e.target.files?.[0] ?? null); }}
                        className="text-xs text-slate-500 file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:bg-white file:text-slate-700 file:text-xs max-w-[180px]"
                      />
                      <button
                        type="button"
                        disabled={uploading || replacingType !== d.type || !replaceFile}
                        onClick={() => uploadDocument(d.type, replaceFile, () => { setReplacingType(null); setReplaceFile(null); setJustReplaced(true); })}
                        className="btn-primary text-xs px-3 py-1.5 disabled:opacity-40"
                      >
                        {uploading && replacingType === d.type ? "Uploading…" : "Replace"}
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
            <div className="flex items-center gap-2 pt-2 border-t border-midnight-900/10">
              <SearchableSelect value={uploadType} onChange={setUploadType} className="w-auto" options={docTypes.map((t) => ({ value: t.key, label: t.label }))} />
              <input type="file" accept="application/pdf,image/*" onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)} className="text-sm" />
              <button
                type="button"
                disabled={uploading || !uploadFile}
                onClick={() => uploadDocument(uploadType, uploadFile, () => setUploadFile(null))}
                className="btn-primary text-xs px-3 py-1.5 disabled:opacity-40"
              >
                {uploading && !replacingType ? "Uploading…" : "Upload"}
              </button>
            </div>

            {data.bridged_candidate_id && (
              <SupportingDocumentUpload
                candidateId={data.bridged_candidate_id}
                documents={(data.bridged_candidate?.documents ?? []).filter((d) => d.type === "other")}
                onUploaded={load}
              />
            )}
          </div>
        </div>

        <div className="space-y-4">
          {justReplaced && (
            <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg p-3 text-xs">
              Replaced — send a message below to let our team know it's ready for another look.
            </div>
          )}
          {data.bridged_candidate_id && <CandidateMessages candidateId={data.bridged_candidate_id} />}
        </div>
      </div>
    </PortalShell>
  );
}
