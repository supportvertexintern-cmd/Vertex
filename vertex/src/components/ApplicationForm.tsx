"use client";

import { useEffect, useMemo, useState } from "react";
import SearchableSelect from "@/components/SearchableSelect";
import ServiceFeeNotice from "@/components/ServiceFeeNotice";
import { NON_PROGRAMME_TYPE_KEYS } from "@/lib/documentTypes";
import { WORLD_COUNTRIES } from "@/lib/worldCountries";
import { MARITAL_STATUS_OPTIONS } from "@/lib/maritalStatus";
import { GENDER_OPTIONS } from "@/lib/gender";

const WORLD_COUNTRY_OPTIONS = WORLD_COUNTRIES.map((name) => ({ value: name, label: name }));

interface Option {
  id: string;
  name: string;
}

interface DocumentTypeOption {
  key: string;
  label: string;
  is_universal: boolean;
}

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
  category: string | null;
  sectors: JobSectorOption[];
}

// Canonical sector order (2026-08-31) — matches the business's own
// Positions by Country & Sector reference sheet naming exactly, so a
// candidate sees the same sector vocabulary staff/partners use. A sector
// with no active Job under it simply never appears in the picker.
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

interface Props {
  /** Present when staff is submitting on behalf of an existing candidate record (SRS FR-2.1). */
  candidateId?: string;
  onSubmitted: () => void;
  /** Renders a compact layout for embedding inside a portal panel rather than the full public page. */
  compact?: boolean;
  /**
   * Whether to render Section 2 (Personal Information) and the Candidate
   * Declaration inline — true for every genuine public self-service
   * submitter (anonymous, or a signed-in candidate) and a recruiter
   * entering a walk-in lead. False only for the narrower staff-on-behalf-
   * of-an-existing-candidate flow (candidateId set), where personal info
   * isn't collected by this form at all. Section 2's data is submitted as
   * part of this same POST either way — see initialProfile for prefilling
   * it from what's already on file.
   */
  includePersonalInfo?: boolean;
  /**
   * Set when arriving from a specific opportunity on /jobs (via
   * /apply?job=...) — preselects Section 1's Job picker with this id.
   * Still editable — the picker isn't locked to this value.
   */
  jobId?: string;
  /**
   * Pre-fills Section 2 for a signed-in candidate from whatever's already
   * on file (registration details, or a prior partial save) — still
   * editable, and still submitted as part of this same POST alongside
   * Sections 1/3/4/5. The CIF treats every public self-service submitter
   * as supplying fresh Section 2 data every time, whether or not they
   * already have an account; there's no separate "update my profile"
   * request involved.
   */
  initialProfile?: Partial<{
    full_name: string;
    nationality: string;
    date_of_birth: string;
    passport_number: string;
    passport_expiry: string;
    second_nationality: string;
    gender: string;
    current_occupation: string;
    highest_education: string;
    home_address: string;
    phone: string;
    whatsapp_number: string;
    email: string;
    marital_status: string;
  }>;
  /**
   * Only set by the public /apply page's two renders (signed-out and
   * signed-in-candidate) — RegisterCandidateForm (recruiter walk-in lead)
   * and PartnerCandidateForm never set this, so staff-entered submissions
   * always go straight into the CRM regardless of the admin's Public Form
   * Intake Mode setting. When set and the fetched mode is "email", submit
   * posts to /api/public-intake/application (no CRM writes, straight to
   * PUBLIC_FORMS_NOTIFY_EMAIL) instead of /api/applications.
   */
  useEmailIntakeIfConfigured?: boolean;
  /**
   * Set only by /apply's signed-in-candidate render (2026-08-06) — tells
   * Section 3's post-submit upload loop to use the plain self-upload path
   * (no candidate_id) instead of the on-behalf path every other renderer
   * of this form ends up using (an anonymous self-applicant via the
   * upload_token the submission response returns, or a staff user's own
   * session for a walk-in lead) — a signed-in "candidate" role isn't in
   * /api/upload's on-behalf allowlist at all, so passing candidate_id
   * explicitly here would 403.
   */
  signedInCandidate?: boolean;
  /**
   * Referral Agent attribution (2026-08-29) — the code captured from
   * /apply's ?ref= param (or a prior visit's localStorage copy). Resolved
   * server-side against a real, active ReferralAgent in
   * POST /api/applications; an invalid/unknown code never blocks
   * submission, it just falls through to source: "self_registered".
   */
  referralCode?: string;
}

