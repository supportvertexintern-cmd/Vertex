"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import DocumentLink from "@/components/DocumentLink";
import DocumentVerifyControls from "@/components/DocumentVerifyControls";
import CandidateMessages from "@/components/CandidateMessages";
import CandidateStatusControls from "./CandidateStatusControls";
import HrCandidateStatusControls from "./HrCandidateStatusControls";
import CandidateDocumentUpload from "./CandidateDocumentUpload";
import SupportingDocumentUpload from "./SupportingDocumentUpload";
import ApplicationEditDetails from "./ApplicationEditDetails";
import SearchableSelect from "@/components/SearchableSelect";
import { MARITAL_STATUS_OPTIONS } from "@/lib/maritalStatus";
import { GENDER_OPTIONS } from "@/lib/gender";
import { formatCandidateLifecycleStatus } from "@/lib/candidateLifecycleStatus";
import { PencilSimple, CheckCircle, Trash } from "@phosphor-icons/react";

const STATUS_STYLES: Record<string, string> = {
  identified: "bg-slate-100 text-slate-700",
  screened: "bg-blue-100 text-blue-700",
  guided_to_apply: "bg-purple-100 text-purple-700",
  submitted: "bg-yellow-100 text-yellow-800",
  reported: "bg-orange-100 text-orange-700",
  verified: "bg-teal-100 text-teal-700",
  approved: "bg-emerald-100 text-emerald-800",
  rejected: "bg-red-100 text-red-700",
};

interface ApplicationRow {
  id: string;
  application_status: string;
  submitted_at: string;
  job_id: string | null;
  job_position_id: string | null;
  job: { title: string; country: string; city: string } | null;
  job_position: { title: string; city: string | null; job_sector: { sector: string } } | null;
  preferred_country_1: { id: string; name: string } | null;
  preferred_country_2: { id: string; name: string } | null;
  preferred_country_3: { id: string; name: string } | null;
  preferred_sector: { id: string; name: string } | null;
  earliest_travel_date: string | null;
  prior_eu_visa_applied: boolean | null;
  prior_eu_visa_applied_details: string | null;
  documents_available: string[];
  current_location_country: { id: string; name: string } | null;
  current_location_country_name: string | null;
  holds_schengen_visa: boolean | null;
  holds_schengen_visa_details: string | null;
  prior_visa_refusals: boolean | null;
  prior_visa_refusals_details: string | null;
  available_for_embassy_appointment: boolean;
  willing_to_start_within_30_days: boolean;
  preferred_contact_channel: string | null;
  payment_plan_acknowledged: boolean;
  case: { id: string } | null;
}

interface CandidateData {
  id: string;
  source: string;
  lifecycle_status: string;
  nationality: string | null;
  date_of_birth: string | null;
  passport_number: string | null;
  full_name: string | null;
  phone: string | null;
  email: string | null;
  desired_role: string | null;
  consent_given: boolean;
  consent_at: string | null;
  return_reason: string | null;
  screening_result: boolean | null;
  screening_evaluated_at: string | null;
  screening_failures?: string[];
  created_at: string;
  second_nationality: string | null;
  gender: string | null;
  passport_expiry: string | null;
  current_occupation: string | null;
  highest_education: string | null;
  home_address: string | null;
  whatsapp_number: string | null;
  marital_status: string | null;
  user: { full_name: string; email: string; phone: string | null } | null;
  recruiter: { id: string; full_name: string } | null;
  country: { id: string; name: string } | null;
  referral_agent: { id: string; full_name: string; referral_code: string } | null;
  referral_duplicate_flag: boolean;
  documents: { id: string; type: string; verification_status: string; uploaded_at: string; label: string | null }[];
  applications: ApplicationRow[];
  required_document_types: string[];
}

const EDITABLE_FIELDS = [
  "full_name", "nationality", "date_of_birth", "passport_number", "email", "desired_role", "second_nationality",
  "gender", "passport_expiry", "current_occupation", "highest_education", "home_address",
  "whatsapp_number", "marital_status",
] as const;

function Field({ label, value }: { label: string; value: string | number | null | undefined }) {
  return (
    <div>
      <div className="text-[11px] text-midnight-900/40 uppercase tracking-wider mb-0.5">{label}</div>
      <div className="text-sm text-midnight-900">{value || value === 0 ? value : "—"}</div>
    </div>
  );
}

