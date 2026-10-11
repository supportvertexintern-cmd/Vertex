"use client";

import { useEffect, useMemo, useState } from "react";
import SearchableSelect from "@/components/SearchableSelect";
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

interface JobOption {
  id: string;
  title: string;
  country: string;
  city: string;
}

interface Props {
  onSubmitted: () => void;
  // Staff-mode (CRM Comments item 10, 2026-08-10) — when set, this
  // submission is entered by HR/Operations on behalf of the given
  // partner (e.g. onboarding a pre-CRM candidate from a paper form)
  // rather than by the partner themselves. The partner picker itself
  // lives in the calling page, not this form.
  partnerId?: string;
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
export default function PartnerCandidateForm({ onSubmitted, partnerId }: Props) {
  const [countries, setCountries] = useState<Option[]>([]);
  const [jobs, setJobs] = useState<JobOption[]>([]);
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
    fetch("/api/jobs?limit=50")
      .then((r) => r.json())
      .then((res) => setJobs(res.jobs ?? []))
      .catch(() => {});
  }, []);

  // Section 4's checklist — admin-managed (DocumentRequirementType) rather
  // than hardcoded, same list as the Candidate Information Form's since
  // Vertex's document requirements don't differ by intake path.
  const documentChecklist = useMemo(
    () => documentTypes.filter((t) => !(NON_PROGRAMME_TYPE_KEYS as readonly string[]).includes(t.key)),
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
  const missingRequiredDocs = requiredTypesForSelectedJob.filter((key) => !(documentFiles[key] instanceof File));

  const set = <K extends keyof typeof emptyForm>(key: K, value: (typeof emptyForm)[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const toggleDocument = (type: string) =>
    setForm((f) => ({
      ...f,
      documents_available: f.documents_available.includes(type)
        ? f.documents_available.filter((t) => t !== type)
        : [...f.documents_available, type],
    }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus("loading");
    setMessage("");
    setFieldErrors({});

    const res = await fetch("/api/partner/candidates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...form,
        partner_id: partnerId || undefined,
        prior_eu_visa_applied: form.prior_eu_visa_applied ?? undefined,
        holds_schengen_visa: form.holds_schengen_visa ?? undefined,
        prior_visa_refusals: form.prior_visa_refusals ?? undefined,
      }),
    });

    const data = await res.json();
    if (res.ok) {
      // Real document uploads, not just the self-reported checklist above —
      // the candidate now exists (data.data.candidateId), so attach
      // whichever files the partner actually picked in Section 4.
      const candidateId = data.data.candidateId as string;
      const filesToUpload = Object.entries(documentFiles).filter(
        (entry): entry is [string, File] => entry[1] !== null
      );
      let uploadFailures = 0;
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
          Select the specific opportunity the candidate is going for — the required document checklist below adjusts
          to match its destination country.
        </p>
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="job_id" className={labelCls}>Opportunity <span className="text-red-500">*</span></label>
            <SearchableSelect
              id="job_id"
              value={form.job_id}
              onChange={(value) => set("job_id", value)}
              required
              placeholder="Select an opportunity…"
              options={jobs.map((j) => ({ value: j.id, label: `${j.title} — ${j.city}, ${j.country}` }))}
            />
            {err("job_id") && <p className={errCls}>{err("job_id")}</p>}
          </div>
          <div>
            <label htmlFor="earliest_travel_date" className={labelCls}>Candidate's Earliest Possible Travel Date <span className="text-red-500">*</span></label>
            <input
              id="earliest_travel_date"
              type="date"
              value={form.earliest_travel_date}
              onChange={(e) => set("earliest_travel_date", e.target.value)}
              required
              className="input-field"
            />
            {err("earliest_travel_date") && <p className={errCls}>{err("earliest_travel_date")}</p>}
          </div>
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
          submission goes straight to Vertex's operations team for case creation, not through a separate document
          review step, so uploading the real files here (not just self-reporting) avoids a follow-up delay.
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
                      onChange={(e) => setDocumentFiles((f) => ({ ...f, [doc.key]: e.target.files?.[0] ?? null }))}
                      className="text-xs text-slate-500 file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:bg-slate-100 file:text-slate-700 file:text-xs"
                      data-testid={`upload-${doc.key}-input`}
                    />
                    {file && <span className="block text-[11px] text-emerald-700 mt-0.5">{file.name} ready to upload</span>}
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
            it's clear what it is.
          </p>
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
              onChange={(e) => setOtherDocumentFile(e.target.files?.[0] ?? null)}
              className="text-xs text-slate-500 file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:bg-slate-100 file:text-slate-700 file:text-xs"
            />
            {otherDocumentFile && <span className="block text-[11px] text-emerald-700 mt-0.5">{otherDocumentFile.name} ready to upload</span>}
          </div>
        </div>
      </section>

      <section className="border-t border-slate-200 pt-5">
        <h2 className="font-bold text-slate-800 mb-3">Section 5 — Payment Plan Acknowledgement</h2>
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
          We understand the payment plan above. <span className="text-red-500">*</span>
        </label>
        {err("payment_plan_acknowledged") && <p className={errCls}>{err("payment_plan_acknowledged")}</p>}
      </section>

      <section className="border-t border-slate-200 pt-5">
        <h2 className="font-bold text-slate-800 mb-4">Section 6 — Visa & Travel Readiness</h2>
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="current_location_country_name" className={labelCls}>Candidate's Current Location (country) <span className="text-red-500">*</span></label>
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

      <button
        type="submit"
        disabled={status === "loading" || (!!selectedJob && missingRequiredDocs.length > 0)}
        className="btn-gold w-full text-base py-3.5 disabled:opacity-60"
      >
        {status === "loading" ? "Submitting…" : "Submit Candidate"}
      </button>
    </form>
  );
}
