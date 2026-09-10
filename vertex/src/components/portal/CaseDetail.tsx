"use client";

import { useEffect, useState, useCallback } from "react";
import DocumentLink from "@/components/DocumentLink";
import DocumentVerifyControls from "@/components/DocumentVerifyControls";
import SearchableSelect from "@/components/SearchableSelect";
import CandidateEditDetails from "./CandidateEditDetails";
import ApplicationEditDetails from "./ApplicationEditDetails";
import CaseStageProgress from "./CaseStageProgress";
import { CASE_STAGE_ORDER, CASE_STAGE_LABELS, type CaseStageKey } from "./caseStages";
import { CASE_UPLOAD_EXCLUDED_KEYS, PAYMENT_RECEIPT_TYPE_KEYS, paymentReceiptTypeKey } from "@/lib/documentTypes";
import { computeMilestoneSplit } from "@/lib/fees";
import { UploadSimple } from "@phosphor-icons/react";

interface Document {
  id: string;
  type: string;
  verification_status: string;
  uploaded_at: string;
}

interface StageEvent {
  id: string;
  stage: CaseStageKey;
  entered_at: string;
  completed_at: string | null;
  notes: string | null;
  owner: { full_name: string } | null;
}

interface Contract {
  id: string;
  status: string;
  content: string;
  signed_by_name: string | null;
  signed_at: string | null;
}

interface Payment {
  id: string;
  type: string;
  amount: number;
  currency: string;
  receipt_reference: string | null;
  receipt_document_id: string | null;
  recorded_at: string;
  recorder: { full_name: string };
  status: "pending" | "collected";
  stripe_payment_link_url: string | null;
  sent_to_email: string | null;
}

interface ActivityEntry {
  id: string;
  kind: "audit" | "reminder";
  summary: string;
  actorName: string;
  actorRole: string | null;
  timestamp: string;
}

interface CaseData {
  id: string;
  current_stage: CaseStageKey;
  stage_deadline: string | null;
  stage_events: StageEvent[];
  contract: Contract | null;
  payments: Payment[];
  retention_follow_up: { due_at: string; completed_at: string | null; notes: string | null } | null;
  ops_review_status: "pending" | "confirmed" | "rejected";
  ops_reviewed_at: string | null;
  ops_review_notes: string | null;
  ops_reviewed_by: { full_name: string } | null;
  status: "active" | "rejected";
  rejected_at: string | null;
  rejection_reason: string | null;
  rejected_by: { full_name: string } | null;
  application: {
    id: string;
    cover_letter: string | null;
    internal_notes: string | null;
    candidate: {
      id: string;
      full_name: string | null;
      country_id: string | null;
      partner_id: string | null;
      // Stripe restricted to self-applicants (2026-07-31) — everything
      // else (recruiter_sourced/partner_sourced) records payments
      // manually with a receipt instead, never a "Send Payment Link".
      source: string;
      user: { full_name: string; email: string } | null;
      recruiter: { full_name: string } | null;
      partner: { name: string } | null;
      documents: Document[];
      // Personal Information + Visa & Travel Readiness editing
      // (2026-08-18) — the same fields/widgets already editable
      // pre-Case on PartnerSubmissionDetail.tsx/CandidateDetail.tsx, now
      // also reachable from the Case itself so HR/Operations/Director
      // don't need to navigate back to the original application to fix
      // something after a case already exists.
      nationality: string | null;
      second_nationality: string | null;
      gender: string | null;
      date_of_birth: string | null;
      passport_number: string | null;
      passport_expiry: string | null;
      current_occupation: string | null;
      highest_education: string | null;
      home_address: string | null;
      whatsapp_number: string | null;
      marital_status: string | null;
      email: string | null;
      phone: string | null;
      desired_role: string | null;
    };
    job_id: string | null;
    job: { title: string; country: string; city: string; service_fee_gbp: number | null } | null;
    preferred_country_1: { name: string } | null;
    preferred_sector: { name: string } | null;
    current_location_country_name: string | null;
    earliest_travel_date: string | null;
    prior_eu_visa_applied: boolean | null;
    prior_eu_visa_applied_details: string | null;
    holds_schengen_visa: boolean | null;
    holds_schengen_visa_details: string | null;
    prior_visa_refusals: boolean | null;
    prior_visa_refusals_details: string | null;
    available_for_embassy_appointment: boolean;
    willing_to_start_within_30_days: boolean;
    preferred_contact_channel: string | null;
  };
}

// Case-stage/contract/document ownership belongs to Operations, payments to
// Finance (SOP-driven separation of duties, 2026-07-31) — recruiter/
// country_supervisor/inhouse_supervisor/HR keep read-only visibility only.
// Every flag defaults false (fail closed) so a caller that forgets to pass
// capabilities explicitly gets the safe, read-only rendering rather than
// silently exposing controls the backend will reject anyway.
export interface CaseDetailCapabilities {
  advanceStage: boolean;
  manageContract: boolean;
  manageDocuments: boolean;
  managePayments: boolean;
  manageRetention: boolean;
  sendReminder: boolean;
  // Operations-only (2026-07-31): replaces the Contract card with a
  // dedicated work-permit upload/replace shortcut instead — Operations
  // doesn't issue contracts, and hunting for "Issued Work Permit" in the
  // generic Documents type picker isn't a good fit for what's actually
  // their main deliverable at this stage.
  manageWorkPermit: boolean;
  // Operations/Director documentation-confirmation gate (CRM Comments
  // item 3, 2026-08-10) — a lightweight second-look distinct from
  // manageContract/advanceStage, so it's its own flag rather than reusing
  // one of those.
  manageOpsReview: boolean;
  // The "Reject Case" action (2026-08-16) — kept separate from
  // manageOpsReview so HR can get it without also gaining the
  // Documentation Review confirm/reject powers that flag otherwise
  // implies. HR's own case is undoing a case they created by mistake;
  // Operations/Director keep it too, for a problem found after HR handed
  // the case off.
  rejectCase: boolean;
  // Personal Information + Visa & Travel Readiness editing (2026-08-18)
  // — the same edit surface already available pre-Case on
  // PartnerSubmissionDetail.tsx/CandidateDetail.tsx, so a correction is
  // reachable without navigating back to the original application once
  // a case already exists.
  editApplication: boolean;
}

const NO_CAPABILITIES: CaseDetailCapabilities = {
  advanceStage: false,
  manageContract: false,
  manageDocuments: false,
  managePayments: false,
  manageRetention: false,
  sendReminder: false,
  manageWorkPermit: false,
  manageOpsReview: false,
  rejectCase: false,
  editApplication: false,
};

interface Props {
  caseId: string;
  capabilities?: CaseDetailCapabilities;
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] text-midnight-900/40 uppercase tracking-wider mb-0.5">{label}</div>
      <div className="text-sm text-midnight-900">{value || "—"}</div>
    </div>
  );
}

function yesNoWithDetail(value: boolean | null | undefined, detail?: string | null): string | undefined {
  if (value === null || value === undefined) return undefined;
  const base = value ? "Yes" : "No";
  return detail ? `${base} — ${detail}` : base;
}