// A Yes/No field standardized from free text (2026-08-06) — some also
// carry an optional detail ("where/when", "country & year"), still shown
// when present rather than discarded.
function yesNoWithDetail(value: boolean | null | undefined, detail?: string | null): string | undefined {
  if (value === null || value === undefined) return undefined;
  const base = value ? "Yes" : "No";
  return detail ? `${base} — ${detail}` : base;
}

interface Props {
  candidateId: string;
  backHref: string;
  canVerify?: boolean;
  canApprove?: boolean;
  // Document verify/reject controls (formerly only on the now-retired
  // Applications pages) — this is the Country Supervisor's own step,
  // done before forwarding a candidate to In-House for approval. The API
  // (/api/documents/[id]/verify) already independently enforces
  // country_supervisor/inhouse_supervisor/director/admin, so this prop
  // is just which portals choose to surface the affordance.
  canVerifyDocuments?: boolean;
  /**
   * HR's own status widget (2026-07-31, HR-owned self-submission routing)
   * replaces CandidateStatusControls entirely — HR's skip-ahead actions
   * (identified→screened, later submitted→approved) don't fit that
   * component's sequential-advance model. Only ever true from HR's own
   * "Self Applications" pages.
   */
  hrMode?: boolean;
}

/**
 * Full Candidate Information Form submission — personal details (Section 2)
 * plus the most recent Application's Section 1/3/4/5 answers — with
 * lifecycle/edit/upload actions, replacing the old inline-dropdown editing
 * pattern in CandidateList. Shared across staff portals the same way
 * CaseDetail is; canVerify/canApprove gate which lifecycle actions render.
 */
