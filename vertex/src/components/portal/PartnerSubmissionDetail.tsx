"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import DocumentLink from "@/components/DocumentLink";
import DocumentVerifyControls from "@/components/DocumentVerifyControls";
import CandidateMessages from "@/components/CandidateMessages";
import CandidateEditDetails from "./CandidateEditDetails";
import ApplicationEditDetails from "./ApplicationEditDetails";
import CandidateDocumentUpload from "./CandidateDocumentUpload";
import SupportingDocumentUpload from "./SupportingDocumentUpload";
import { formatPartnerCandidateStatus } from "@/lib/partnerCandidateStatus";
import { summarizePaymentStages, type PaymentStageOption } from "@/components/PaymentStagesPreview";
import { CheckCircle, WarningCircle, Trash } from "@phosphor-icons/react";

interface PartnerCandidateDetail {
  id: string;
  status: string;
  full_name: string;
  email: string;
  whatsapp_number: string | null;
  nationality: string;
  second_nationality: string | null;
  gender: string | null;
  date_of_birth: string;
  passport_number: string;
  passport_expiry: string;
  current_occupation: string | null;
  highest_education: string | null;
  home_address: string | null;
  marital_status: string | null;
  earliest_travel_date: string;
  prior_eu_visa_applied: boolean | null;
  prior_eu_visa_applied_details: string | null;
  documents_available: string[];
  payment_plan_acknowledged: boolean;
  current_location_country_name: string;
  current_location_country: { name: string } | null;
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
  partner: { id: string; name: string; contact_email: string; contact_name: string; contact_phone: string };
  job: {
    id: string;
    title: string;
    country: string;
    city: string;
    service_fee_gbp: number | null;
    is_credit_service: boolean;
    payment_stages: PaymentStageOption[];
  } | null;
  job_position_id: string | null;
  job_position: { title: string; city: string | null; job_sector: { sector: string } } | null;
  reviewer: { full_name: string } | null;
  bridged_candidate: {
    id: string;
    documents: { id: string; type: string; label: string | null; verification_status: string; uploaded_at: string }[];
  } | null;
  document_completeness: { complete: boolean; missingTypes: string[] } | null;
  required_document_types: string[];
}

const STATUS_STYLES: Record<string, string> = {
  submitted: "bg-blue-100 text-blue-700",
  under_review: "bg-yellow-100 text-yellow-800",
  job_assigned: "bg-emerald-100 text-emerald-800",
  rejected: "bg-red-100 text-red-700",
};

function yesNoWithDetail(value: boolean | null | undefined, detail?: string | null): string | undefined {
  if (value === null || value === undefined) return undefined;
  const base = value ? "Yes" : "No";
  return detail ? `${base} — ${detail}` : base;
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] text-midnight-900/40 uppercase tracking-wider mb-0.5">{label}</div>
      <div className="text-sm text-midnight-900">{value || "—"}</div>
    </div>
  );
}

interface Props {
  id: string;
  backHref?: string;
}

/**
 * Shared partner-submission review body — HR's full review (Create Case /
 * Reject, HR-exclusive) and Operations' read-plus-correct view (no review
 * actions, per the confirmed "Operations reads this before HR approves"
 * decision) both render this, gated only by what the authenticated user's
 * own role actually allows server-side. Edit/upload (2026-08-04) targets
 * the already-bridged real Candidate record (present from submission time,
 * not just after HR approves) — same "minor corrections without a full
 * reject/resend cycle" capability the recruiter has always had on an
 * internally-sourced lead, extended to whoever now reviews a partner
 * submission pre-Case.
 */
