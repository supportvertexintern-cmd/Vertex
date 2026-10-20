"use client";

import { useEffect, useMemo, useState } from "react";
import SearchableSelect from "@/components/SearchableSelect";
import { isNonProgrammeTypeKey } from "@/lib/documentTypes";
import PaymentStagesPreview, { type PaymentStageOption } from "@/components/PaymentStagesPreview";
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
  service_fee_gbp: number | null;
  is_credit_service: boolean;
  payment_stages: PaymentStageOption[];
}

// A position flattened out of whichever Job it belongs to (2026-09-02,
// Country -> Sector -> Position). Unlike the public ApplicationForm.tsx,
// this form's job list mixes standard and partner-only Credit Service
// programmes for the same country/sector — isCreditService rides along so
// the Position label can flag it (see positionOptions below), rather than
// silently merging two different pricing models into one indistinguishable
// list. jobId carries which Job to derive form.job_id from once a
// position is chosen.
interface FlatPositionOption extends JobPositionOption {
  jobId: string;
  isCreditService: boolean;
}

// Canonical sector order (2026-08-31) — same list ApplicationForm.tsx
// uses, matching the business's own Positions by Country & Sector
// reference sheet naming. Includes the partner-only Credit Service
// programmes too — /api/jobs?audience=partner is the one place they're
// ever visible, and they carry the same renamed categories as every
// other Job (e.g. Albania's Credit Service programme is Construction &
// Trades, Italy's is Agriculture).
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

interface UploadedDoc {
  id: string;
  name: string;
}

interface Props {
  onSubmitted: () => void;
  // Staff-mode (CRM Comments item 10, 2026-08-10) — when set, this
  // submission is entered by HR/Operations on behalf of the given
  // partner (e.g. onboarding a pre-CRM candidate from a paper form)
  // rather than by the partner themselves. The partner picker itself
  // lives in the calling page, not this form.
  partnerId?: string;
  // Resume an existing draft (2026-09-09) — when set, the form prefills
  // from GET /api/partner/candidates/:id instead of starting blank, and
  // "Submit Candidate" finalizes that draft rather than creating a new
  // submission.
  draftId?: string;
  // Fired after a successful Save-as-Draft (in addition to onSubmitted,
  // which only fires on final submission) — lets the calling page refresh
  // its list in the background without closing the modal.
  onDraftSaved?: () => void;
}

const emptyForm = {
  full_name: "",
  nationality: "",
  date_of_birth: "",
  gender: "",
  passport_number: "",
  passport_expiry: "",
  second_nationality: "",
  current_occupation: "",
  highest_education: "",
  home_address: "",
  marital_status: "",

  job_id: "",
  job_position_id: "",
  earliest_travel_date: "",
  prior_eu_visa_applied: null as boolean | null,
  prior_eu_visa_applied_details: "",

  documents_available: [] as string[],

  payment_plan_acknowledged: false,

  current_location_country_name: "",
  holds_schengen_visa: null as boolean | null,
  holds_schengen_visa_details: "",
  prior_visa_refusals: null as boolean | null,
  prior_visa_refusals_details: "",
  available_for_embassy_appointment: false,
  willing_to_start_within_30_days: false,
};

/**
 * The Agency Application Form's Sections 2-6 — Section 1 (Agency
 * Information) is already on file on the Partner record itself, not
 * per-submission. This candidate never enters Vertex's internal
 * recruiter/screening/verification funnel (the partner has already done
 * that), so — unlike ApplicationForm.tsx — there's no Candidate
 * Declaration/consent section here.
 */