const emptyForm = {
  job_id: "",
  job_position_id: "",
  earliest_travel_date: "",
  prior_eu_visa_applied: null as boolean | null,
  prior_eu_visa_applied_details: "",
  documents_available: [] as string[],

  full_name: "",
  nationality: "",
  date_of_birth: "",
  passport_number: "",
  passport_expiry: "",
  second_nationality: "",
  gender: "",
  current_occupation: "",
  highest_education: "",
  home_address: "",
  phone: "",
  whatsapp_number: "",
  email: "",
  marital_status: "",

  payment_plan_acknowledged: false,

  current_location_country_name: "",
  holds_schengen_visa: null as boolean | null,
  holds_schengen_visa_details: "",
  prior_visa_refusals: null as boolean | null,
  prior_visa_refusals_details: "",
  available_for_embassy_appointment: false,
  willing_to_start_within_30_days: false,
  preferred_contact_channel: "" as "" | "email" | "whatsapp" | "phone",

  consent_given: false,
  cover_letter: "",
};

/**
 * The Candidate Information Form, in the same section order as the
 * original document (1, 2, 3, 4, 5, Declaration). Section 2 (Personal
 * Information) and the Candidate Declaration render whenever this is a
 * genuine public self-service submission (includePersonalInfo) — a signed-
 * in candidate is treated the same as a brand-new one here: their Section
 * 2 answers are submitted fresh as part of this one POST (pre-filled from
 * initialProfile if anything's already on file), not fetched-then-PUT
 * against an existing row beforehand, which is fragile exactly when
 * there's nothing on file yet (right after registering, the common case).
 * Section 3 only records which documents the candidate can provide
 * (checkboxes, self-reported) — actually uploading them happens later,
 * from the candidate's own dashboard, once an account exists. Shared by
 * the public /apply page and the recruiter's new-lead entry point
 * (2026-07-31: both now pick a specific Job/programme in Section 1 rather
 * than a country/sector, and route by Candidate.source afterward — a
 * public submission now always goes to HR for review, a recruiter's own
 * walk-in lead stays exactly on its existing recruiter/supervisor/inhouse
 * pipeline), and the narrower existing-candidate on-behalf flow, since all
 * three submit through the same POST /api/applications (or, while the CRM
 * isn't live yet for public traffic, POST /api/public-intake/application).
 */