export default function PartnerSubmissionDetail({ id, backHref }: Props) {
  const router = useRouter();
  const [data, setData] = useState<PartnerCandidateDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [caseId, setCaseId] = useState<string | null>(null);
  const [actioning, setActioning] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [canAct, setCanAct] = useState(false);
  const [canEditAndUpload, setCanEditAndUpload] = useState(false);
  const [docTypeLabels, setDocTypeLabels] = useState<Record<string, string>>({});
  const [deleting, setDeleting] = useState(false);

  const load = () => {
    fetch(`/api/partner-candidates/${id}`)
      .then((r) => r.json())
      .then((res) => {
        if (!res.data) { setError(res.error?.message ?? "Failed to load submission."); return; }
        setData(res.data);
        if (res.data.status === "job_assigned" && res.data.bridged_candidate_id) {
          fetch(`/api/cases?candidate_id=${res.data.bridged_candidate_id}`)
            .then((r) => r.json())
            .then((caseRes) => setCaseId(caseRes.data?.[0]?.id ?? null))
            .catch(() => {});
        }
      })
      .catch(() => setError("Failed to load submission."))
      .finally(() => setLoading(false));
  };

  useEffect(load, [id]);

  useEffect(() => {
    fetch("/api/admin/document-types")
      .then((r) => r.json())
      .then((res) => setDocTypeLabels(Object.fromEntries((res.data ?? []).map((t: { key: string; label: string }) => [t.key, t.label]))))
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : { data: null }))
      .then((res) => {
        const role = res.data?.role;
        setCanAct(role === "hr" || role === "director" || role === "admin");
        setCanEditAndUpload(["hr", "operations_team", "operations_director", "director", "admin"].includes(role));
      })
      .catch(() => {});
  }, []);

  const createCase = async () => {
    setActioning(true);
    setError("");
    try {
      const res = await fetch(`/api/partner-candidates/${id}/create-case`, { method: "PATCH" });
      const body = await res.json();
      if (!res.ok) { setError(body.error?.message ?? "Failed to create case."); return; }
      load();
    } finally {
      setActioning(false);
    }
  };

  const reject = async () => {
    if (!rejectReason.trim()) return;
    setActioning(true);
    setError("");
    try {
      const res = await fetch(`/api/partner-candidates/${id}/reject`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rejection_reason: rejectReason }),
      });
      const body = await res.json();
      if (!res.ok) { setError(body.error?.message ?? "Failed to reject submission."); return; }
      setRejecting(false);
      setRejectReason("");
      load();
    } finally {
      setActioning(false);
    }
  };

  const deleteSubmission = async () => {
    if (!confirm("Delete this submission? This permanently removes the candidate's record, documents, and message thread. This cannot be undone.")) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/partner-candidates/${id}`, { method: "DELETE" });
      const body = await res.json();
      if (!res.ok) {
        alert(body.error?.message ?? "Failed to delete.");
        return;
      }
      router.push(backHref ?? "/hr");
    } finally {
      setDeleting(false);
    }
  };

  if (loading) {
    return <p className="text-midnight-900/50">Loading…</p>;
  }
  if (!data) {
    return <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4 text-sm">{error}</div>;
  }

  const uploadedByType = new Map((data.bridged_candidate?.documents ?? []).map((d) => [d.type, d]));
  const otherDocs = (data.bridged_candidate?.documents ?? []).filter((d) => d.type === "other");
  const extraDocs = (data.bridged_candidate?.documents ?? []).filter(
    (d) => !data.required_document_types.includes(d.type) && d.type !== "other"
  );

  return (
    <div>
      {backHref && (
        // router.back() (not a fixed Link) so returning here lands on the
        // list's exact previous page/filters, not a reset to page 1 (CRM
        // Comments follow-up, 2026-08-12) — falls back to the bare list
        // path if there's no history to go back to (e.g. a direct link).
        <button
          type="button"
          onClick={() => (window.history.length > 1 ? router.back() : router.push(backHref))}
          className="text-xs text-midnight-900/45 hover:text-gold-600 mb-2 inline-block"
        >
          ← Back to submissions
        </button>
      )}
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="section-title text-3xl md:text-4xl mb-2">{data.full_name}.</h1>
          <p className="text-midnight-900/55 font-light max-w-2xl">
            Submitted by {data.partner.name} on {new Date(data.submitted_at).toLocaleDateString()}
          </p>
        </div>
        <div className="text-right space-y-1.5">
          <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold ${STATUS_STYLES[data.status] ?? "bg-slate-100 text-slate-700"}`}>
            {formatPartnerCandidateStatus(data.status)}
          </span>
          {canEditAndUpload && data.status !== "job_assigned" && (
            <button
              type="button"
              disabled={deleting}
              onClick={deleteSubmission}
              className="flex items-center gap-1 text-xs font-semibold text-red-500 hover:underline disabled:opacity-50 ml-auto"
            >
              <Trash size={12} weight="bold" /> {deleting ? "Deleting…" : "Delete Submission"}
            </button>
          )}
        </div>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4 text-sm mb-6">{error}</div>}

      {data.status === "job_assigned" && (
        <div className="card p-6 mb-6 flex items-center justify-between">
          <p className="text-sm text-midnight-900/70">A case has been created for this candidate.</p>
          {caseId && (
            <Link href={`/hr/cases/${caseId}`} className="btn-secondary text-xs px-4 py-2">
              View Case
            </Link>
          )}
        </div>
      )}

      {data.status === "rejected" && data.rejection_reason && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-lg p-4 text-sm mb-6">
          <strong>Rejected:</strong> {data.rejection_reason}
        </div>
      )}

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <div className="card p-6">
            <h3 className="text-sm font-semibold text-midnight-900/70 uppercase tracking-wider mb-4">Opportunity</h3>
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
              {data.job?.service_fee_gbp != null && data.job.payment_stages.length > 0 ? (
                <Field
                  label={data.job.is_credit_service ? "Credit Service Terms" : "Service Fee"}
                  value={summarizePaymentStages(data.job.service_fee_gbp, data.job.payment_stages)}
                />
              ) : (
                <Field label="Service Fee" value={data.job?.service_fee_gbp != null ? `£${data.job.service_fee_gbp.toLocaleString()}` : null} />
              )}
              <Field label="Earliest Travel Date" value={new Date(data.earliest_travel_date).toLocaleDateString()} />
            </div>
          </div>

          <div className="card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-midnight-900/70 uppercase tracking-wider">Personal Information</h3>
              {canEditAndUpload && data.bridged_candidate_id && (
                <CandidateEditDetails
                  candidateId={data.bridged_candidate_id}
                  initial={{
                    full_name: data.full_name,
                    nationality: data.nationality,
                    date_of_birth: data.date_of_birth,
                    passport_number: data.passport_number,
                    email: data.email,
                    desired_role: null,
                    second_nationality: data.second_nationality,
                    gender: data.gender,
                    passport_expiry: data.passport_expiry,
                    current_occupation: data.current_occupation,
                    highest_education: data.highest_education,
                    home_address: data.home_address,
                    whatsapp_number: data.whatsapp_number,
                    marital_status: data.marital_status,
                  }}
                  onSaved={() => load()}
                />
              )}
            </div>
            <div className="grid sm:grid-cols-2 gap-4">
              <Field label="Email" value={data.email} />
              <Field label="WhatsApp" value={data.whatsapp_number} />
              <Field label="Nationality" value={data.nationality} />
              <Field label="Second Nationality" value={data.second_nationality} />
              <Field label="Gender" value={data.gender ? data.gender[0].toUpperCase() + data.gender.slice(1) : null} />
              <Field label="Date of Birth" value={new Date(data.date_of_birth).toLocaleDateString()} />
              <Field label="Passport Number" value={data.passport_number} />
              <Field label="Passport Expiry" value={new Date(data.passport_expiry).toLocaleDateString()} />
              <Field label="Current Occupation" value={data.current_occupation} />
              <Field label="Highest Education" value={data.highest_education} />
              <Field label="Marital Status" value={data.marital_status} />
              <Field label="Home Address" value={data.home_address} />
              <Field label="Current Location" value={data.current_location_country?.name ?? data.current_location_country_name} />
            </div>
          </div>

          <div className="card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-midnight-900/70 uppercase tracking-wider">Visa &amp; Travel Readiness</h3>
              {canEditAndUpload && data.bridged_candidate_id && (
                <ApplicationEditDetails
                  candidateId={data.bridged_candidate_id}
                  initial={{
                    job_id: data.job?.id ?? null,
                    job_position_id: data.job_position_id,
                    job_sector_name: data.job_position?.job_sector.sector ?? null,
                    earliest_travel_date: data.earliest_travel_date,
                    current_location_country_name: data.current_location_country?.name ?? data.current_location_country_name,
                    prior_eu_visa_applied: data.prior_eu_visa_applied,
                    prior_eu_visa_applied_details: data.prior_eu_visa_applied_details,
                    holds_schengen_visa: data.holds_schengen_visa,
                    holds_schengen_visa_details: data.holds_schengen_visa_details,
                    prior_visa_refusals: data.prior_visa_refusals,
                    prior_visa_refusals_details: data.prior_visa_refusals_details,
                    available_for_embassy_appointment: data.available_for_embassy_appointment,
                    willing_to_start_within_30_days: data.willing_to_start_within_30_days,
                    preferred_contact_channel: data.preferred_contact_channel,
                  }}
                  onSaved={() => load()}
                />
              )}
            </div>
            <div className="grid sm:grid-cols-2 gap-4">
              <Field label="Prior EU Visa Applied" value={yesNoWithDetail(data.prior_eu_visa_applied, data.prior_eu_visa_applied_details)} />
              <Field label="Holds Schengen Visa" value={yesNoWithDetail(data.holds_schengen_visa, data.holds_schengen_visa_details)} />
              <Field label="Prior Visa Refusals" value={yesNoWithDetail(data.prior_visa_refusals, data.prior_visa_refusals_details)} />
              <Field label="Available for Embassy Appointment" value={data.available_for_embassy_appointment ? "Yes" : "No"} />
              <Field label="Willing to Start Within 30 Days" value={data.willing_to_start_within_30_days ? "Yes" : "No"} />
              <Field label="Preferred Contact Channel" value={data.preferred_contact_channel} />
              <Field label="Payment Plan Acknowledged" value={data.payment_plan_acknowledged ? "Yes" : "No"} />
            </div>
          </div>

          <div className="card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-midnight-900/70 uppercase tracking-wider">Documents</h3>
              {data.document_completeness && (
                data.document_completeness.complete ? (
                  <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700">
                    <CheckCircle size={13} weight="fill" /> Complete
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-700">
                    <WarningCircle size={13} weight="fill" /> Missing: {data.document_completeness.missingTypes.join(", ")}
                  </span>
                )
              )}
            </div>
            <div className="space-y-2">
              {data.required_document_types.length === 0 && (!data.bridged_candidate || data.bridged_candidate.documents.length === 0) && (
                <p className="text-sm text-midnight-900/40">No documents uploaded yet.</p>
              )}
              {data.required_document_types.map((type) => {
                const doc = uploadedByType.get(type);
                return (
                  <div key={type} className="flex items-center justify-between text-sm border-b border-midnight-900/5 pb-2">
                    <span className="text-midnight-900 capitalize">{docTypeLabels[type] ?? type.replace(/_/g, " ")}</span>
                    <div className="flex items-center gap-3">
                      {doc ? (
                        <>
                          <DocumentLink documentId={doc.id} label="View" className="text-gold-600 hover:underline text-xs" />
                          <DocumentVerifyControls documentId={doc.id} initialStatus={doc.verification_status} />
                        </>
                      ) : (
                        <span className="text-xs text-amber-700 font-medium">Missing</span>
                      )}
                      {canEditAndUpload && data.bridged_candidate_id && (
                        <CandidateDocumentUpload
                          candidateId={data.bridged_candidate_id}
                          type={type}
                          label={doc ? "Replace" : "Upload"}
                          onUploaded={load}
                        />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {extraDocs.length > 0 && (
              <div className="pt-2 border-t border-midnight-900/10 mt-2">
                <div className="text-[11px] text-midnight-900/40 uppercase tracking-wider mb-2">Additional documents on file</div>
                <div className="space-y-2">
                  {extraDocs.map((d) => (
                    <div key={d.id} className="flex items-center justify-between text-sm">
                      <DocumentLink documentId={d.id} label={docTypeLabels[d.type] ?? d.type.replace(/_/g, " ")} className="text-gold-600 hover:underline" />
                      <DocumentVerifyControls documentId={d.id} initialStatus={d.verification_status} />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Lets HR/Operations/Director attach a document that isn't one
                of this destination's required types (2026-09-14) — previously
                this page only offered Replace/Upload for the fixed required-
                type list above, with no way to add anything outside it. */}
            {canEditAndUpload && data.bridged_candidate_id && (
              <SupportingDocumentUpload candidateId={data.bridged_candidate_id} documents={otherDocs} onUploaded={load} />
            )}
          </div>

          {canAct && data.status !== "job_assigned" && data.status !== "rejected" && (
            <div className="card p-6">
              <h3 className="text-sm font-semibold text-midnight-900/70 uppercase tracking-wider mb-4">Review</h3>
              {rejecting ? (
                <div className="space-y-3">
                  <textarea
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                    rows={3}
                    className="input-field text-sm w-full resize-none"
                    placeholder="Why is this application being rejected?"
                  />
                  <div className="flex items-center gap-2">
                    <button onClick={reject} disabled={actioning || !rejectReason.trim()} className="btn-primary text-xs disabled:opacity-50">
                      {actioning ? "Sending…" : "Confirm Reject"}
                    </button>
                    <button onClick={() => { setRejecting(false); setRejectReason(""); }} className="btn-secondary text-xs">Cancel</button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-3">
                  <button onClick={createCase} disabled={actioning} className="btn-primary text-xs disabled:opacity-50">
                    {actioning ? "Creating…" : "Create Case"}
                  </button>
                  <button onClick={() => setRejecting(true)} disabled={actioning} className="btn-secondary text-xs disabled:opacity-50">
                    Reject
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="space-y-6">
          <div className="card p-6">
            <h3 className="text-sm font-semibold text-midnight-900/70 uppercase tracking-wider mb-4">Partner</h3>
            <div className="space-y-3">
              <Field label="Agency" value={data.partner.name} />
              <Field label="Contact" value={data.partner.contact_name} />
              <Field label="Email" value={data.partner.contact_email} />
              <Field label="Phone" value={data.partner.contact_phone} />
            </div>
          </div>
          {data.reviewer && (
            <div className="card p-6">
              <Field label="Last Reviewed By" value={data.reviewer.full_name} />
            </div>
          )}
          {data.bridged_candidate_id && <CandidateMessages candidateId={data.bridged_candidate_id} />}
        </div>
      </div>
    </div>
  );
}