export default function CaseDetail({ caseId, capabilities = NO_CAPABILITIES }: Props) {
  const [data, setData] = useState<CaseData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [feeEnabled, setFeeEnabled] = useState(false);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);

  const [nextStage, setNextStage] = useState("");
  const [stageNotes, setStageNotes] = useState("");
  const [stageDeadline, setStageDeadline] = useState("");

  const [opsReviewNotes, setOpsReviewNotes] = useState("");
  const [showOpsRejectForm, setShowOpsRejectForm] = useState(false);
  const [submittingOpsReview, setSubmittingOpsReview] = useState(false);

  const [showCaseRejectForm, setShowCaseRejectForm] = useState(false);
  const [caseRejectReason, setCaseRejectReason] = useState("");
  const [submittingCaseReject, setSubmittingCaseReject] = useState(false);

  const [contractContent, setContractContent] = useState("");
  const [signName, setSignName] = useState("");

  const [payType, setPayType] = useState<"documentation" | "permit" | "visa">("documentation");
  const [payAmount, setPayAmount] = useState("");
  const [payReceipt, setPayReceipt] = useState("");
  const [payReceiptDocumentId, setPayReceiptDocumentId] = useState<string | null>(null);
  const [uploadingReceipt, setUploadingReceipt] = useState(false);

  const [linkType, setLinkType] = useState<"documentation" | "permit" | "visa">("documentation");
  const [linkRecipient, setLinkRecipient] = useState<"candidate" | "partner">("candidate");
  const [generatingLink, setGeneratingLink] = useState(false);
  const [checkingPaymentId, setCheckingPaymentId] = useState("");
  const [linkError, setLinkError] = useState("");

  // Emailed invoice (2026-08-04) — the off-Stripe fallback: always
  // available regardless of candidate.source, unlike Send Payment Link
  // above (self-applicants only). Defaults recipient to "partner" when
  // one exists, since that's the common case this was built for.
  const [invoiceType, setInvoiceType] = useState<"documentation" | "permit" | "visa">("documentation");
  const [invoiceAmount, setInvoiceAmount] = useState("");
  const [invoiceRecipient, setInvoiceRecipient] = useState<"candidate" | "partner">("candidate");
  const [invoiceReference, setInvoiceReference] = useState("");
  // The invoice itself is a real file Finance generated elsewhere (their
  // bank/Wise, Stripe Invoicing, etc.) and uploads here — this app never
  // generates one, only sends it.
  const [invoiceDocumentId, setInvoiceDocumentId] = useState<string | null>(null);
  const [uploadingInvoiceFile, setUploadingInvoiceFile] = useState(false);
  const [sendingInvoice, setSendingInvoice] = useState(false);
  const [invoiceError, setInvoiceError] = useState("");
  const [markingPaidId, setMarkingPaidId] = useState("");
  // Keyed by payment id — a receipt (bank transfer confirmation, etc.) is
  // required before "Mark as Paid" enables, since there's no webhook
  // backing an emailed invoice's reconciliation the way there is for a
  // Stripe payment link.
  const [markPaidReceiptId, setMarkPaidReceiptId] = useState<Record<string, string>>({});
  const [uploadingMarkPaidReceiptFor, setUploadingMarkPaidReceiptFor] = useState("");

  // Replace/delete an already-attached invoice or receipt file
  // (2026-08-16) — separate from the above, which only ever attaches a
  // receipt as part of the Mark as Paid flow. This edits a payment that
  // already has one, in either status.
  const [replacingReceiptFor, setReplacingReceiptFor] = useState("");
  const [deletingReceiptFor, setDeletingReceiptFor] = useState("");

  const [reminderChannel, setReminderChannel] = useState<"document" | "payment">("document");
  const [reminderRecipient, setReminderRecipient] = useState<"candidate" | "partner">("candidate");
  const [reminderMessage, setReminderMessage] = useState("");
  const [sendingReminder, setSendingReminder] = useState(false);
  const [reminderError, setReminderError] = useState("");
  const [reminderSent, setReminderSent] = useState(false);

  // Prefills the amount from the case's own Job.service_fee_gbp (via the
  // shared computeMilestoneSplit — same 20/40/40 split the public job
  // page shows) whenever the milestone type changes, but stays a plain
  // editable input (this app's established "auto-fill but stay editable"
  // convention) — falls back to fully-manual entry for a general-
  // programme application with no specific Job.
  const jobServiceFee = data?.application.job?.service_fee_gbp;
  useEffect(() => {
    if (jobServiceFee != null) {
      setPayAmount(String(computeMilestoneSplit(jobServiceFee)[payType]));
    }
  }, [payType, jobServiceFee]);

  const [docTypes, setDocTypes] = useState<{ key: string; label: string }[]>([]);
  const [uploadType, setUploadType] = useState("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadingType, setUploadingType] = useState<string | null>(null);
  const [workPermitFile, setWorkPermitFile] = useState<File | null>(null);

  const [notesDraft, setNotesDraft] = useState("");
  const [editingNotes, setEditingNotes] = useState(false);
  const [savingNotes, setSavingNotes] = useState(false);

  // Beyond the screening-gate's cv/passport (handled separately, earlier
  // in the pipeline): the general mobility-lifecycle set plus the
  // Candidate Information Form's Section 3 per-programme extras — which
  // extras actually apply is configured per country under Admin → Sectors
  // & Requirements, and any new type admin adds there shows up here too.
  useEffect(() => {
    fetch("/api/admin/document-types")
      .then((r) => r.json())
      .then((res) => {
        const types = (res.data ?? []).filter((t: { key: string }) => !(CASE_UPLOAD_EXCLUDED_KEYS as readonly string[]).includes(t.key));
        setDocTypes(types);
        setUploadType((prev) => prev || types[0]?.key || "");
      })
      .catch(() => {});
  }, []);

  const load = useCallback(async () => {
    const res = await fetch(`/api/cases/${caseId}`);
    const json = await res.json();
    if (!res.ok) { setError(json.error ?? "Failed to load case."); setLoading(false); return; }
    setData(json.data);
    setNotesDraft(json.data.application.internal_notes ?? "");
    setLoading(false);

    const countryId = json.data.application.candidate.country_id;
    const feeRes = await fetch("/api/fee-policy");
    const feeJson = await feeRes.json();
    const policies: { country_id: string | null; enabled: boolean }[] = feeJson.data ?? [];
    const countryPolicy = policies.find((p) => p.country_id === countryId);
    const globalPolicy = policies.find((p) => p.country_id === null);
    setFeeEnabled((countryPolicy ?? globalPolicy)?.enabled ?? false);

    fetch(`/api/cases/${caseId}/audit-log`)
      .then((r) => r.json())
      .then((res) => setActivity(res.data ?? []))
      .catch(() => {});
  }, [caseId]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <p className="text-midnight-900/50">Loading…</p>;
  if (error || !data) return <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4 text-sm">{error}</div>;

  const candidateName = data.application.candidate.user?.full_name ?? data.application.candidate.full_name ?? "— unnamed —";

  const advanceStage = async () => {
    if (!nextStage) return;
    const res = await fetch(`/api/cases/${caseId}/stage`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stage: nextStage, notes: stageNotes || undefined, stage_deadline: stageDeadline || undefined }),
    });
    const json = await res.json();
    if (!res.ok) { alert(json.error ?? "Failed to update stage."); return; }
    setNextStage(""); setStageNotes(""); setStageDeadline("");
    load();
  };

  const submitOpsReview = async (decision: "confirmed" | "rejected") => {
    if (decision === "rejected" && !opsReviewNotes.trim()) return;
    setSubmittingOpsReview(true);
    try {
      const res = await fetch(`/api/cases/${caseId}/ops-review`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, notes: opsReviewNotes || undefined }),
      });
      const json = await res.json();
      if (!res.ok) { alert(json.error?.message ?? "Failed to save review."); return; }
      setOpsReviewNotes("");
      setShowOpsRejectForm(false);
      load();
    } finally {
      setSubmittingOpsReview(false);
    }
  };

  const submitCaseReject = async () => {
    if (!caseRejectReason.trim()) return;
    setSubmittingCaseReject(true);
    try {
      const res = await fetch(`/api/cases/${caseId}/reject`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: caseRejectReason }),
      });
      const json = await res.json();
      if (!res.ok) { alert(json.error?.message ?? "Failed to reject case."); return; }
      setCaseRejectReason("");
      setShowCaseRejectForm(false);
      load();
    } finally {
      setSubmittingCaseReject(false);
    }
  };

  const generateContract = async () => {
    if (!contractContent.trim()) return;
    const res = await fetch(`/api/cases/${caseId}/contract`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: contractContent }),
    });
    const json = await res.json();
    if (!res.ok) { alert(json.error ?? "Failed to generate contract."); return; }
    setContractContent("");
    load();
  };

  const recordPayment = async () => {
    const amount = Number(payAmount);
    if (!amount || amount <= 0) return;
    const res = await fetch(`/api/cases/${caseId}/payments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: payType,
        amount,
        receipt_reference: payReceipt || undefined,
        receipt_document_id: payReceiptDocumentId || undefined,
      }),
    });
    const json = await res.json();
    if (!res.ok) { alert(json.error ?? "Failed to record payment."); return; }
    setPayAmount(""); setPayReceipt(""); setPayReceiptDocumentId(null);
    load();
  };

  // Uploads immediately on file selection (rather than waiting for
  // "Record") so the receipt is already attached — a real file, not just
  // a typed reference — by the time staff clicks Record. The one
  // realistic path for a partner/recruiter-sourced payment, which never
  // goes through Stripe on this platform at all.
  const uploadPaymentReceipt = async (file: File) => {
    setUploadingReceipt(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch(`/api/upload?type=${paymentReceiptTypeKey(payType)}&candidate_id=${data.application.candidate.id}`, {
        method: "POST",
        body: formData,
      });
      const json = await res.json();
      if (!res.ok) { alert(json.error ?? "Receipt upload failed."); return; }
      setPayReceiptDocumentId(json.documentId);
    } finally {
      setUploadingReceipt(false);
    }
  };

  // Only meaningful for a Job-linked case (a general-programme application
  // has no pre-provisioned Stripe pricing to reference) — the button is
  // disabled with an explanatory tooltip otherwise, and the always-working
  // manual "Record" form above stays the fallback either way.
  const generatePaymentLink = async () => {
    setGeneratingLink(true);
    setLinkError("");
    try {
      const res = await fetch(`/api/cases/${caseId}/payments/link`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: linkType, recipient: linkRecipient }),
      });
      const json = await res.json();
      if (!res.ok) { setLinkError(json.error?.message ?? "Failed to generate payment link."); return; }
      load();
    } finally {
      setGeneratingLink(false);
    }
  };

  const copyPaymentLink = (url: string) => {
    navigator.clipboard.writeText(url);
  };

  // Manual fallback for when the Stripe webhook never fires (or fails, or
  // is just late) but a candidate/partner reports they've already paid —
  // looks up completed Checkout Sessions directly against the payment's
  // own Payment Link, so it works with zero dependency on the webhook
  // having delivered anything.
  const checkPaymentStatus = async (paymentId: string) => {
    setCheckingPaymentId(paymentId);
    try {
      const res = await fetch(`/api/cases/${caseId}/payments/${paymentId}/check-status`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) { alert(json.error?.message ?? "Failed to check payment status."); return; }
      if (json.message) alert(json.message);
      load();
    } finally {
      setCheckingPaymentId("");
    }
  };

  // Uploads immediately on file selection, same pattern used throughout
  // this component (the Record form's receipt, Mark as Paid's receipt).
  const uploadInvoiceFile = async (file: File) => {
    setUploadingInvoiceFile(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch(`/api/upload?type=${paymentReceiptTypeKey(invoiceType)}&candidate_id=${data.application.candidate.id}`, {
        method: "POST",
        body: formData,
      });
      const json = await res.json();
      if (!res.ok) { alert(json.error ?? "Invoice upload failed."); return; }
      setInvoiceDocumentId(json.documentId);
    } finally {
      setUploadingInvoiceFile(false);
    }
  };

  // Emails the uploaded invoice file for the amount Finance enters here —
  // works regardless of candidate.source (unlike Send Payment Link, which
  // is self-applicant-only), since this is the off-Stripe fallback for
  // everyone: always the only real option for partner/recruiter-sourced
  // cases, and a stand-in for a self-applicant case when Stripe itself
  // isn't available.
  const sendInvoice = async () => {
    const amount = Number(invoiceAmount);
    if (!amount || amount <= 0 || !invoiceDocumentId) return;
    setSendingInvoice(true);
    setInvoiceError("");
    try {
      const res = await fetch(`/api/cases/${caseId}/payments/invoice`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: invoiceType,
          amount,
          recipient: invoiceRecipient,
          invoice_document_id: invoiceDocumentId,
          invoice_reference: invoiceReference || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) { setInvoiceError(json.error?.message ?? "Failed to send invoice."); return; }
      setInvoiceAmount("");
      setInvoiceReference("");
      setInvoiceDocumentId(null);
      load();
    } finally {
      setSendingInvoice(false);
    }
  };

  // Uploads immediately on file selection, same pattern as the Record
  // form's receipt field — the file is attached to the candidate, not the
  // payment directly (Document has no direct case-payment link of its own
  // until mark-paid saves the id onto CasePayment.receipt_document_id).
  const uploadMarkPaidReceipt = async (paymentId: string, file: File) => {
    setUploadingMarkPaidReceiptFor(paymentId);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const milestoneType = (data.payments.find((p) => p.id === paymentId)?.type ?? "documentation") as "documentation" | "permit" | "visa";
      const res = await fetch(`/api/upload?type=${paymentReceiptTypeKey(milestoneType)}&candidate_id=${data.application.candidate.id}`, {
        method: "POST",
        body: formData,
      });
      const json = await res.json();
      if (!res.ok) { alert(json.error ?? "Receipt upload failed."); return; }
      setMarkPaidReceiptId((prev) => ({ ...prev, [paymentId]: json.documentId }));
    } finally {
      setUploadingMarkPaidReceiptFor("");
    }
  };

  // The bank-transfer equivalent of checkPaymentStatus above — an emailed
  // invoice has no webhook to reconcile against, so this is a direct
  // manual confirmation once Finance sees the funds actually land, backed
  // by a real uploaded receipt rather than nothing at all.
  const markAsPaid = async (paymentId: string) => {
    const receiptDocumentId = markPaidReceiptId[paymentId];
    if (!receiptDocumentId) return;
    setMarkingPaidId(paymentId);
    try {
      const res = await fetch(`/api/cases/${caseId}/payments/${paymentId}/mark-paid`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ receipt_document_id: receiptDocumentId }),
      });
      const json = await res.json();
      if (!res.ok) { alert(json.error?.message ?? "Failed to mark payment as paid."); return; }
      setMarkPaidReceiptId((prev) => {
        const next = { ...prev };
        delete next[paymentId];
        return next;
      });
      load();
    } finally {
      setMarkingPaidId("");
    }
  };

  // Swaps an already-attached invoice/receipt for a freshly-uploaded file
  // (2026-08-16) — uploads first (same /api/upload pipeline every other
  // attachment here uses), then points the payment at the new document.
  const replacePaymentReceipt = async (paymentId: string, file: File) => {
    setReplacingReceiptFor(paymentId);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const milestoneType = (data.payments.find((p) => p.id === paymentId)?.type ?? "documentation") as "documentation" | "permit" | "visa";
      const uploadRes = await fetch(`/api/upload?type=${paymentReceiptTypeKey(milestoneType)}&candidate_id=${data.application.candidate.id}`, {
        method: "POST",
        body: formData,
      });
      const uploadJson = await uploadRes.json();
      if (!uploadRes.ok) { alert(uploadJson.error ?? "Upload failed."); return; }
      const res = await fetch(`/api/cases/${caseId}/payments/${paymentId}/receipt`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ receipt_document_id: uploadJson.documentId }),
      });
      const json = await res.json();
      if (!res.ok) { alert(json.error?.message ?? "Failed to replace attachment."); return; }
      load();
    } finally {
      setReplacingReceiptFor("");
    }
  };

  const deletePaymentReceipt = async (paymentId: string) => {
    if (!confirm("Remove this attachment? This cannot be undone.")) return;
    setDeletingReceiptFor(paymentId);
    try {
      const res = await fetch(`/api/cases/${caseId}/payments/${paymentId}/receipt`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ receipt_document_id: null }),
      });
      const json = await res.json();
      if (!res.ok) { alert(json.error?.message ?? "Failed to remove attachment."); return; }
      load();
    } finally {
      setDeletingReceiptFor("");
    }
  };

  const completeRetention = async () => {
    const res = await fetch(`/api/cases/${caseId}/retention`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const json = await res.json();
    if (!res.ok) { alert(json.error ?? "Failed to complete follow-up."); return; }
    load();
  };

  const sendReminder = async () => {
    setSendingReminder(true);
    setReminderError("");
    setReminderSent(false);
    try {
      const res = await fetch(`/api/cases/${caseId}/remind`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel: reminderChannel, recipient: reminderRecipient, message: reminderMessage || undefined }),
      });
      const json = await res.json();
      if (!res.ok) { setReminderError(json.error?.message ?? json.error ?? "Failed to send reminder."); return; }
      setReminderMessage("");
      setReminderSent(true);
      load();
    } finally {
      setSendingReminder(false);
    }
  };

  const saveNotes = async () => {
    setSavingNotes(true);
    try {
      const res = await fetch(`/api/applications/${data!.application.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ internal_notes: notesDraft }),
      });
      const json = await res.json();
      if (!res.ok) { alert(json.error ?? "Failed to save notes."); return; }
      setEditingNotes(false);
      load();
    } finally {
      setSavingNotes(false);
    }
  };

  const uploadDocumentType = async (type: string, file: File | null, onDone: () => void) => {
    if (!file) return;
    setUploadingType(type);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch(`/api/upload?type=${type}&candidate_id=${data.application.candidate.id}`, {
        method: "POST",
        body: formData,
      });
      const json = await res.json();
      if (!res.ok) { alert(json.error ?? "Upload failed."); return; }
      onDone();
      load();
    } finally {
      setUploadingType(null);
    }
  };

  const uploadDocument = () => uploadDocumentType(uploadType, uploadFile, () => setUploadFile(null));

  return (
    <div className="space-y-6">
      {data.status === "rejected" && (
        <div className="bg-red-50 border border-red-200 text-red-800 rounded-lg p-4">
          <p className="text-sm font-semibold">
            Case rejected{data.rejected_by && <> by {data.rejected_by.full_name}</>}{data.rejected_at && <> on {new Date(data.rejected_at).toLocaleDateString()}</>}
          </p>
          {data.rejection_reason && <p className="text-sm mt-1">{data.rejection_reason}</p>}
        </div>
      )}

      <div className="card p-6">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="text-xl font-semibold text-midnight-900">{candidateName}</h2>
            <p className="text-sm text-midnight-900/50">
              {data.application.job
                ? <>{data.application.job.title} · {data.application.job.city}, {data.application.job.country}</>
                : <>{data.application.preferred_sector?.name ?? "General Programme"}{data.application.preferred_country_1 && <> · {data.application.preferred_country_1.name}</>}</>}
              {data.application.candidate.recruiter && <> · {data.application.candidate.recruiter.full_name}</>}
              {data.application.candidate.partner && <> · Partner: {data.application.candidate.partner.name}</>}
            </p>
          </div>
          {capabilities.rejectCase && data.status !== "rejected" && (
            <div>
              {showCaseRejectForm ? (
                <div className="w-64 space-y-1.5">
                  <textarea
                    value={caseRejectReason}
                    onChange={(e) => setCaseRejectReason(e.target.value)}
                    rows={2}
                    className="input-field text-xs w-full resize-none"
                    placeholder="Why is this case being rejected?"
                  />
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={submittingCaseReject || !caseRejectReason.trim()}
                      onClick={submitCaseReject}
                      className="text-xs font-semibold text-red-600 hover:underline disabled:opacity-50"
                    >
                      {submittingCaseReject ? "Rejecting…" : "Confirm Reject Case"}
                    </button>
                    <button type="button" onClick={() => { setShowCaseRejectForm(false); setCaseRejectReason(""); }} className="text-xs text-midnight-900/40 hover:underline">
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button type="button" onClick={() => setShowCaseRejectForm(true)} className="text-xs font-semibold text-red-600 hover:underline">
                  Reject Case
                </button>
              )}
            </div>
          )}
        </div>
        <CaseStageProgress stage={data.current_stage} />

        {capabilities.advanceStage && data.status !== "rejected" && (
          <>
            <div className="mt-6 pt-6 border-t border-midnight-900/10 grid sm:grid-cols-3 gap-3">
              <SearchableSelect
                value={nextStage}
                onChange={setNextStage}
                placeholder="Set stage…"
                options={CASE_STAGE_ORDER.filter((s) => s !== data.current_stage).map((s) => ({ value: s, label: CASE_STAGE_LABELS[s] }))}
              />
              <input type="date" value={stageDeadline} onChange={(e) => setStageDeadline(e.target.value)} className="input-field text-sm" placeholder="Deadline (optional)" />
              <input value={stageNotes} onChange={(e) => setStageNotes(e.target.value)} className="input-field text-sm" placeholder="Notes (optional)" />
            </div>
            <button onClick={advanceStage} disabled={!nextStage} className="btn-primary mt-3 text-xs disabled:opacity-40">Update Stage</button>
          </>
        )}

        <div className="mt-6 pt-6 border-t border-midnight-900/10 space-y-3">
          <h3 className="text-xs font-semibold text-midnight-900/50 uppercase tracking-wider mb-2">Stage History</h3>
          {data.stage_events.map((e) => (
            <div key={e.id} className="text-sm border-l-2 border-midnight-900/10 pl-3">
              <div className="text-midnight-900/70 font-medium">{CASE_STAGE_LABELS[e.stage]}</div>
              <div className="text-midnight-900/45 text-xs mt-0.5">
                {new Date(e.entered_at).toLocaleDateString()}
                {e.completed_at && <> → {new Date(e.completed_at).toLocaleDateString()}</>}
                {e.owner && <> · {e.owner.full_name}</>}
              </div>
              {e.notes && <div className="text-midnight-900/60 text-xs mt-0.5">{e.notes}</div>}
            </div>
          ))}
        </div>
      </div>

      {(capabilities.manageOpsReview || data.ops_review_status !== "pending") && (
        <div className="card p-6">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-midnight-900/70 uppercase tracking-wider">Documentation Review</h3>
            <span
              className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ${
                data.ops_review_status === "confirmed"
                  ? "bg-emerald-100 text-emerald-800"
                  : data.ops_review_status === "rejected"
                  ? "bg-red-100 text-red-700"
                  : "bg-amber-100 text-amber-800"
              }`}
            >
              {data.ops_review_status === "confirmed" ? "Confirmed" : data.ops_review_status === "rejected" ? "Rejected" : "Pending"}
            </span>
          </div>
          <p className="text-xs text-midnight-900/45 mb-3">
            Operations/Director confirmation that the documentation is correct before the case's stage can move forward.
          </p>
          {data.ops_reviewed_by && data.ops_reviewed_at && (
            <p className="text-xs text-midnight-900/50 mb-2">
              {data.ops_review_status === "confirmed" ? "Confirmed" : "Reviewed"} by {data.ops_reviewed_by.full_name} on {new Date(data.ops_reviewed_at).toLocaleDateString()}
            </p>
          )}
          {data.ops_review_notes && <p className="text-sm text-midnight-900/70 mb-3">{data.ops_review_notes}</p>}

          {capabilities.manageOpsReview && data.status !== "rejected" && (
            showOpsRejectForm ? (
              <div className="space-y-2 max-w-md">
                <textarea
                  value={opsReviewNotes}
                  onChange={(e) => setOpsReviewNotes(e.target.value)}
                  rows={2}
                  className="input-field text-xs w-full resize-none"
                  placeholder="What's wrong with the documentation?"
                />
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    disabled={submittingOpsReview || !opsReviewNotes.trim()}
                    onClick={() => submitOpsReview("rejected")}
                    className="text-xs font-semibold text-red-600 hover:underline disabled:opacity-50"
                  >
                    {submittingOpsReview ? "Saving…" : "Confirm Reject"}
                  </button>
                  <button type="button" onClick={() => { setShowOpsRejectForm(false); setOpsReviewNotes(""); }} className="text-xs text-midnight-900/40 hover:underline">
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  disabled={submittingOpsReview}
                  onClick={() => submitOpsReview("confirmed")}
                  className="text-xs font-semibold text-emerald-600 hover:underline disabled:opacity-50"
                >
                  Confirm Documentation
                </button>
                <button type="button" onClick={() => setShowOpsRejectForm(true)} className="text-xs font-semibold text-red-600 hover:underline">
                  Reject
                </button>
              </div>
            )
          )}
        </div>
      )}

      {(data.application.cover_letter || data.application.internal_notes || capabilities.manageContract || capabilities.advanceStage) && (
        <div className="card p-6">
          <h3 className="text-sm font-semibold text-midnight-900/70 uppercase tracking-wider mb-4">Application</h3>
          {data.application.cover_letter && (
            <div className="mb-4">
              <div className="text-[11px] text-midnight-900/40 uppercase tracking-wider mb-1">Cover Letter</div>
              <p className="text-sm text-midnight-900/80 whitespace-pre-wrap">{data.application.cover_letter}</p>
            </div>
          )}
          <div>
            <div className="flex items-center justify-between mb-1">
              <div className="text-[11px] text-midnight-900/40 uppercase tracking-wider">Internal Notes</div>
              {(capabilities.manageContract || capabilities.advanceStage) && !editingNotes && (
                <button onClick={() => setEditingNotes(true)} className="text-xs text-gold-600 hover:underline">
                  {data.application.internal_notes ? "Edit" : "Add notes"}
                </button>
              )}
            </div>
            {editingNotes ? (
              <div className="space-y-2">
                <textarea
                  value={notesDraft}
                  onChange={(e) => setNotesDraft(e.target.value)}
                  rows={3}
                  className="input-field text-sm w-full resize-none"
                  placeholder="Notes visible to staff only…"
                />
                <div className="flex items-center gap-2">
                  <button onClick={saveNotes} disabled={savingNotes} className="btn-primary text-xs disabled:opacity-60">
                    {savingNotes ? "Saving…" : "Save"}
                  </button>
                  <button onClick={() => { setEditingNotes(false); setNotesDraft(data.application.internal_notes ?? ""); }} className="btn-secondary text-xs">
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <p className="text-sm text-midnight-900/80 whitespace-pre-wrap">{data.application.internal_notes || "—"}</p>
            )}
          </div>
        </div>
      )}

      <div className="card p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-midnight-900/70 uppercase tracking-wider">Personal Information</h3>
          {capabilities.editApplication && (
            <CandidateEditDetails
              candidateId={data.application.candidate.id}
              initial={{
                full_name: data.application.candidate.full_name,
                nationality: data.application.candidate.nationality,
                phone: data.application.candidate.phone,
                date_of_birth: data.application.candidate.date_of_birth,
                passport_number: data.application.candidate.passport_number,
                email: data.application.candidate.email,
                desired_role: data.application.candidate.desired_role,
                second_nationality: data.application.candidate.second_nationality,
                gender: data.application.candidate.gender,
                passport_expiry: data.application.candidate.passport_expiry,
                current_occupation: data.application.candidate.current_occupation,
                highest_education: data.application.candidate.highest_education,
                home_address: data.application.candidate.home_address,
                whatsapp_number: data.application.candidate.whatsapp_number,
                marital_status: data.application.candidate.marital_status,
              }}
              onSaved={load}
            />
          )}
        </div>
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Email" value={data.application.candidate.user?.email ?? data.application.candidate.email} />
          <Field label="WhatsApp" value={data.application.candidate.whatsapp_number} />
          <Field label="Nationality" value={data.application.candidate.nationality} />
          <Field label="Second Nationality" value={data.application.candidate.second_nationality} />
          <Field
            label="Gender"
            value={data.application.candidate.gender ? data.application.candidate.gender[0].toUpperCase() + data.application.candidate.gender.slice(1) : null}
          />
          <Field label="Date of Birth" value={data.application.candidate.date_of_birth ? new Date(data.application.candidate.date_of_birth).toLocaleDateString() : null} />
          <Field label="Passport Number" value={data.application.candidate.passport_number} />
          <Field label="Passport Expiry" value={data.application.candidate.passport_expiry ? new Date(data.application.candidate.passport_expiry).toLocaleDateString() : null} />
          <Field label="Current Occupation" value={data.application.candidate.current_occupation} />
          <Field label="Highest Education" value={data.application.candidate.highest_education} />
          <Field label="Marital Status" value={data.application.candidate.marital_status} />
          <Field label="Home Address" value={data.application.candidate.home_address} />
        </div>
      </div>

      <div className="card p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-midnight-900/70 uppercase tracking-wider">Visa &amp; Travel Readiness</h3>
          {capabilities.editApplication && (
            <ApplicationEditDetails
              candidateId={data.application.candidate.id}
              initial={{
                job_id: data.application.job_id,
                earliest_travel_date: data.application.earliest_travel_date,
                current_location_country_name: data.application.current_location_country_name,
                prior_eu_visa_applied: data.application.prior_eu_visa_applied,
                prior_eu_visa_applied_details: data.application.prior_eu_visa_applied_details,
                holds_schengen_visa: data.application.holds_schengen_visa,
                holds_schengen_visa_details: data.application.holds_schengen_visa_details,
                prior_visa_refusals: data.application.prior_visa_refusals,
                prior_visa_refusals_details: data.application.prior_visa_refusals_details,
                available_for_embassy_appointment: data.application.available_for_embassy_appointment,
                willing_to_start_within_30_days: data.application.willing_to_start_within_30_days,
                preferred_contact_channel: data.application.preferred_contact_channel,
              }}
              onSaved={load}
            />
          )}
        </div>
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Earliest Travel Date" value={data.application.earliest_travel_date ? new Date(data.application.earliest_travel_date).toLocaleDateString() : null} />
          <Field label="Current Location" value={data.application.current_location_country_name} />
          <Field label="Prior EU Visa Applied" value={yesNoWithDetail(data.application.prior_eu_visa_applied, data.application.prior_eu_visa_applied_details)} />
          <Field label="Holds Schengen Visa" value={yesNoWithDetail(data.application.holds_schengen_visa, data.application.holds_schengen_visa_details)} />
          <Field label="Prior Visa Refusals" value={yesNoWithDetail(data.application.prior_visa_refusals, data.application.prior_visa_refusals_details)} />
          <Field label="Available for Embassy Appointment" value={data.application.available_for_embassy_appointment ? "Yes" : "No"} />
          <Field label="Willing to Start Within 30 Days" value={data.application.willing_to_start_within_30_days ? "Yes" : "No"} />
          <Field label="Preferred Contact Channel" value={data.application.preferred_contact_channel} />
        </div>
      </div>

      <div className="card p-6">
        <h3 className="text-sm font-semibold text-midnight-900/70 uppercase tracking-wider mb-4">Documents (SRS FR-4.6)</h3>
        <div className="space-y-2 mb-4">
          {/* Payment receipts are managed from the Milestone Payments card
              below (its own Replace/Delete, tied to one specific
              CasePayment) — they're proof of a payment already recorded by
              Finance, not something needing a separate Verify/Reject
              workflow, so they're excluded here rather than shown twice
              with a verification control that doesn't mean anything for
              them (2026-08-19). */}
          {(() => {
            const nonPaymentDocs = data.application.candidate.documents.filter(
              (d) => !(PAYMENT_RECEIPT_TYPE_KEYS as readonly string[]).includes(d.type)
            );
            if (nonPaymentDocs.length === 0) return <p className="text-sm text-midnight-900/40">No documents uploaded yet.</p>;
            return nonPaymentDocs.map((d) => (
              <div key={d.id} className="flex items-center justify-between text-sm border-b border-midnight-900/5 pb-2">
                <DocumentLink documentId={d.id} label={d.type} className="text-gold-600 hover:underline capitalize" />
                <DocumentVerifyControls documentId={d.id} initialStatus={d.verification_status} />
              </div>
            ));
          })()}
        </div>
        {capabilities.manageDocuments && (
          <div className="flex items-center gap-2 pt-3 border-t border-midnight-900/10">
            <SearchableSelect
              value={uploadType}
              onChange={setUploadType}
              className="w-auto"
              options={docTypes.map((t) => ({ value: t.key, label: t.label }))}
            />
            <input type="file" onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)} className="text-sm" />
            <button onClick={uploadDocument} disabled={!uploadFile} className="btn-primary text-xs disabled:opacity-40">Upload</button>
          </div>
        )}
      </div>

      {capabilities.manageWorkPermit ? (
        <div className="card p-6">
          <h3 className="text-sm font-semibold text-midnight-900/70 uppercase tracking-wider mb-4">Work Permit</h3>
          {(() => {
            const workPermit = data.application.candidate.documents.find((d) => d.type === "issued_work_permit");
            return (
              <div className="space-y-3">
                {workPermit ? (
                  <div className="flex items-center justify-between text-sm border-b border-midnight-900/5 pb-2">
                    <DocumentLink documentId={workPermit.id} label="Issued Work Permit" className="text-gold-600 hover:underline" />
                    <span className="text-xs text-midnight-900/40">Delivered {new Date(workPermit.uploaded_at).toLocaleDateString()}</span>
                  </div>
                ) : (
                  <p className="text-sm text-midnight-900/40">Not delivered yet.</p>
                )}
                <div className="flex items-center gap-2 pt-1">
                  <input
                    type="file"
                    accept="application/pdf,image/*"
                    onChange={(e) => setWorkPermitFile(e.target.files?.[0] ?? null)}
                    className="text-sm flex-1"
                  />
                  <button
                    onClick={() => uploadDocumentType("issued_work_permit", workPermitFile, () => setWorkPermitFile(null))}
                    disabled={!workPermitFile || uploadingType === "issued_work_permit"}
                    className="btn-primary text-xs px-3 py-1.5 disabled:opacity-40"
                  >
                    {uploadingType === "issued_work_permit" ? "Uploading…" : workPermit ? "Replace" : "Upload"}
                  </button>
                </div>
              </div>
            );
          })()}
        </div>
      ) : (
        <div className="card p-6">
          <h3 className="text-sm font-semibold text-midnight-900/70 uppercase tracking-wider mb-4">Contract (SRS FR-4.3)</h3>
          {data.contract ? (
            <div className="space-y-3">
              <span className={`badge-${data.contract.status === "signed" ? "approved" : "pending"} capitalize`}>{data.contract.status}</span>
              <pre className="text-xs bg-ivory-100 rounded-lg p-4 whitespace-pre-wrap max-h-60 overflow-y-auto">{data.contract.content}</pre>
              {data.contract.signed_at && (
                <p className="text-xs text-midnight-900/50">Signed by {data.contract.signed_by_name} on {new Date(data.contract.signed_at).toLocaleString()}</p>
              )}
            </div>
          ) : !capabilities.manageContract ? (
            <p className="text-sm text-midnight-900/40">No contract issued yet.</p>
          ) : (
            <div className="space-y-3">
              <p className="text-xs text-midnight-900/45">
                Generates a contract the candidate can sign from their own dashboard (a real, typed-attestation e-signature — the paid vendor integration is Phase 5).
              </p>
              <textarea
                value={contractContent}
                onChange={(e) => setContractContent(e.target.value)}
                rows={5}
                className="input-field text-sm resize-none"
                placeholder={`Offer of employment for ${data.application.job?.title ?? data.application.preferred_sector?.name ?? "the candidate's programme"}...`}
              />
              <button onClick={generateContract} disabled={!contractContent.trim()} className="btn-primary text-xs disabled:opacity-40">Issue Contract</button>
            </div>
          )}
        </div>
      )}

      <div className="card p-6">
        <h3 className="text-sm font-semibold text-midnight-900/70 uppercase tracking-wider mb-4">Milestone Payments (SRS FR-4.5)</h3>
        {!feeEnabled ? (
          <p className="text-xs text-midnight-900/45">Milestone payments are not enabled for this destination. In-House can enable this under Fee Policy.</p>
        ) : (
          <>
            <div className="space-y-2 mb-4">
              {data.payments.length === 0 && <p className="text-sm text-midnight-900/40">No payments recorded yet.</p>}
              {data.payments.map((p) => (
                <div key={p.id} className="flex flex-col gap-1 text-sm border-b border-midnight-900/5 pb-2">
                  <div className="flex items-center justify-between">
                    <span className="capitalize text-midnight-900">
                      {p.type}: {p.currency} {p.amount.toLocaleString()}
                      <span className={`ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide ${p.status === "collected" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
                        {p.status}
                      </span>
                    </span>
                    <span className="text-midnight-900/45 text-xs flex items-center gap-1.5">
                      {p.receipt_document_id ? (
                        <>
                          <DocumentLink
                            documentId={p.receipt_document_id}
                            label={p.status === "pending" ? "Invoice" : "Receipt"}
                            className="text-gold-600 hover:underline"
                          />
                          {p.receipt_reference && <span>· {p.receipt_reference}</span>}
                          {capabilities.managePayments && (
                            <>
                              <label className="text-midnight-900/45 hover:text-gold-600 hover:underline cursor-pointer">
                                {replacingReceiptFor === p.id ? "Replacing…" : "Replace"}
                                <input
                                  type="file"
                                  accept="application/pdf,image/*"
                                  className="hidden"
                                  disabled={replacingReceiptFor === p.id}
                                  onChange={(e) => {
                                    const file = e.target.files?.[0] ?? null;
                                    if (file) replacePaymentReceipt(p.id, file);
                                  }}
                                />
                              </label>
                              <button
                                type="button"
                                onClick={() => deletePaymentReceipt(p.id)}
                                disabled={deletingReceiptFor === p.id}
                                className="text-red-600 hover:underline disabled:opacity-50"
                              >
                                {deletingReceiptFor === p.id ? "Removing…" : "Delete"}
                              </button>
                            </>
                          )}
                        </>
                      ) : (
                        <>
                          <span>{p.receipt_reference ?? p.sent_to_email ?? "—"}</span>
                          {/* A payment already marked collected but with no
                              receipt_document_id (2026-08-19) — mainly the
                              older rows caught by the now-fixed
                              cross-stage-clobbering bug, whose receipt got
                              silently nulled out before this fix shipped.
                              Lets Finance attach the correct receipt
                              retroactively, same upload path as Replace. */}
                          {capabilities.managePayments && p.status === "collected" && (
                            <label className="text-midnight-900/45 hover:text-gold-600 hover:underline cursor-pointer">
                              {replacingReceiptFor === p.id ? "Attaching…" : "Attach receipt"}
                              <input
                                type="file"
                                accept="application/pdf,image/*"
                                className="hidden"
                                disabled={replacingReceiptFor === p.id}
                                onChange={(e) => {
                                  const file = e.target.files?.[0] ?? null;
                                  if (file) replacePaymentReceipt(p.id, file);
                                }}
                              />
                            </label>
                          )}
                        </>
                      )}
                      · {p.recorder.full_name}
                    </span>
                  </div>
                  {p.status === "pending" && p.stripe_payment_link_url && (
                    <div className="flex items-center gap-2">
                      <code className="text-[11px] bg-ivory-100 rounded px-2 py-1 truncate max-w-xs">{p.stripe_payment_link_url}</code>
                      <button onClick={() => copyPaymentLink(p.stripe_payment_link_url!)} className="text-[11px] text-gold-600 hover:underline">Copy</button>
                      {capabilities.managePayments && (
                        <button
                          onClick={() => checkPaymentStatus(p.id)}
                          disabled={checkingPaymentId === p.id}
                          className="text-[11px] text-midnight-900/50 hover:text-gold-600 hover:underline disabled:opacity-50"
                          title="Check Stripe directly — useful if the candidate/partner says they've already paid but this still shows pending"
                        >
                          {checkingPaymentId === p.id ? "Checking…" : "Check Status"}
                        </button>
                      )}
                    </div>
                  )}
                  {p.status === "pending" && !p.stripe_payment_link_url && capabilities.managePayments && (
                    <div className="flex items-center gap-3 flex-wrap bg-ivory-100 rounded-lg px-3 py-2">
                      <span className="text-[11px] text-midnight-900/55">
                        A receipt is required to confirm this was paid —
                      </span>
                      <label className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-gold-600 hover:underline cursor-pointer">
                        <UploadSimple size={12} weight="bold" />
                        {markPaidReceiptId[p.id] ? "Replace receipt" : "Attach receipt"}
                        <input
                          type="file"
                          accept="application/pdf,image/*"
                          className="hidden"
                          onChange={(e) => {
                            const file = e.target.files?.[0] ?? null;
                            if (file) uploadMarkPaidReceipt(p.id, file);
                          }}
                        />
                      </label>
                      {uploadingMarkPaidReceiptFor === p.id && (
                        <span className="text-[11px] text-midnight-900/45">Uploading…</span>
                      )}
                      {uploadingMarkPaidReceiptFor !== p.id && markPaidReceiptId[p.id] && (
                        <span className="text-[11px] text-emerald-700 font-semibold">✓ Receipt attached</span>
                      )}
                      <button
                        onClick={() => markAsPaid(p.id)}
                        disabled={markingPaidId === p.id || !markPaidReceiptId[p.id]}
                        className="btn-primary text-[11px] px-3 py-1.5 disabled:opacity-40"
                        title={!markPaidReceiptId[p.id] ? "Attach a receipt first" : undefined}
                      >
                        {markingPaidId === p.id ? "Marking…" : "Mark as Paid"}
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
            {capabilities.managePayments && (
              <>
                <div className="flex items-center gap-2 pt-3 border-t border-midnight-900/10">
                  <SearchableSelect
                    value={payType}
                    onChange={(value) => setPayType(value as "documentation" | "permit" | "visa")}
                    className="w-auto"
                    options={[
                      { value: "documentation", label: "Documentation (Stage 1 · 25%)" },
                      { value: "permit", label: "Work Permit (Stage 2 · 25%)" },
                      { value: "visa", label: "Visa (Stage 3 · 50%)" },
                    ]}
                  />
                  <input type="number" min="0" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} className="input-field text-sm w-28" placeholder="Amount" />
                  <input value={payReceipt} onChange={(e) => setPayReceipt(e.target.value)} className="input-field text-sm" placeholder="Receipt reference" />
                  <label className="text-[11px] text-midnight-900/50 flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="file"
                      accept="application/pdf,image/*"
                      onChange={(e) => {
                        const file = e.target.files?.[0] ?? null;
                        if (file) uploadPaymentReceipt(file);
                      }}
                      className="text-xs w-32"
                    />
                    {uploadingReceipt && "Uploading…"}
                    {!uploadingReceipt && payReceiptDocumentId && "✓ Receipt attached"}
                  </label>
                  <button onClick={recordPayment} disabled={!payAmount} className="btn-primary text-xs disabled:opacity-40">Record</button>
                </div>

                {/* Stripe restricted to self-applicants (2026-07-31) —
                    partner/recruiter-sourced payments never go through
                    Stripe on this platform; Record above (with a real
                    receipt upload) is their only path. */}
                {data.application.candidate.source === "self_registered" && (
                  <div className="flex items-center gap-2 pt-3 mt-3 border-t border-midnight-900/10">
                    <SearchableSelect
                      value={linkType}
                      onChange={(value) => setLinkType(value as "documentation" | "permit" | "visa")}
                      className="w-auto"
                      options={[
                        { value: "documentation", label: "Documentation (Stage 1 · 25%)" },
                        { value: "permit", label: "Work Permit (Stage 2 · 25%)" },
                        { value: "visa", label: "Visa (Stage 3 · 50%)" },
                      ]}
                    />
                    <SearchableSelect
                      value={linkRecipient}
                      onChange={(value) => setLinkRecipient(value as "candidate" | "partner")}
                      className="w-auto"
                      options={[{ value: "candidate", label: "Send to Candidate" }]}
                    />
                    <button
                      onClick={generatePaymentLink}
                      disabled={generatingLink || !data.application.job}
                      title={!data.application.job ? "This case has no linked opportunity — no Stripe pricing to link to. Use Record instead." : undefined}
                      className="btn-primary text-xs disabled:opacity-40"
                    >
                      {generatingLink ? "Sending…" : "Send Payment Link"}
                    </button>
                  </div>
                )}
                {linkError && <p className="text-xs text-red-500 mt-1.5">{linkError}</p>}

                {/* Emailed invoice (2026-08-04) — the off-Stripe fallback.
                    The invoice itself is a real file Finance already
                    generated elsewhere (bank/Wise, Stripe Invoicing, etc.)
                    and attaches here; this app never generates one.
                    Always available regardless of candidate.source: the
                    only real option for partner/recruiter-sourced cases,
                    and a stand-in for a self-applicant when Stripe itself
                    isn't available. */}
                <div className="pt-3 mt-3 border-t border-midnight-900/10">
                  <div className="text-xs font-semibold text-midnight-900/70 mb-2">Send Invoice</div>
                  <div className="flex items-center gap-2 flex-wrap mb-2">
                    <SearchableSelect
                      value={invoiceType}
                      onChange={(value) => setInvoiceType(value as "documentation" | "permit" | "visa")}
                      className="w-auto"
                      options={[
                        { value: "documentation", label: "Documentation (Stage 1)" },
                        { value: "permit", label: "Work Permit (Stage 2)" },
                        { value: "visa", label: "Visa (Stage 3)" },
                      ]}
                    />
                    <input
                      type="number"
                      min="0"
                      value={invoiceAmount}
                      onChange={(e) => setInvoiceAmount(e.target.value)}
                      className="input-field text-sm w-28"
                      placeholder="Amount due"
                    />
                    <SearchableSelect
                      value={invoiceRecipient}
                      onChange={(value) => setInvoiceRecipient(value as "candidate" | "partner")}
                      className="w-auto"
                      options={[
                        { value: "candidate", label: "Invoice Candidate" },
                        ...(data.application.candidate.partner_id ? [{ value: "partner", label: "Invoice Partner" }] : []),
                      ]}
                    />
                    <input
                      value={invoiceReference}
                      onChange={(e) => setInvoiceReference(e.target.value)}
                      className="input-field text-sm"
                      placeholder="Invoice number (optional)"
                    />
                  </div>
                  <div className="flex items-center gap-3 flex-wrap bg-ivory-100 rounded-lg px-3 py-2">
                    <span className="text-[11px] text-midnight-900/55">Attach the invoice file to send —</span>
                    <label className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-gold-600 hover:underline cursor-pointer">
                      <UploadSimple size={12} weight="bold" />
                      {invoiceDocumentId ? "Replace invoice file" : "Attach invoice file"}
                      <input
                        type="file"
                        accept="application/pdf,image/*"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0] ?? null;
                          if (file) uploadInvoiceFile(file);
                        }}
                      />
                    </label>
                    {uploadingInvoiceFile && <span className="text-[11px] text-midnight-900/45">Uploading…</span>}
                    {!uploadingInvoiceFile && invoiceDocumentId && (
                      <span className="text-[11px] text-emerald-700 font-semibold">✓ Invoice file attached</span>
                    )}
                    <button
                      onClick={sendInvoice}
                      disabled={sendingInvoice || !invoiceAmount || !invoiceDocumentId}
                      className="btn-primary text-[11px] px-3 py-1.5 disabled:opacity-40 ml-auto"
                      title={!invoiceDocumentId ? "Attach the invoice file first" : undefined}
                    >
                      {sendingInvoice ? "Sending…" : "Send Invoice"}
                    </button>
                  </div>
                </div>
                {invoiceError && <p className="text-xs text-red-500 mt-1.5">{invoiceError}</p>}
              </>
            )}
          </>
        )}
      </div>

      {data.retention_follow_up && (
        <div className="card p-6">
          <h3 className="text-sm font-semibold text-midnight-900/70 uppercase tracking-wider mb-4">90-Day Retention Follow-Up (SRS FR-4.7)</h3>
          <p className="text-sm text-midnight-900/70">Due {new Date(data.retention_follow_up.due_at).toLocaleDateString()}</p>
          {data.retention_follow_up.completed_at ? (
            <span className="badge-approved mt-2 inline-block">Completed</span>
          ) : !capabilities.manageRetention ? (
            <span className="text-xs text-midnight-900/40 mt-2 inline-block">Not yet completed</span>
          ) : (
            <button onClick={completeRetention} className="btn-primary text-xs mt-3">Mark Complete</button>
          )}
        </div>
      )}

      {capabilities.sendReminder && (
        <div className="card p-6">
          <h3 className="text-sm font-semibold text-midnight-900/70 uppercase tracking-wider mb-4">Send Reminder</h3>
          <p className="text-xs text-midnight-900/45 mb-4">
            A one-off email nudge for a delayed document or payment — not automated, sent when you decide it's needed.
          </p>
          <div className="flex items-center gap-2 mb-3">
            <SearchableSelect
              value={reminderChannel}
              onChange={(value) => setReminderChannel(value as "document" | "payment")}
              className="w-auto"
              options={[
                { value: "document", label: "Document delay" },
                { value: "payment", label: "Payment due" },
              ]}
            />
            <SearchableSelect
              value={reminderRecipient}
              onChange={(value) => setReminderRecipient(value as "candidate" | "partner")}
              className="w-auto"
              options={[
                { value: "candidate", label: "Remind Candidate" },
                ...(data.application.candidate.partner_id ? [{ value: "partner", label: "Remind Partner" }] : []),
              ]}
            />
          </div>
          <textarea
            value={reminderMessage}
            onChange={(e) => setReminderMessage(e.target.value)}
            rows={2}
            className="input-field text-sm w-full resize-none mb-3"
            placeholder="Optional custom message…"
          />
          <button onClick={sendReminder} disabled={sendingReminder} className="btn-primary text-xs disabled:opacity-40">
            {sendingReminder ? "Sending…" : "Send Reminder"}
          </button>
          {reminderSent && <p className="text-xs text-emerald-700 mt-2">Reminder sent.</p>}
          {reminderError && <p className="text-xs text-red-500 mt-2">{reminderError}</p>}
        </div>
      )}

      <div className="card p-6">
        <h3 className="text-sm font-semibold text-midnight-900/70 uppercase tracking-wider mb-4">Activity Log</h3>
        {activity.length === 0 ? (
          <p className="text-sm text-midnight-900/40">No activity recorded yet.</p>
        ) : (
          <div className="space-y-2">
            {activity.map((e) => (
              <div key={e.id} className="flex items-start gap-3 text-sm border-b border-midnight-900/5 pb-2 last:border-0">
                <div className="flex-1">
                  <span className="text-midnight-900">{e.summary}</span>
                  <div className="text-xs text-midnight-900/40 mt-0.5">
                    {e.actorName}
                    {e.actorRole && <span className="capitalize"> ({e.actorRole.replace(/_/g, " ")})</span>} · {new Date(e.timestamp).toLocaleString()}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