export default function CandidateDetail({ candidateId, backHref, canVerify = false, canApprove = false, canVerifyDocuments = false, hrMode = false }: Props) {
  const router = useRouter();
  const [data, setData] = useState<CandidateData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [docTypeLabels, setDocTypeLabels] = useState<Record<string, string>>({});
  const [canDelete, setCanDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [form, setForm] = useState<Record<(typeof EDITABLE_FIELDS)[number], string>>({
    full_name: "", nationality: "",
    date_of_birth: "", passport_number: "", email: "", desired_role: "", second_nationality: "",
    gender: "", passport_expiry: "", current_occupation: "", highest_education: "", home_address: "",
    whatsapp_number: "", marital_status: "",
  });

  useEffect(() => {
    fetch("/api/admin/document-types")
      .then((r) => r.json())
      .then((res) => setDocTypeLabels(Object.fromEntries((res.data ?? []).map((t: { key: string; label: string }) => [t.key, t.label]))))
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : { data: null }))
      .then((res) => setCanDelete(["hr", "operations_team", "operations_director", "director", "admin"].includes(res.data?.role)))
      .catch(() => {});
  }, []);

  const deleteApplication = async () => {
    if (!confirm("Delete this application? This permanently removes the candidate's record, documents, and message thread. This cannot be undone.")) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/candidates/${candidateId}`, { method: "DELETE" });
      const body = await res.json();
      if (!res.ok) {
        alert(body.error?.message ?? "Failed to delete.");
        return;
      }
      router.push(backHref);
    } finally {
      setDeleting(false);
    }
  };

  const load = () => {
    setLoading(true);
    fetch(`/api/candidates/${candidateId}`)
      .then((r) => r.json())
      .then((res) => {
        if (res.error) throw new Error(res.error.message);
        setData(res.data);
        setForm({
          full_name: res.data.user?.full_name ?? res.data.full_name ?? "",
          nationality: res.data.nationality ?? "",
          date_of_birth: res.data.date_of_birth?.slice(0, 10) ?? "",
          passport_number: res.data.passport_number ?? "",
          email: res.data.email ?? "",
          desired_role: res.data.desired_role ?? "",
          second_nationality: res.data.second_nationality ?? "",
          gender: res.data.gender ?? "",
          passport_expiry: res.data.passport_expiry?.slice(0, 10) ?? "",
          current_occupation: res.data.current_occupation ?? "",
          highest_education: res.data.highest_education ?? "",
          home_address: res.data.home_address ?? "",
          whatsapp_number: res.data.whatsapp_number ?? "",
          marital_status: res.data.marital_status ?? "",
        });
      })
      .catch(() => setError("Failed to load candidate."))
      .finally(() => setLoading(false));
  };

  useEffect(load, [candidateId]);

  const recordConsent = async () => {
    const res = await fetch(`/api/candidates/${candidateId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ consent_given: true }),
    });
    if (res.ok) load();
  };

  const clearReferralFlag = async () => {
    const res = await fetch(`/api/candidates/${candidateId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ referral_duplicate_flag: false }),
    });
    if (res.ok) load();
  };

  const saveDetails = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch(`/api/candidates/${candidateId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (res.ok) {
        setEditing(false);
        load();
      }
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <p className="text-midnight-900/50">Loading…</p>;
  if (error || !data) return <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4 text-sm">{error}</div>;

  const name = data.user?.full_name ?? data.full_name ?? "— unnamed lead —";
  const contact = data.user?.email ?? data.email ?? data.phone ?? "";
  const app = data.applications[0] as ApplicationRow | undefined;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          {/* router.back() (not a fixed Link) so returning here lands on the
              list's exact previous page/filters, not a reset to page 1 (CRM
              Comments follow-up, 2026-08-12) — falls back to the bare list
              path if there's no history to go back to (e.g. a direct link). */}
          <button
            type="button"
            onClick={() => (window.history.length > 1 ? router.back() : router.push(backHref))}
            className="text-xs text-midnight-900/45 hover:text-gold-600 mb-2 inline-block"
          >
            ← Back to candidates
          </button>
          <h1 className="text-2xl font-semibold text-midnight-900">{name}</h1>
          <p className="text-sm text-midnight-900/50">{contact}</p>
        </div>
        <div className="text-right space-y-1.5">
          <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold ${STATUS_STYLES[data.lifecycle_status] ?? "bg-slate-100 text-slate-700"}`}>
            {formatCandidateLifecycleStatus(data.lifecycle_status)}
          </span>
          {data.screening_result !== null && (
            <div className={`text-xs font-medium ${data.screening_result ? "text-emerald-600" : "text-red-500"}`}>
              Screening: {data.screening_result ? "Passed" : "Failed"}
            </div>
          )}
          {canDelete && !data.applications.some((a) => a.case) && (
            <button
              type="button"
              disabled={deleting}
              onClick={deleteApplication}
              className="inline-flex items-center gap-1 text-xs font-semibold text-red-500 hover:underline disabled:opacity-50"
            >
              <Trash size={12} weight="bold" /> {deleting ? "Deleting…" : "Delete Application"}
            </button>
          )}
        </div>
      </div>

      {data.return_reason && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4 text-sm">
          <span className="font-semibold">Returned:</span> {data.return_reason}
        </div>
      )}

      {data.referral_agent && (
        <div className="bg-blue-50 border border-blue-200 text-blue-800 rounded-lg p-4 text-sm">
          <span className="font-semibold">Referred by:</span> {data.referral_agent.full_name} ({data.referral_agent.referral_code})
        </div>
      )}

      {data.referral_duplicate_flag && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-lg p-4 text-sm flex items-center justify-between gap-4">
          <span><span className="font-semibold">Possible duplicate:</span> a candidate with matching email, phone, or passport number already exists on file.</span>
          <button type="button" onClick={clearReferralFlag} className="text-xs font-semibold hover:underline shrink-0">
            Clear flag
          </button>
        </div>
      )}

      <div className="card p-6">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold text-midnight-900/70 uppercase tracking-wider">Lifecycle status</h2>
          {!data.consent_given && (
            <button type="button" onClick={recordConsent} className="text-xs font-semibold text-red-500 hover:underline">
              No consent on file — record it
            </button>
          )}
        </div>
        {hrMode ? (
          <HrCandidateStatusControls
            candidateId={data.id}
            status={data.lifecycle_status}
            screeningFailures={data.screening_failures}
            onChanged={load}
          />
        ) : (
          <CandidateStatusControls
            candidateId={data.id}
            status={data.lifecycle_status as never}
            canVerify={canVerify}
            canApprove={canApprove}
            onChanged={load}
          />
        )}
      </div>

      <div className="card p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-midnight-900/70 uppercase tracking-wider">Personal Information (Section 2)</h2>
          <button type="button" onClick={() => setEditing((v) => !v)} className="inline-flex items-center gap-1 text-xs text-gold-600 hover:underline">
            <PencilSimple size={12} weight="bold" /> {editing ? "Cancel" : "Edit"}
          </button>
        </div>

        {editing ? (
          <form method="post" onSubmit={saveDetails} className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-midnight-900/50 mb-1">Full name</label>
              <input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} className="input-field text-sm w-full" />
            </div>
            <div>
              <label className="block text-xs text-midnight-900/50 mb-1">Nationality</label>
              <input value={form.nationality} onChange={(e) => setForm({ ...form, nationality: e.target.value })} className="input-field text-sm w-full" />
            </div>
            <div>
              <label className="block text-xs text-midnight-900/50 mb-1">Date of birth</label>
              <input type="date" value={form.date_of_birth} onChange={(e) => setForm({ ...form, date_of_birth: e.target.value })} className="input-field text-sm w-full" />
            </div>
            <div>
              <label className="block text-xs text-midnight-900/50 mb-1">Passport number</label>
              <input value={form.passport_number} onChange={(e) => setForm({ ...form, passport_number: e.target.value })} className="input-field text-sm w-full" />
            </div>
            <div>
              <label className="block text-xs text-midnight-900/50 mb-1">Email</label>
              <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="input-field text-sm w-full" />
            </div>
            <div>
              <label className="block text-xs text-midnight-900/50 mb-1">Desired role</label>
              <input value={form.desired_role} onChange={(e) => setForm({ ...form, desired_role: e.target.value })} className="input-field text-sm w-full" />
            </div>
            <div>
              <label className="block text-xs text-midnight-900/50 mb-1">Second nationality</label>
              <input value={form.second_nationality} onChange={(e) => setForm({ ...form, second_nationality: e.target.value })} className="input-field text-sm w-full" />
            </div>
            <div>
              <label className="block text-xs text-midnight-900/50 mb-1">Gender</label>
              <SearchableSelect
                value={form.gender}
                onChange={(value) => setForm({ ...form, gender: value })}
                placeholder="Select…"
                options={GENDER_OPTIONS}
                className="input-field text-sm w-full"
              />
            </div>
            <div>
              <label className="block text-xs text-midnight-900/50 mb-1">Passport expiry</label>
              <input type="date" value={form.passport_expiry} onChange={(e) => setForm({ ...form, passport_expiry: e.target.value })} className="input-field text-sm w-full" />
            </div>
            <div>
              <label className="block text-xs text-midnight-900/50 mb-1">Current occupation</label>
              <input value={form.current_occupation} onChange={(e) => setForm({ ...form, current_occupation: e.target.value })} className="input-field text-sm w-full" />
            </div>
            <div>
              <label className="block text-xs text-midnight-900/50 mb-1">Highest education</label>
              <input value={form.highest_education} onChange={(e) => setForm({ ...form, highest_education: e.target.value })} className="input-field text-sm w-full" />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs text-midnight-900/50 mb-1">Complete home address</label>
              <input value={form.home_address} onChange={(e) => setForm({ ...form, home_address: e.target.value })} className="input-field text-sm w-full" />
            </div>
            <div>
              <label className="block text-xs text-midnight-900/50 mb-1">WhatsApp number</label>
              <input value={form.whatsapp_number} onChange={(e) => setForm({ ...form, whatsapp_number: e.target.value })} className="input-field text-sm w-full" />
            </div>
            <div>
              <label className="block text-xs text-midnight-900/50 mb-1">Marital status</label>
              <SearchableSelect
                value={form.marital_status}
                onChange={(value) => setForm({ ...form, marital_status: value })}
                placeholder="Select…"
                options={MARITAL_STATUS_OPTIONS}
                className="input-field text-sm w-full"
              />
            </div>
            <div className="sm:col-span-2">
              <button type="submit" disabled={saving} className="btn-primary text-xs disabled:opacity-60">
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </form>
        ) : (
          <div className="grid sm:grid-cols-3 gap-4">
            <Field label="Nationality" value={data.nationality} />
            <Field label="Second nationality" value={data.second_nationality} />
            <Field label="Gender" value={data.gender ? data.gender[0].toUpperCase() + data.gender.slice(1) : null} />
            <Field label="Date of birth" value={data.date_of_birth?.slice(0, 10)} />
            <Field label="Passport number" value={data.passport_number} />
            <Field label="Passport expiry" value={data.passport_expiry?.slice(0, 10)} />
            <Field label="Phone" value={data.user?.phone ?? data.phone} />
            <Field label="Email" value={data.user?.email ?? data.email} />
            <Field label="WhatsApp" value={data.whatsapp_number} />
            <Field label="Desired role" value={data.desired_role} />
            <Field label="Current occupation" value={data.current_occupation} />
            <Field label="Highest education" value={data.highest_education} />
            <Field label="Marital status" value={data.marital_status} />
            <div className="sm:col-span-3">
              <Field label="Home address" value={data.home_address} />
            </div>
          </div>
        )}
      </div>

      {app && (
        <div className="card p-6">
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-sm font-semibold text-midnight-900/70 uppercase tracking-wider">
              Candidate Information Form Submission
            </h2>
            <ApplicationEditDetails
              candidateId={data.id}
              initial={{
                job_id: app.job_id,
                job_position_id: app.job_position_id,
                job_sector_name: app.job_position?.job_sector.sector ?? null,
                earliest_travel_date: app.earliest_travel_date,
                current_location_country_name: app.current_location_country?.name ?? app.current_location_country_name,
                prior_eu_visa_applied: app.prior_eu_visa_applied,
                prior_eu_visa_applied_details: app.prior_eu_visa_applied_details,
                holds_schengen_visa: app.holds_schengen_visa,
                holds_schengen_visa_details: app.holds_schengen_visa_details,
                prior_visa_refusals: app.prior_visa_refusals,
                prior_visa_refusals_details: app.prior_visa_refusals_details,
                available_for_embassy_appointment: app.available_for_embassy_appointment,
                willing_to_start_within_30_days: app.willing_to_start_within_30_days,
                preferred_contact_channel: app.preferred_contact_channel,
              }}
              onSaved={load}
            />
          </div>
          <p className="text-xs text-midnight-900/40 mb-4">Submitted {new Date(app.submitted_at).toLocaleDateString()}</p>

          <div className="grid sm:grid-cols-3 gap-4 mb-6">
            {app.job ? (
              <>
                <Field label="Opportunity" value={app.job.title} />
                <Field label="Destination" value={`${app.job.city}, ${app.job.country}`} />
                <Field
                  label="Position"
                  value={app.job_position ? (app.job_position.city ? `${app.job_position.title} — ${app.job_position.city}` : app.job_position.title) : undefined}
                />
              </>
            ) : (
              <>
                <Field label="Preferred country — option 1" value={app.preferred_country_1?.name} />
                <Field label="Preferred country — option 2" value={app.preferred_country_2?.name} />
                <Field label="Preferred country — option 3" value={app.preferred_country_3?.name} />
                <Field label="Preferred type of work" value={app.preferred_sector?.name} />
              </>
            )}
            <Field label="Earliest travel date" value={app.earliest_travel_date?.slice(0, 10)} />
            <Field label="Prior EU visa applied" value={yesNoWithDetail(app.prior_eu_visa_applied, app.prior_eu_visa_applied_details)} />
          </div>

          <div className="mb-6">
            <div className="text-[11px] text-midnight-900/40 uppercase tracking-wider mb-1.5">Documents self-reported as available</div>
            {app.documents_available.length === 0 ? (
              <p className="text-sm text-midnight-900/40">None reported.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {app.documents_available.map((d) => (
                  <span key={d} className="inline-flex items-center px-2.5 py-1 rounded-full text-xs bg-ivory-100 border border-midnight-900/10 text-midnight-900/70 capitalize">
                    {d.replace(/_/g, " ")}
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="grid sm:grid-cols-3 gap-4 mb-6">
            <Field label="Current location" value={app.current_location_country?.name ?? app.current_location_country_name ?? undefined} />
            <Field label="Holds Schengen/EU visa" value={yesNoWithDetail(app.holds_schengen_visa, app.holds_schengen_visa_details)} />
            <Field label="Prior visa refusals" value={yesNoWithDetail(app.prior_visa_refusals, app.prior_visa_refusals_details)} />
            <Field label="Available for embassy appointment" value={app.available_for_embassy_appointment ? "Yes" : "No"} />
            <Field label="Willing to start within 30 days" value={app.willing_to_start_within_30_days ? "Yes" : "No"} />
            <Field label="Preferred contact channel" value={app.preferred_contact_channel} />
          </div>

          <div className="flex items-center gap-2 text-sm">
            {app.payment_plan_acknowledged ? (
              <CheckCircle size={16} weight="fill" className="text-emerald-600" />
            ) : (
              <span className="w-4 h-4 rounded-full border border-midnight-900/20 inline-block" />
            )}
            Payment plan acknowledged
          </div>
        </div>
      )}

      {(() => {
        const uploadedByType = new Map(data.documents.map((d) => [d.type, d]));
        const otherDocs = data.documents.filter((d) => d.type === "other");
        const extraDocs = data.documents.filter((d) => !data.required_document_types.includes(d.type) && d.type !== "other");
        return (
          <div className="card p-6">
            <h2 className="text-sm font-semibold text-midnight-900/70 uppercase tracking-wider mb-1">Documents</h2>
            <p className="text-xs text-midnight-900/40 mb-4">
              Required across this candidate&rsquo;s application{data.applications.length === 1 ? "" : "s"} — upload whatever&rsquo;s still missing.
            </p>
            <div className="space-y-2 mb-4">
              {data.required_document_types.length === 0 && (
                <p className="text-sm text-midnight-900/40">No document requirements yet — select a destination country on an application first.</p>
              )}
              {data.required_document_types.map((type) => {
                const doc = uploadedByType.get(type);
                return (
                  <div key={type} className="flex items-center justify-between text-sm border-b border-midnight-900/5 pb-2">
                    <span className="text-midnight-900">{docTypeLabels[type] ?? type.replace(/_/g, " ")}</span>
                    {doc ? (
                      <div className="flex items-center gap-3">
                        <DocumentLink documentId={doc.id} label="View" className="text-gold-600 hover:underline text-xs" />
                        {canVerifyDocuments ? (
                          <DocumentVerifyControls documentId={doc.id} initialStatus={doc.verification_status} />
                        ) : (
                          <span className="text-xs text-midnight-900/45 capitalize">{doc.verification_status}</span>
                        )}
                        <CandidateDocumentUpload candidateId={data.id} type={type} label="Replace" onUploaded={load} />
                      </div>
                    ) : (
                      <CandidateDocumentUpload candidateId={data.id} type={type} label="Upload" onUploaded={load} />
                    )}
                  </div>
                );
              })}
            </div>

            {extraDocs.length > 0 && (
              <div className="pt-2 border-t border-midnight-900/10">
                <div className="text-[11px] text-midnight-900/40 uppercase tracking-wider mb-2">Additional documents on file</div>
                <div className="space-y-2">
                  {extraDocs.map((d) => (
                    <div key={d.id} className="flex items-center justify-between text-sm">
                      <DocumentLink documentId={d.id} label={docTypeLabels[d.type] ?? d.type.replace(/_/g, " ")} className="text-gold-600 hover:underline" />
                      {canVerifyDocuments ? (
                        <DocumentVerifyControls documentId={d.id} initialStatus={d.verification_status} />
                      ) : (
                        <span className="text-xs text-midnight-900/45 capitalize">{d.verification_status}</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <SupportingDocumentUpload candidateId={data.id} documents={otherDocs} onUploaded={load} />
          </div>
        );
      })()}

      {/* Messaging is scoped to the candidate, their assigned recruiter, and
          (2026-07-31) HR reviewing a self-submission — canVerify is false
          in exactly those two contexts (the recruiter's own portal, and
          HR's hrMode wrapper, which never sets canVerify); supervisor/
          in-house viewers would just get a 403 from the API. */}
      {!canVerify && <CandidateMessages candidateId={data.id} />}
    </div>
  );
}