export default function PartnerCandidateForm({ onSubmitted, partnerId, draftId: initialDraftId, onDraftSaved }: Props) {
  const [countries, setCountries] = useState<Option[]>([]);
  const [jobs, setJobs] = useState<JobOption[]>([]);
  const [draftId, setDraftId] = useState<string | undefined>(initialDraftId);
  const [draftSaving, setDraftSaving] = useState(false);
  const [draftJustSaved, setDraftJustSaved] = useState(false);
  const [prefillLoading, setPrefillLoading] = useState(!!initialDraftId);
  // Documents already attached to the draft — either uploaded immediately
  // in this session (once draftId exists, see uploadDocumentToDraft) or
  // fetched back when resuming an existing draft. Keyed by checklist type;
  // "other" documents (which can accumulate more than one) are tracked
  // separately below.
  const [uploadedDocs, setUploadedDocs] = useState<Record<string, UploadedDoc>>({});
  const [uploadingType, setUploadingType] = useState<string | null>(null);
  const [otherUploadedDocs, setOtherUploadedDocs] = useState<(UploadedDoc & { label: string })[]>([]);
  // Country and Sector are client-side filters only (2026-09-02, business
  // request to lead with Country rather than Sector) — neither is
  // submitted directly; job_id is derived once a Position is picked (see
  // positionOptions below).
  const [selectedCountry, setSelectedCountry] = useState("");
  const [sector, setSector] = useState("");
  const [documentTypes, setDocumentTypes] = useState<DocumentTypeOption[]>([]);
  const [documentRequirements, setDocumentRequirements] = useState<{ country_id: string; document_type: string }[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [documentFiles, setDocumentFiles] = useState<Record<string, File | null>>({});
  // "Other Supporting Documents" (2026-08-18) — anything not covered by
  // the fixed checklist below (a reference letter, extra certificate,
  // etc.), always uploaded as type "other" with this free-text label —
  // same pattern as SupportingDocumentUpload.tsx's post-approval version
  // of the same thing, just collected here since the candidate doesn't
  // exist yet at submission time to upload directly against.
  const [otherDocumentLabel, setOtherDocumentLabel] = useState("");
  const [otherDocumentFile, setOtherDocumentFile] = useState<File | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [message, setMessage] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  useEffect(() => {
    fetch("/api/apply/options")
      .then((r) => r.json())
      .then((res) => {
        setCountries(res.countries ?? []);
        setDocumentTypes(res.documentTypes ?? []);
        setDocumentRequirements(res.documentRequirements ?? []);
      })
      .catch(() => {});
    fetch("/api/jobs?limit=50&audience=partner")
      .then((r) => r.json())
      .then((res) => setJobs(res.jobs ?? []))
      .catch(() => {});
  }, []);

  // Resume an existing draft (2026-09-09) — prefill every field it already
  // has, and record which documents are already attached so Section 4
  // shows them as attached rather than empty inputs.
  useEffect(() => {
    if (!initialDraftId) return;
    fetch(`/api/partner/candidates/${initialDraftId}`)
      .then((r) => r.json())
      .then((res) => {
        const d = res.data;
        if (!d) return;
        setForm((f) => ({
          ...f,
          full_name: d.full_name ?? "",
          nationality: d.nationality ?? "",
          date_of_birth: d.date_of_birth ? String(d.date_of_birth).slice(0, 10) : "",
          gender: d.gender ?? "",
          passport_number: d.passport_number ?? "",
          passport_expiry: d.passport_expiry ? String(d.passport_expiry).slice(0, 10) : "",
          second_nationality: d.second_nationality ?? "",
          current_occupation: d.current_occupation ?? "",
          highest_education: d.highest_education ?? "",
          home_address: d.home_address ?? "",
          marital_status: d.marital_status ?? "",
          job_id: d.job_id ?? "",
          job_position_id: d.job_position_id ?? "",
          earliest_travel_date: d.earliest_travel_date ? String(d.earliest_travel_date).slice(0, 10) : "",
          prior_eu_visa_applied: d.prior_eu_visa_applied ?? null,
          prior_eu_visa_applied_details: d.prior_eu_visa_applied_details ?? "",
          documents_available: d.documents_available ?? [],
          payment_plan_acknowledged: d.payment_plan_acknowledged ?? false,
          current_location_country_name: d.current_location_country_name ?? "",
          holds_schengen_visa: d.holds_schengen_visa ?? null,
          holds_schengen_visa_details: d.holds_schengen_visa_details ?? "",
          prior_visa_refusals: d.prior_visa_refusals ?? null,
          prior_visa_refusals_details: d.prior_visa_refusals_details ?? "",
          available_for_embassy_appointment: d.available_for_embassy_appointment ?? false,
          willing_to_start_within_30_days: d.willing_to_start_within_30_days ?? false,
        }));
        const docs: { id: string; type: string; label: string | null }[] = d.documents ?? [];
        const checklistMap: Record<string, UploadedDoc> = {};
        const others: (UploadedDoc & { label: string })[] = [];
        for (const doc of docs) {
          if (doc.type === "other") others.push({ id: doc.id, name: doc.label || "Attached document", label: doc.label ?? "" });
          else checklistMap[doc.type] = { id: doc.id, name: doc.label || doc.type };
        }
        setUploadedDocs(checklistMap);
        setOtherUploadedDocs(others);
      })
      .catch(() => setMessage("Failed to load the saved draft."))
      .finally(() => setPrefillLoading(false));
     
  }, [initialDraftId]);

  // Section 2's Country/Sector are UI-only filter state derived from
  // job_id/job_position_id (see countryOptions/sectorOptions above) — once
  // a prefilled draft's job_id resolves against the now-loaded jobs list,
  // back-derive those filters so the dropdowns show the right value
  // instead of appearing blank.
  useEffect(() => {
    if (!form.job_id || jobs.length === 0) return;
    const job = jobs.find((j) => j.id === form.job_id);
    if (!job) return;
    setSelectedCountry((current) => current || (job.is_credit_service ? `${job.country}::credit` : job.country));
    const matchingSector = job.sectors.find((s) => s.positions.some((p) => p.id === form.job_position_id));
    if (matchingSector) setSector((current) => current || matchingSector.sector);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.job_id, jobs]);

  // Section 4's checklist — admin-managed (DocumentRequirementType) rather
  // than hardcoded, same list as the Candidate Information Form's since
  // Vertex's document requirements don't differ by intake path.
  const documentChecklist = useMemo(
    () => documentTypes.filter((t) => !isNonProgrammeTypeKey(t.key)),
    [documentTypes]
  );
  const requiredForByType = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const req of documentRequirements) {
      const country = countries.find((c) => c.id === req.country_id);
      if (!country) continue;
      (map[req.document_type] ??= []).push(country.name);
    }
    return map;
  }, [documentRequirements, countries]);

  // Required-type keys for the selected job's destination country — the
  // universal set plus whatever extras that specific country requires
  // (same source data as requiredForByType above, just resolved for one
  // country instead of labeled across all of them). This submission goes
  // straight to Vertex operations for case creation with no separate
  // document-review step, so a required type needs a real attached file,
  // not just a checked box, before Submit unlocks.
  const selectedJob = useMemo(() => jobs.find((j) => j.id === form.job_id), [jobs, form.job_id]);

  // Country/Programme list (2026-09-03) — a country with both a standard
  // and a partner-only Credit Service Job now gets two distinct entries
  // ("Italy" and "Italy (Credit Service)") so a partner picks which
  // programme they're going for right at the first step, rather than
  // discovering it only once positions are mixed together further down.
  // Sector names themselves stay untouched (business preference) — the
  // programme split happens here, at Country, instead. value encodes
  // both country + programme so the two never collide.
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
  // Jobs matching BOTH the chosen country AND programme, so Sector/Position
  // never mix a standard and a Credit Service Job together.
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
  // Position options — aggregated across every Job in the selected
  // country/programme whose sector matches the selected sector. jobsInCountry
  // is already scoped to one programme, so this can never mix a standard
  // and a Credit Service Job's positions.
  const positionOptions = useMemo<FlatPositionOption[]>(() => {
    if (!selectedCountry || !sector) return [];
    return jobsInCountry.flatMap((j) =>
      j.sectors
        .filter((s) => s.sector === sector)
        .flatMap((s) => s.positions.map((p) => ({ ...p, jobId: j.id, isCreditService: j.is_credit_service })))
    );
  }, [jobsInCountry, sector, selectedCountry]);

  // Auto-selects Position (and derives job_id from it) whenever the
  // current Country/Sector narrows to exactly one option — preserves the
  // old one-click behavior for the common single-position case.
  useEffect(() => {
    if (positionOptions.length === 1 && !form.job_position_id) {
      set("job_position_id", positionOptions[0].id);
      set("job_id", positionOptions[0].jobId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [positionOptions]);

  const requiredTypesForSelectedJob = useMemo(() => {
    if (!selectedJob) return [];
    const checklistKeys = new Set(documentChecklist.map((t) => t.key));
    const universal = documentTypes.filter((t) => t.is_universal && checklistKeys.has(t.key)).map((t) => t.key);
    const country = countries.find((c) => c.name.toLowerCase() === selectedJob.country.toLowerCase());
    const extras = country
      ? documentRequirements.filter((r) => r.country_id === country.id && checklistKeys.has(r.document_type)).map((r) => r.document_type)
      : [];
    return [...new Set([...universal, ...extras])];
  }, [selectedJob, documentTypes, countries, documentRequirements, documentChecklist]);
  const missingRequiredDocs = requiredTypesForSelectedJob.filter((key) => !(documentFiles[key] instanceof File) && !uploadedDocs[key]);

  const set = <K extends keyof typeof emptyForm>(key: K, value: (typeof emptyForm)[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const toggleDocument = (type: string) =>
    setForm((f) => ({
      ...f,
      documents_available: f.documents_available.includes(type)
        ? f.documents_available.filter((t) => t !== type)
        : [...f.documents_available, type],
    }));

  // Strips untouched fields down to undefined (so JSON.stringify omits
  // them entirely) rather than sending empty strings — the draft/update
  // schemas' min-length validators (e.g. full_name.min(2)) reject "" the
  // same as any other too-short value, so an untouched field must be
  // absent, not blank.
  const cleanForm = (f: typeof form) => {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(f)) {
      if (value === "" || value === null) continue;
      out[key] = value;
    }
    return out;
  };

  // Takes the target draft id explicitly rather than reading the `draftId`
  // state variable — saveDraft() needs to upload against a just-created
  // draft in the same call that creates it, before the setDraftId(...)
  // state update has actually landed (React state updates aren't
  // synchronous, so reading `draftId` right after calling setDraftId would
  // still see the old, empty value).
  const uploadDocumentToDraft = async (id: string, type: string, file: File, label?: string) => {
    setUploadingType(type);
    const uploadData = new FormData();
    uploadData.append("file", file);
    if (label) uploadData.append("label", label);
    try {
      const res = await fetch(`/api/upload?type=${type}&partner_candidate_id=${id}`, { method: "POST", body: uploadData });
      const data = await res.json();
      if (res.ok) {
        if (type === "other") {
          setOtherUploadedDocs((prev) => [...prev, { id: data.documentId, name: file.name, label: label ?? "" }]);
          setOtherDocumentFile(null);
          setOtherDocumentLabel("");
        } else {
          setUploadedDocs((prev) => ({ ...prev, [type]: { id: data.documentId, name: file.name } }));
          setDocumentFiles((f) => ({ ...f, [type]: null }));
        }
      } else {
        setStatus("error");
        setMessage(data.error || "Failed to upload document.");
      }
    } catch {
      setStatus("error");
      setMessage("Failed to upload document.");
    } finally {
      setUploadingType(null);
    }
  };

  const saveDraft = async () => {
    setDraftSaving(true);
    setDraftJustSaved(false);
    setMessage("");
    setFieldErrors({});
    const payload = { ...cleanForm(form), ...(partnerId ? { partner_id: partnerId } : {}) };
    const res = await fetch(draftId ? `/api/partner/candidates/${draftId}` : "/api/partner/candidates/draft", {
      method: draftId ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (res.ok) {
      // First save (no draftId yet): a partner may already have picked
      // files for checked checklist items before ever clicking Save as
      // Draft — those live only in local documentFiles/otherDocumentFile
      // state so far, since there was no id to upload them against until
      // just now. Flush them immediately against the newly-created draft,
      // or they'd silently vanish next time this component unmounts
      // (closing the modal, navigating away) despite the checkbox and
      // documents_available having been saved correctly.
      if (!draftId) {
        const newDraftId = data.data.id;
        setDraftId(newDraftId);
        const pending = Object.entries(documentFiles).filter((entry): entry is [string, File] => entry[1] !== null);
        for (const [type, file] of pending) {
          await uploadDocumentToDraft(newDraftId, type, file);
        }
        if (otherDocumentFile) {
          await uploadDocumentToDraft(newDraftId, "other", otherDocumentFile, otherDocumentLabel.trim() || undefined);
        }
      }
      setDraftSaving(false);
      setDraftJustSaved(true);
      onDraftSaved?.();
    } else {
      setDraftSaving(false);
      setStatus("error");
      setMessage(data.error?.message === "Validation failed" ? "Please check the highlighted fields." : (data.error?.message || "Failed to save draft."));
      setFieldErrors(data.error?.details ?? {});
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus("loading");
    setMessage("");
    setFieldErrors({});

    const body = {
      ...form,
      ...(partnerId ? { partner_id: partnerId } : {}),
      job_position_id: form.job_position_id || undefined,
      prior_eu_visa_applied: form.prior_eu_visa_applied ?? undefined,
      holds_schengen_visa: form.holds_schengen_visa ?? undefined,
      prior_visa_refusals: form.prior_visa_refusals ?? undefined,
    };
    // Finalizing an existing draft upgrades it in place (its already-
    // uploaded documents are reparented server-side) rather than creating
    // a second submission — a fresh, never-saved-as-draft submit still
    // goes straight to the original endpoint, unchanged.
    const res = await fetch(draftId ? `/api/partner/candidates/${draftId}/submit` : "/api/partner/candidates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const data = await res.json();
    if (res.ok) {
      // Real document uploads, not just the self-reported checklist above.
      // When this was a fresh (never-drafted) submission, the candidate
      // only exists now (data.data.candidateId) — upload whichever files
      // the partner picked in Section 4 against it. When it came from a
      // draft, every checklist/other file was already uploaded immediately
      // against the draft (see uploadDocumentToDraft) and the backend just
      // reparented them — there's nothing left to upload here.
      let uploadFailures = 0;
      if (!draftId) {
        const candidateId = data.data.candidateId as string;
        const filesToUpload = Object.entries(documentFiles).filter(
          (entry): entry is [string, File] => entry[1] !== null
        );
        for (const [type, file] of filesToUpload) {
          const uploadData = new FormData();
          uploadData.append("file", file);
          try {
            const uploadRes = await fetch(`/api/upload?type=${type}&candidate_id=${candidateId}`, {
              method: "POST",
              body: uploadData,
            });
            if (!uploadRes.ok) uploadFailures++;
          } catch {
            uploadFailures++;
          }
        }
        if (otherDocumentFile && otherDocumentLabel.trim()) {
          const uploadData = new FormData();
          uploadData.append("file", otherDocumentFile);
          uploadData.append("label", otherDocumentLabel.trim());
          try {
            const uploadRes = await fetch(`/api/upload?type=other&candidate_id=${candidateId}`, {
              method: "POST",
              body: uploadData,
            });
            if (!uploadRes.ok) uploadFailures++;
          } catch {
            uploadFailures++;
          }
        }
      }

      setStatus("success");
      setMessage(
        uploadFailures > 0
          ? `Submitted, but ${uploadFailures} document(s) failed to upload — Vertex will follow up for those.`
          : "Submitted. Vertex will review it and confirm the programme/offer within 48 hours."
      );
      onSubmitted();
    } else {
      setStatus("error");
      setMessage(data.error?.message === "Validation failed" ? "Please check the highlighted fields." : (data.error?.message || "Failed to submit candidate."));
      setFieldErrors(data.error?.details ?? {});
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

  if (prefillLoading) {
    return <p className="text-slate-500 text-sm py-8 text-center">Loading your draft…</p>;
  }

  const labelCls = "block text-sm font-medium text-slate-700 mb-1.5";
  const errCls = "text-xs text-red-600 mt-1";

  return (
    <form method="post" onSubmit={handleSubmit} className="space-y-4">
      <section>
        <h2 className="font-bold text-slate-800 mb-4">Section 3 — Candidate Personal Information</h2>
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
            <label className={labelCls}>Marital Status</label>
            <SearchableSelect
              value={form.marital_status}
              onChange={(value) => set("marital_status", value)}
              placeholder="Select…"
              options={MARITAL_STATUS_OPTIONS}
              className="input-field"
            />
          </div>
          <div className="sm:col-span-2">
            <label className={labelCls}>Complete Home Address</label>
            <input value={form.home_address} onChange={(e) => set("home_address", e.target.value)} className="input-field" />
          </div>
        </div>
      </section>

      <section className="border-t border-slate-200 pt-5">
        <h2 className="font-bold text-slate-800 mb-1">Section 2 — Programme Selection</h2>
        <p className="text-xs text-slate-500 mb-4">
          Choose the country, then the sector, then the exact position the candidate is going for — the required
          document checklist below adjusts to match its destination country.
        </p>
        <div className="grid sm:grid-cols-3 gap-4">
          <div>
            <label htmlFor="selected_country" className={labelCls}>Country <span className="text-red-500">*</span></label>
            <SearchableSelect
              id="selected_country"
              value={selectedCountry}
              onChange={(value) => {
                setSelectedCountry(value);
                setSector("");
                set("job_position_id", "");
                set("job_id", "");
              }}
              required
              placeholder="Select a country…"
              options={countryOptions.map((o) => ({ value: o.value, label: o.label }))}
            />
          </div>
          <div>
            <label htmlFor="sector" className={labelCls}>Sector <span className="text-red-500">*</span></label>
            <SearchableSelect
              id="sector"
              value={sector}
              onChange={(value) => {
                setSector(value);
                set("job_position_id", "");
                set("job_id", "");
              }}
              required
              disabled={!selectedCountry}
              placeholder={selectedCountry ? "Select a sector…" : "Select a country first…"}
              options={sectorOptions.map((s) => ({ value: s, label: s }))}
            />
          </div>
          <div>
            <label htmlFor="job_position_id" className={labelCls}>Position <span className="text-red-500">*</span></label>
            <SearchableSelect
              id="job_position_id"
              value={form.job_position_id}
              onChange={(value) => {
                const pos = positionOptions.find((p) => p.id === value);
                set("job_position_id", value);
                set("job_id", pos?.jobId ?? "");
              }}
              required
              disabled={!sector}
              placeholder={sector ? "Select a position…" : "Select a sector first…"}
              options={positionOptions.map((p) => ({
                value: p.id,
                label: p.city ? `${p.title} — ${p.city}` : p.title,
              }))}
            />
            {err("job_position_id") && <p className={errCls}>{err("job_position_id")}</p>}
          </div>
        </div>

        <div className="mt-4">
          <label htmlFor="earliest_travel_date" className={labelCls}>Candidate&apos;s Earliest Possible Travel Date <span className="text-red-500">*</span></label>
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
          <label className={labelCls}>Has the candidate previously applied for an EU visa?</label>
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

      <section className="border-t border-slate-200 pt-5">
        <h2 className="font-bold text-slate-800 mb-1">Section 4 — Document Checklist</h2>
        <p className="text-xs text-slate-500 mb-4">
          Tick the documents the candidate can provide, and attach the actual file where you have it on hand — this
          submission goes straight to Vertex&apos;s operations team for case creation, not through a separate document
          review step, so uploading the real files here (not just self-reporting) avoids a follow-up delay.
        </p>
        <div className="space-y-3">
          {documentChecklist.map((doc) => {
            const checked = form.documents_available.includes(doc.key);
            const file = documentFiles[doc.key];
            const uploaded = uploadedDocs[doc.key];
            const isUploading = uploadingType === doc.key;
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
                    data-testid={`partner-doc-checkbox-${doc.key}`}
                  />
                  <span>
                    {doc.label}
                    {doc.is_universal ? (
                      <span className="block text-xs text-emerald-700">Required for all submissions</span>
                    ) : (
                      requiredForByType[doc.key]?.length > 0 && (
                        <span className="block text-xs text-emerald-700">Required for: {requiredForByType[doc.key].join(" · ")}</span>
                      )
                    )}
                  </span>
                </label>
                {checked && (
                  <div className="ml-6 mt-1.5">
                    <input
                      type="file"
                      accept="application/pdf,image/*"
                      disabled={isUploading}
                      onChange={(e) => {
                        const picked = e.target.files?.[0] ?? null;
                        if (!picked) return;
                        if (draftId) uploadDocumentToDraft(draftId, doc.key, picked);
                        else setDocumentFiles((f) => ({ ...f, [doc.key]: picked }));
                      }}
                      className="text-xs text-slate-500 file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:bg-slate-100 file:text-slate-700 file:text-xs"
                      data-testid={`upload-${doc.key}-input`}
                    />
                    {isUploading && <span className="block text-[11px] text-slate-500 mt-0.5">Uploading…</span>}
                    {!isUploading && uploaded && (
                      <span className="block text-[11px] text-emerald-700 mt-0.5">{uploaded.name} attached — choose a file again to replace it</span>
                    )}
                    {!isUploading && !uploaded && file && <span className="block text-[11px] text-emerald-700 mt-0.5">{file.name} ready to upload</span>}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="mt-5 pt-4 border-t border-slate-100">
          <div className="text-sm font-semibold text-slate-700 mb-1">Other Supporting Documents</div>
          <p className="text-xs text-slate-500 mb-3">
            Anything not covered by the list above — a reference letter, extra certificate, etc. Give it a label so
            it&apos;s clear what it is.
          </p>
          {otherUploadedDocs.length > 0 && (
            <ul className="mb-2 space-y-0.5">
              {otherUploadedDocs.map((doc) => (
                <li key={doc.id} className="text-[11px] text-emerald-700">
                  {doc.label ? `${doc.label} — ` : ""}
                  {doc.name} attached
                </li>
              ))}
            </ul>
          )}
          <div className="flex items-center gap-2 flex-wrap">
            <input
              value={otherDocumentLabel}
              onChange={(e) => setOtherDocumentLabel(e.target.value)}
              placeholder="What is this document? (e.g. Employer reference letter)"
              className="input-field text-sm flex-1 min-w-[240px]"
            />
            <input
              type="file"
              accept="application/pdf,image/*"
              disabled={uploadingType === "other"}
              onChange={(e) => {
                const picked = e.target.files?.[0] ?? null;
                if (!picked) return;
                if (draftId) uploadDocumentToDraft(draftId, "other", picked, otherDocumentLabel.trim() || undefined);
                else setOtherDocumentFile(picked);
              }}
              className="text-xs text-slate-500 file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:bg-slate-100 file:text-slate-700 file:text-xs"
            />
            {uploadingType === "other" && <span className="block text-[11px] text-slate-500 mt-0.5">Uploading…</span>}
            {otherDocumentFile && <span className="block text-[11px] text-emerald-700 mt-0.5">{otherDocumentFile.name} ready to upload</span>}
          </div>
        </div>
      </section>

      <section className="border-t border-slate-200 pt-5">
        <h2 className="font-bold text-slate-800 mb-3">Section 5 — Payment Plan Acknowledgement</h2>
        {selectedJob?.service_fee_gbp != null && selectedJob.payment_stages.length > 0 && (
          <>
            <PaymentStagesPreview totalGbp={selectedJob.service_fee_gbp} stages={selectedJob.payment_stages} className="mb-4" />
            <p className="text-xs text-slate-500 mb-3">
              Total {selectedJob.is_credit_service ? "Credit Service Fee" : "Service Fee"}: £{selectedJob.service_fee_gbp.toLocaleString()}.{" "}
              {selectedJob.is_credit_service
                ? "International airfare is not included unless a different arrangement is confirmed in writing; the consular fee is per embassy requirements and payable separately where required."
                : "Air tickets and embassy fees are not included in any programme price and are payable separately. Accommodation is provided in every programme and may be deducted from salary by the employer."}
            </p>
          </>
        )}
        <label className="flex items-start gap-2 text-sm text-slate-700 font-medium">
          <input
            type="checkbox"
            checked={form.payment_plan_acknowledged}
            onChange={(e) => set("payment_plan_acknowledged", e.target.checked)}
            required
            className="w-4 h-4 mt-0.5"
          />
          We understand the payment plan above. <span className="text-red-500">*</span>
        </label>
        {err("payment_plan_acknowledged") && <p className={errCls}>{err("payment_plan_acknowledged")}</p>}
      </section>

      <section className="border-t border-slate-200 pt-5">
        <h2 className="font-bold text-slate-800 mb-4">Section 6 — Visa & Travel Readiness</h2>
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="current_location_country_name" className={labelCls}>Candidate&apos;s Current Location (country) <span className="text-red-500">*</span></label>
            <SearchableSelect
              id="current_location_country_name"
              value={form.current_location_country_name}
              onChange={(value) => set("current_location_country_name", value)}
              required
              options={WORLD_COUNTRY_OPTIONS}
            />
            {err("current_location_country_name") && <p className={errCls}>{err("current_location_country_name")}</p>}
          </div>
          <div>
            <label className={labelCls}>Does the candidate currently hold any Schengen / EU visa?</label>
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
            <label className={labelCls}>Previous visa refusals</label>
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
        </div>
        <div className="flex flex-col sm:flex-row gap-4 mt-4">
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={form.available_for_embassy_appointment}
              onChange={(e) => set("available_for_embassy_appointment", e.target.checked)}
              className="w-4 h-4"
            />
            Is the candidate available for an embassy appointment?
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

      {message && status === "error" && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-red-700 text-sm">{message}</div>
      )}

      {selectedJob && missingRequiredDocs.length > 0 && (
        <p className="text-xs text-amber-700">
          Attach a file for every required document before submitting: {missingRequiredDocs.map((key) => documentChecklist.find((t) => t.key === key)?.label ?? key).join(", ")}.
        </p>
      )}

      {draftJustSaved && !draftSaving && (
        <p className="text-xs text-emerald-700 text-center">Draft saved — you can come back and finish this later.</p>
      )}

      <div className="flex flex-col sm:flex-row gap-3">
        <button
          type="button"
          onClick={saveDraft}
          disabled={draftSaving || status === "loading"}
          className="btn-secondary flex-1 text-base py-3.5 disabled:opacity-60"
        >
          {draftSaving ? "Saving…" : "Save as Draft"}
        </button>
        <button
          type="submit"
          disabled={status === "loading" || (!!selectedJob && missingRequiredDocs.length > 0)}
          className="btn-gold flex-1 text-base py-3.5 disabled:opacity-60"
        >
          {status === "loading" ? "Submitting…" : "Submit Candidate"}
        </button>
      </div>
    </form>
  );
}