export default function ApplicationForm({ candidateId, onSubmitted, compact, includePersonalInfo, jobId, initialProfile, useEmailIntakeIfConfigured, signedInCandidate, referralCode }: Props) {
  const [countries, setCountries] = useState<Option[]>([]);
  const [locationCountries, setLocationCountries] = useState<Option[]>([]);
  const [jobs, setJobs] = useState<JobOption[]>([]);
  // Sector is a client-side filter only (2026-08-31) — never submitted;
  // the picked Job/programme itself still determines the country, exactly
  // as before. Narrows the Opportunity picker down to that sector's
  // programmes so a candidate isn't scanning all 20+ at once.
  const [sector, setSector] = useState("");
  const [documentTypes, setDocumentTypes] = useState<DocumentTypeOption[]>([]);
  const [documentRequirements, setDocumentRequirements] = useState<{ country_id: string; document_type: string }[]>([]);
  // Defaults "email" so that if useEmailIntakeIfConfigured is set and
  // someone somehow submits before /api/apply/options resolves, the safe
  // failure mode is "email PUBLIC_FORMS_NOTIFY_EMAIL", not "silently write
  // into a CRM the business hasn't signed off on yet" — same fail-safe
  // reasoning as that route's own server-side default.
  const [intakeMode, setIntakeMode] = useState<"email" | "crm">("email");
  const [form, setForm] = useState(() => {
    // A plain {...emptyForm, ...initialProfile} spread would overwrite a
    // field with `undefined` whenever initialProfile has that key at all
    // (e.g. { full_name: profile.user?.full_name ?? undefined } always
    // has the key) — turning a controlled input's value from "" into
    // undefined and triggering React's controlled/uncontrolled warning.
    // Only fields with a real defined value should override emptyForm's "".
    const merged = { ...emptyForm, job_id: jobId ?? "" };
    if (initialProfile) {
      for (const [key, value] of Object.entries(initialProfile)) {
        if (value !== undefined) (merged as Record<string, unknown>)[key] = value;
      }
    }
    return merged;
  });
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [message, setMessage] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  // Real files, collected client-side as each checkbox is ticked
  // (2026-08-06) — uploaded in a loop right after the main submission
  // succeeds and returns a candidate id, same two-step shape
  // PartnerCandidateForm's own Section 4 already established. Nothing is
  // uploaded until Submit; unchecking a document clears its file too.
  const [documentFiles, setDocumentFiles] = useState<Record<string, File | null>>({});
  const [otherDocuments, setOtherDocuments] = useState<{ label: string; file: File | null }[]>([]);

  useEffect(() => {
    fetch("/api/apply/options")
      .then((r) => r.json())
      .then((res) => {
        setCountries(res.countries ?? []);
        setLocationCountries(res.locationCountries ?? []);
        setDocumentTypes(res.documentTypes ?? []);
        setDocumentRequirements(res.documentRequirements ?? []);
        setIntakeMode(res.intakeMode === "email" ? "email" : "crm");
      })
      .catch(() => {});
    fetch("/api/jobs?limit=50")
      .then((r) => r.json())
      .then((res) => setJobs(res.jobs ?? []))
      .catch(() => {});
  }, []);

  // Section 3's checklist — a self-reported "can you provide this?" at
  // submission time, not the documents themselves (those are uploaded
  // later, from the candidate's own dashboard, once an account exists).
  // Admin-managed (DocumentRequirementType) rather than hardcoded, so a
  // type/requirement admin adds shows up here immediately.
  const documentChecklist = useMemo(
    () => documentTypes.filter((t) => !(NON_PROGRAMME_TYPE_KEYS as readonly string[]).includes(t.key)),
    [documentTypes]
  );
  // "Required for" hints scoped to the selected Job's own destination
  // country (2026-07-31) — replaces the old all-countries breakdown, since
  // Section 1 is a single Job pick now rather than 3 country alternates.
  const selectedJob = useMemo(() => jobs.find((j) => j.id === form.job_id), [jobs, form.job_id]);

  // Sector list, ordered per SECTOR_ORDER — only sectors with at least one
  // active Job actually appear, rather than showing an empty dead end.
  const sectorOptions = useMemo(() => {
    const present = new Set(jobs.flatMap((j) => j.sectors.map((s) => s.sector)));
    return SECTOR_ORDER.filter((s) => present.has(s));
  }, [jobs]);
  // A job can now belong to more than one sector (2026-09-02) — matches if
  // ANY of its attached sectors is the one selected.
  const jobsInSector = useMemo(
    () => (sector ? jobs.filter((j) => j.sectors.some((s) => s.sector === sector)) : jobs),
    [jobs, sector]
  );
  // Position options — the selected Job's own sector row matching the
  // selected sector, then its positions. Requires both sector and job_id;
  // empty otherwise.
  const positionOptions = useMemo(() => {
    if (!selectedJob) return [];
    return selectedJob.sectors.find((s) => s.sector === sector)?.positions ?? [];
  }, [selectedJob, sector]);

  // Keeps the sector filter in sync with whatever Job ends up selected —
  // covers both a preselected jobId (arriving via /apply?job=...) and a
  // signed-in candidate's own initialProfile-driven prefill, neither of
  // which goes through the sector picker's own onChange. Also
  // auto-selects the Position when the resulting list has exactly one
  // entry, preserving the old one-click behavior for a single-position
  // job — otherwise leaves Position for the user to pick.
  useEffect(() => {
    if (!selectedJob) return;
    const matchingSector = selectedJob.sectors.find((s) => s.sector === sector) ?? selectedJob.sectors[0];
    if (matchingSector && matchingSector.sector !== sector) setSector(matchingSector.sector);
    if (matchingSector?.positions.length === 1 && !form.job_position_id) {
      set("job_position_id", matchingSector.positions[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedJob]);

  const requiredForSelectedJob = useMemo(() => {
    if (!selectedJob) return new Set<string>();
    const country = countries.find((c) => c.name.toLowerCase() === selectedJob.country.toLowerCase());
    if (!country) return new Set<string>();
    return new Set(documentRequirements.filter((r) => r.country_id === country.id).map((r) => r.document_type));
  }, [selectedJob, countries, documentRequirements]);

  // The full world list, plus any of Vertex's own admin-managed
  // source-market countries that aren't already on it (a spelling variant,
  // or an admin-added country) — so an operational Country row is always
  // selectable here even if it doesn't match the static list exactly.
  const currentLocationOptions = useMemo(() => {
    const worldNames = new Set(WORLD_COUNTRIES.map((n) => n.toLowerCase()));
    const extra = locationCountries.filter((c) => !worldNames.has(c.name.toLowerCase()));
    return [...WORLD_COUNTRY_OPTIONS, ...extra.map((c) => ({ value: c.name, label: c.name }))];
  }, [locationCountries]);

  const set = <K extends keyof typeof emptyForm>(key: K, value: (typeof emptyForm)[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const toggleDocument = (type: string) =>
    setForm((f) => ({
      ...f,
      documents_available: f.documents_available.includes(type)
        ? f.documents_available.filter((t) => t !== type)
        : [...f.documents_available, type],
    }));

  // Passport and passport-size photo are the two documents the business
  // named as mandatory (2026-08-06) — both already is_universal: true, so
  // they're always in documentChecklist regardless of the selected job;
  // this just also requires a real attached file, not just the checkbox,
  // before Submit unlocks (same missingRequiredDocs gate
  // PartnerCandidateForm.tsx already uses for its own required set).
  const REQUIRED_UPLOAD_TYPES = ["passport", "passport_photo"];
  const missingRequiredDocs = includePersonalInfo
    ? REQUIRED_UPLOAD_TYPES.filter((type) => !(documentFiles[type] instanceof File))
    : [];

  // Uploads everything collected in Section 3 — fired once the main
  // submission above has already succeeded and returned a candidate id.
  // Failure-tolerant (PartnerCandidateForm.tsx's own pattern): one flaky
  // upload doesn't undo an otherwise-successful application submission,
  // it's just surfaced as a count of documents that need re-attaching
  // from the dashboard afterward.
  const uploadCollectedDocuments = async (newCandidateId: string, uploadToken: string | undefined) => {
    const targetId = signedInCandidate ? undefined : newCandidateId;
    const headers: Record<string, string> = {};
    if (uploadToken) headers["X-Upload-Token"] = uploadToken;

    const jobs: { type: string; file: File; label?: string }[] = [
      ...Object.entries(documentFiles)
        .filter((entry): entry is [string, File] => entry[1] instanceof File)
        .map(([type, file]) => ({ type, file })),
      ...otherDocuments
        .filter((d): d is { label: string; file: File } => d.file instanceof File && !!d.label.trim())
        .map((d) => ({ type: "other", file: d.file, label: d.label })),
    ];

    let failures = 0;
    for (const { type, file, label } of jobs) {
      try {
        const fd = new FormData();
        fd.append("file", file);
        if (label) fd.append("label", label);
        const url = targetId ? `/api/upload?type=${type}&candidate_id=${targetId}` : `/api/upload?type=${type}`;
        const res = await fetch(url, { method: "POST", body: fd, headers });
        if (!res.ok) failures++;
      } catch {
        failures++;
      }
    }
    return failures;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus("loading");
    setMessage("");
    setFieldErrors({});

    // A public self-submission now always goes to HR for review once the
    // CRM is active (2026-07-31) — the old per-submission "no recruiter
    // for this country" fallback is gone along with recruiter assignment
    // itself; only the admin-wide Public Form Intake Mode setting decides
    // whether this reaches the CRM at all.
    const useEmailIntake = useEmailIntakeIfConfigured && intakeMode === "email";
    const res = await fetch(useEmailIntake ? "/api/public-intake/application" : "/api/applications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...form,
        candidate_id: candidateId,
        referral_code: referralCode,
        job_position_id: form.job_position_id || undefined,
        preferred_contact_channel: form.preferred_contact_channel || undefined,
        holds_schengen_visa: form.holds_schengen_visa ?? undefined,
        prior_eu_visa_applied: form.prior_eu_visa_applied ?? undefined,
        prior_visa_refusals: form.prior_visa_refusals ?? undefined,
      }),
    });

    const data = await res.json();
    if (res.ok) {
      let uploadFailures = 0;
      if (!useEmailIntake && data.candidate_id) {
        uploadFailures = await uploadCollectedDocuments(data.candidate_id, data.upload_token);
      }
      setStatus("success");
      const baseMessage = includePersonalInfo
        ? "Thank you. We'll review your information and email you within 24 hours if you clear the screening stage."
        : "Application submitted successfully. We'll review it and confirm your programme within 48 hours.";
      setMessage(
        uploadFailures > 0
          ? `${baseMessage} ${uploadFailures} document(s) failed to upload — you can re-attach them from your dashboard once you've created your account.`
          : baseMessage
      );
      onSubmitted();
    } else {
      setStatus("error");
      setMessage(data.error === "Validation failed" ? "Please check the highlighted fields." : (data.error || "Failed to submit application."));
      setFieldErrors(data.details ?? {});
    }
  };

  const err = (field: string) => fieldErrors[field]?.[0];

  if (status === "success") {
    return (
      <div className="bg-green-50 border border-green-200 rounded-lg p-6 text-center">
        <h2 className="font-bold text-green-800 text-lg mb-1">Submitted!</h2>
        <p className="text-green-700 text-sm">{message}</p>
      </div>
    );
  }

  const labelCls = "block text-sm font-medium text-slate-700 mb-1.5";
  const errCls = "text-xs text-red-600 mt-1";

  return (
    <form method="post" onSubmit={handleSubmit} className={compact ? "space-y-4" : "space-y-6"}>
      <section>
        <h2 className="font-bold text-slate-800 mb-1">Section 1 — Programme Selection</h2>
        <p className="text-xs text-slate-500 mb-4">
          Choose the sector you're applying under, then the specific opportunity, then the exact position — the
          document checklist below adjusts to match its destination country.
        </p>
        <div className="grid sm:grid-cols-3 gap-4">
          <div>
            <label htmlFor="sector" className={labelCls}>Sector <span className="text-red-500">*</span></label>
            <SearchableSelect
              id="sector"
              value={sector}
              onChange={(value) => {
                setSector(value);
                // A programme from the previous sector is no longer valid
                // once the sector changes — clear it. Either way, whatever
                // position was picked under the old sector is no longer
                // valid either, so always clear that too.
                if (form.job_id && !jobs.find((j) => j.id === form.job_id)?.sectors.some((s) => s.sector === value)) {
                  set("job_id", "");
                }
                set("job_position_id", "");
              }}
              required
              placeholder="Select a sector…"
              options={sectorOptions.map((s) => ({ value: s, label: s }))}
            />
          </div>
          <div>
            <label htmlFor="job_id" className={labelCls}>Opportunity <span className="text-red-500">*</span></label>
            <SearchableSelect
              id="job_id"
              value={form.job_id}
              onChange={(value) => {
                set("job_id", value);
                set("job_position_id", "");
              }}
              required
              disabled={!sector}
              placeholder={sector ? "Select an opportunity…" : "Select a sector first…"}
              options={jobsInSector.map((j) => ({ value: j.id, label: `${j.title} — ${j.city}, ${j.country}` }))}
            />
            {err("job_id") && <p className={errCls}>{err("job_id")}</p>}
          </div>
          <div>
            <label htmlFor="job_position_id" className={labelCls}>Position <span className="text-red-500">*</span></label>
            <SearchableSelect
              id="job_position_id"
              value={form.job_position_id}
              onChange={(value) => set("job_position_id", value)}
              required
              disabled={!form.job_id}
              placeholder={form.job_id ? "Select a position…" : "Select an opportunity first…"}
              options={positionOptions.map((p) => ({
                value: p.id,
                label: p.city ? `${p.title} — ${p.city}` : p.title,
              }))}
            />
            {err("job_position_id") && <p className={errCls}>{err("job_position_id")}</p>}
          </div>
        </div>

        <div className="mt-4">
          <label htmlFor="earliest_travel_date" className={labelCls}>Earliest Possible Travel Date <span className="text-red-500">*</span></label>
          <input
            id="earliest_travel_date"
            type="date"
            value={form.earliest_travel_date}
            onChange={(e) => set("earliest_travel_date", e.target.value)}
            required
            className="input-field max-w-xs"
          />
          {err("earliest_travel_date") && <p className={errCls}>{err("earliest_travel_date")}</p>}
        </div>

        <div className="mt-4">
          <label className={labelCls}>Have you previously applied for an EU visa?</label>
          <div className="flex items-center gap-4 mt-1">
            <label className="flex items-center gap-1.5 text-sm text-slate-700">
              <input
                type="radio"
                name="prior_eu_visa_applied"
                checked={form.prior_eu_visa_applied === true}
                onChange={() => set("prior_eu_visa_applied", true)}
                className="w-4 h-4"
              />
              Yes
            </label>
            <label className="flex items-center gap-1.5 text-sm text-slate-700">
              <input
                type="radio"
                name="prior_eu_visa_applied"
                checked={form.prior_eu_visa_applied === false}
                onChange={() => set("prior_eu_visa_applied", false)}
                className="w-4 h-4"
              />
              No
            </label>
          </div>
          {form.prior_eu_visa_applied === true && (
            <input
              value={form.prior_eu_visa_applied_details}
              onChange={(e) => set("prior_eu_visa_applied_details", e.target.value)}
              placeholder="Where and when? e.g. Poland, 2024"
              className="input-field mt-2"
            />
          )}
        </div>
      </section>

      {includePersonalInfo && (
        <section className="border-t border-slate-200 pt-5">
          <h2 className="font-bold text-slate-800 mb-4">Section 2 — Candidate Personal Information</h2>
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="full_name" className={labelCls}>Full Name (as per passport) <span className="text-red-500">*</span></label>
              <input id="full_name" value={form.full_name} onChange={(e) => set("full_name", e.target.value)} required className="input-field" />
              {err("full_name") && <p className={errCls}>{err("full_name")}</p>}
            </div>
            <div>
              <label htmlFor="date_of_birth" className={labelCls}>Date of Birth <span className="text-red-500">*</span></label>
              <input id="date_of_birth" type="date" value={form.date_of_birth} onChange={(e) => set("date_of_birth", e.target.value)} required className="input-field" />
              {err("date_of_birth") && <p className={errCls}>{err("date_of_birth")}</p>}
            </div>
            <div>
              <label htmlFor="gender" className={labelCls}>Gender <span className="text-red-500">*</span></label>
              <SearchableSelect id="gender" value={form.gender} onChange={(value) => set("gender", value)} required placeholder="Select…" options={GENDER_OPTIONS} />
              {err("gender") && <p className={errCls}>{err("gender")}</p>}
            </div>
            <div>
              <label htmlFor="nationality" className={labelCls}>Nationality <span className="text-red-500">*</span></label>
              <SearchableSelect
                id="nationality"
                value={form.nationality}
                onChange={(value) => set("nationality", value)}
                required
                placeholder="Select a country…"
                options={WORLD_COUNTRY_OPTIONS}
              />
              {err("nationality") && <p className={errCls}>{err("nationality")}</p>}
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
              <label htmlFor="passport_number" className={labelCls}>Passport Number <span className="text-red-500">*</span></label>
              <input id="passport_number" value={form.passport_number} onChange={(e) => set("passport_number", e.target.value)} required className="input-field" />
              {err("passport_number") && <p className={errCls}>{err("passport_number")}</p>}
            </div>
            <div>
              <label htmlFor="passport_expiry" className={labelCls}>Passport Expiry Date <span className="text-slate-400 font-normal">(min. 6 months validity)</span> <span className="text-red-500">*</span></label>
              <input id="passport_expiry" type="date" value={form.passport_expiry} onChange={(e) => set("passport_expiry", e.target.value)} required className="input-field" />
              {err("passport_expiry") && <p className={errCls}>{err("passport_expiry")}</p>}
            </div>
            <div>
              <label className={labelCls}>Current Occupation</label>
              <input value={form.current_occupation} onChange={(e) => set("current_occupation", e.target.value)} className="input-field" />
            </div>
            <div>
              <label className={labelCls}>Highest Education / Qualification</label>
              <input value={form.highest_education} onChange={(e) => set("highest_education", e.target.value)} className="input-field" />
            </div>
            <div>
              <label htmlFor="phone" className={labelCls}>Phone Number (with country code) <span className="text-red-500">*</span></label>
              <input id="phone" value={form.phone} onChange={(e) => set("phone", e.target.value)} required className="input-field" />
              {err("phone") && <p className={errCls}>{err("phone")}</p>}
            </div>
            <div>
              <label className={labelCls}>WhatsApp Number</label>
              <input value={form.whatsapp_number} onChange={(e) => set("whatsapp_number", e.target.value)} className="input-field" />
            </div>
            <div>
              <label htmlFor="email" className={labelCls}>Email Address <span className="text-red-500">*</span></label>
              <input id="email" type="email" value={form.email} onChange={(e) => set("email", e.target.value)} required className="input-field" />
              {err("email") && <p className={errCls}>{err("email")}</p>}
            </div>
            <div>
              <label className={labelCls}>Marital Status</label>
              <SearchableSelect value={form.marital_status} onChange={(value) => set("marital_status", value)} placeholder="Select…" options={MARITAL_STATUS_OPTIONS} />
            </div>
            <div className="sm:col-span-2">
              <label className={labelCls}>Complete Home Address</label>
              <input value={form.home_address} onChange={(e) => set("home_address", e.target.value)} className="input-field" />
            </div>
          </div>
        </section>
      )}

      <section className="border-t border-slate-200 pt-5">
        <h2 className="font-bold text-slate-800 mb-1">Section 3 — Document Checklist</h2>
        <p className="text-xs text-slate-500 mb-4">
          Tick the documents you can provide and attach the file — items marked with a programme name are only
          required for that programme, your manager will confirm your exact document set. Passport and a
          passport-size photo are required for every submission.
        </p>
        <div className="space-y-3">
          {documentChecklist.map((doc) => {
            const checked = form.documents_available.includes(doc.key);
            const file = documentFiles[doc.key];
            return (
              <div key={doc.key}>
                <label className="flex items-start gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => {
                      toggleDocument(doc.key);
                      if (checked) setDocumentFiles((f) => ({ ...f, [doc.key]: null }));
                    }}
                    className="w-4 h-4 mt-0.5"
                  />
                  <span>
                    {doc.label}
                    {doc.is_universal ? (
                      <span className="block text-xs text-emerald-700">Required for all submissions</span>
                    ) : (
                      requiredForSelectedJob.has(doc.key) && (
                        <span className="block text-xs text-emerald-700">Required for this programme</span>
                      )
                    )}
                  </span>
                </label>
                {checked && (
                  <div className="ml-6 mt-1.5">
                    <input
                      type="file"
                      accept="application/pdf,image/*"
                      data-testid={`cif-doc-${doc.key}-input`}
                      onChange={(e) => setDocumentFiles((f) => ({ ...f, [doc.key]: e.target.files?.[0] ?? null }))}
                      className="text-xs text-slate-500 file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:bg-slate-100 file:text-slate-700 file:text-xs"
                    />
                    {file && <span className="block text-[11px] text-emerald-700 mt-0.5">{file.name} ready to upload</span>}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="mt-5 pt-4 border-t border-slate-100">
          <h3 className="font-semibold text-slate-700 text-sm mb-1">Other Supporting Documents</h3>
          <p className="text-xs text-slate-500 mb-3">Anything else that supports your application — optional.</p>
          <div className="space-y-2">
            {otherDocuments.map((d, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  value={d.label}
                  onChange={(e) =>
                    setOtherDocuments((docs) => docs.map((doc, j) => (j === i ? { ...doc, label: e.target.value } : doc)))
                  }
                  placeholder="What is this document?"
                  className="input-field text-sm flex-1"
                />
                <input
                  type="file"
                  accept="application/pdf,image/*"
                  onChange={(e) =>
                    setOtherDocuments((docs) =>
                      docs.map((doc, j) => (j === i ? { ...doc, file: e.target.files?.[0] ?? null } : doc))
                    )
                  }
                  className="text-xs text-slate-500 file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:bg-slate-100 file:text-slate-700 file:text-xs max-w-[180px]"
                />
                <button
                  type="button"
                  onClick={() => setOtherDocuments((docs) => docs.filter((_, j) => j !== i))}
                  className="text-xs text-red-500 hover:underline"
                >
                  Remove
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => setOtherDocuments((docs) => [...docs, { label: "", file: null }])}
              className="text-xs font-semibold text-emerald-700 hover:underline"
            >
              + Add another document
            </button>
          </div>
        </div>
      </section>

      <section className="border-t border-slate-200 pt-5">
        <h2 className="font-bold text-slate-800 mb-3">Section 4 — Payment Plan Acknowledgement</h2>
        <ServiceFeeNotice variant="plain" />
        <div className="grid grid-cols-3 gap-2 text-center text-xs mb-4">
          <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
            <div className="font-bold text-emerald-700 mb-1">Stage 1 · 25%</div>
            <div className="text-slate-500">On engagement — documentation stage</div>
          </div>
          <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
            <div className="font-bold text-emerald-700 mb-1">Stage 2 · 25%</div>
            <div className="text-slate-500">After the work permit is issued</div>
          </div>
          <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
            <div className="font-bold text-emerald-700 mb-1">Stage 3 · 50%</div>
            <div className="text-slate-500">After the visa is granted</div>
          </div>
        </div>
        <p className="text-xs text-slate-500 mb-3">
          Air tickets and embassy fees are not included in any programme price and are payable separately.
          Accommodation is provided in every programme and may be deducted from salary by the employer.
        </p>
        <label className="flex items-start gap-2 text-sm text-slate-700 font-medium">
          <input
            type="checkbox"
            checked={form.payment_plan_acknowledged}
            onChange={(e) => set("payment_plan_acknowledged", e.target.checked)}
            required
            className="w-4 h-4 mt-0.5"
          />
          I understand the payment plan above. <span className="text-red-500">*</span>
        </label>
        {err("payment_plan_acknowledged") && <p className={errCls}>{err("payment_plan_acknowledged")}</p>}
      </section>

      <section className="border-t border-slate-200 pt-5">
        <h2 className="font-bold text-slate-800 mb-4">Section 5 — Visa & Travel Readiness</h2>
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="current_location_country_name" className={labelCls}>Current Location (country) <span className="text-red-500">*</span></label>
            <SearchableSelect
              id="current_location_country_name"
              value={form.current_location_country_name}
              onChange={(value) => set("current_location_country_name", value)}
              required
              placeholder="Select a country…"
              options={currentLocationOptions}
            />
            {err("current_location_country_name") && <p className={errCls}>{err("current_location_country_name")}</p>}
          </div>
          <div>
            <label className={labelCls}>Do you currently hold any Schengen / EU visa?</label>
            <div className="flex items-center gap-4 mt-1">
              <label className="flex items-center gap-1.5 text-sm text-slate-700">
                <input
                  type="radio"
                  name="holds_schengen_visa"
                  checked={form.holds_schengen_visa === true}
                  onChange={() => set("holds_schengen_visa", true)}
                  className="w-4 h-4"
                />
                Yes
              </label>
              <label className="flex items-center gap-1.5 text-sm text-slate-700">
                <input
                  type="radio"
                  name="holds_schengen_visa"
                  checked={form.holds_schengen_visa === false}
                  onChange={() => set("holds_schengen_visa", false)}
                  className="w-4 h-4"
                />
                No
              </label>
            </div>
            {form.holds_schengen_visa === true && (
              <input
                value={form.holds_schengen_visa_details}
                onChange={(e) => set("holds_schengen_visa_details", e.target.value)}
                placeholder="Which visa, and validity"
                className="input-field mt-2"
              />
            )}
          </div>
          <div>
            <label className={labelCls}>Any prior visa refusals?</label>
            <div className="flex items-center gap-4 mt-1">
              <label className="flex items-center gap-1.5 text-sm text-slate-700">
                <input
                  type="radio"
                  name="prior_visa_refusals"
                  checked={form.prior_visa_refusals === true}
                  onChange={() => set("prior_visa_refusals", true)}
                  className="w-4 h-4"
                />
                Yes
              </label>
              <label className="flex items-center gap-1.5 text-sm text-slate-700">
                <input
                  type="radio"
                  name="prior_visa_refusals"
                  checked={form.prior_visa_refusals === false}
                  onChange={() => set("prior_visa_refusals", false)}
                  className="w-4 h-4"
                />
                No
              </label>
            </div>
            {form.prior_visa_refusals === true && (
              <input
                value={form.prior_visa_refusals_details}
                onChange={(e) => set("prior_visa_refusals_details", e.target.value)}
                placeholder="Country & year"
                className="input-field mt-2"
              />
            )}
          </div>
          <div>
            <label htmlFor="preferred_contact_channel" className={labelCls}>Preferred contact channel <span className="text-red-500">*</span></label>
            <SearchableSelect
              id="preferred_contact_channel"
              value={form.preferred_contact_channel}
              onChange={(value) => set("preferred_contact_channel", value as typeof form.preferred_contact_channel)}
              required
              options={[
                { value: "email", label: "Email" },
                { value: "whatsapp", label: "WhatsApp" },
                { value: "phone", label: "Phone" },
              ]}
            />
            {err("preferred_contact_channel") && <p className={errCls}>{err("preferred_contact_channel")}</p>}
          </div>
        </div>
        <div className="flex flex-col sm:flex-row gap-4 mt-4">
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={form.available_for_embassy_appointment}
              onChange={(e) => set("available_for_embassy_appointment", e.target.checked)}
              className="w-4 h-4"
            />
            Available for an embassy appointment?
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={form.willing_to_start_within_30_days}
              onChange={(e) => set("willing_to_start_within_30_days", e.target.checked)}
              className="w-4 h-4"
            />
            Willing to start within 30 days of visa issue?
          </label>
        </div>
      </section>

      <div>
        <label className={labelCls}>
          Anything else you'd like to tell us? <span className="text-slate-400 font-normal">(optional)</span>
        </label>
        <textarea
          value={form.cover_letter}
          onChange={(e) => set("cover_letter", e.target.value)}
          rows={3}
          className="input-field resize-none"
        />
      </div>

      {includePersonalInfo && (
        <section className="border-t border-slate-200 pt-5">
          <h2 className="font-bold text-slate-800 mb-2">Candidate Declaration</h2>
          <p className="text-xs text-slate-500 mb-3">
            I confirm that the information provided in this form is true and complete to the best of my knowledge,
            and I understand that prices and conditions may vary depending on the type of vacancy and country, and
            that air tickets and embassy fees are not included in the programme price.
          </p>
          <label className="flex items-start gap-2 text-sm text-slate-700 font-medium">
            <input
              type="checkbox"
              checked={form.consent_given}
              onChange={(e) => set("consent_given", e.target.checked)}
              required
              className="w-4 h-4 mt-0.5"
            />
            I confirm the above. <span className="text-red-500">*</span>
          </label>
          {err("consent_given") && <p className={errCls}>{err("consent_given")}</p>}
        </section>
      )}

      {message && status === "error" && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-red-700 text-sm">{message}</div>
      )}

      {missingRequiredDocs.length > 0 && (
        <p className="text-xs text-red-600">
          Attach a file for every required document before submitting:{" "}
          {missingRequiredDocs.map((key) => documentTypes.find((t) => t.key === key)?.label ?? key).join(", ")}.
        </p>
      )}

      <button
        type="submit"
        disabled={status === "loading" || missingRequiredDocs.length > 0}
        className="btn-gold w-full text-base py-3.5 disabled:opacity-60"
      >
        {status === "loading" ? "Submitting…" : "Submit Application"}
      </button>
    </form>
  );
}
