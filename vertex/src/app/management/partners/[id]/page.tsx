"use client";

import { useEffect, useState, use } from "react";
import Link from "next/link";
import PortalShell from "@/components/portal/PortalShell";
import { MANAGEMENT_NAV_ITEMS } from "@/components/portal/managementNav";
import { useRouter } from "next/navigation";
import SearchableSelect from "@/components/SearchableSelect";
import Pagination from "@/components/Pagination";
import { usePagination } from "@/lib/usePagination";
import { formatCandidateLifecycleStatus } from "@/lib/candidateLifecycleStatus";
import { CheckCircle, PencilSimple, Trash, Key } from "@phosphor-icons/react";

const PARTNER_TYPE_LABELS: Record<string, string> = {
  travel_agency: "Travel Agency",
  visa_consultancy: "Visa Consultancy",
  manpower_supplier: "Manpower Supplier",
  other: "Other",
};

const STATUS_OPTIONS = ["pending", "active", "suspended"] as const;
const MOU_OPTIONS = ["none", "sent", "signed"] as const;

interface SourcedCandidateRow {
  id: string;
  full_name: string | null;
  lifecycle_status: string;
  created_at: string;
  user: { full_name: string; email: string } | null;
  recruiter: { id: string; full_name: string } | null;
}

interface PartnerDetail {
  id: string;
  name: string;
  partner_type: string;
  country_of_operation: string;
  business_registration_number: string | null;
  contact_name: string;
  contact_email: string;
  contact_phone: string;
  status: string;
  mou_status: string;
  mou_signed_at: string | null;
  notes: string | null;
  user_id: string | null;
  candidates: SourcedCandidateRow[];
}

// Partner detail (SRS FR-5.1): status/MOU controls and the candidates
// this partner has been bridged into Vertex's own pipeline for (empty
// until the future job-assignment/bridging step ships — the partner
// submits and manages its own candidates from its own portal).
const emptyDraft = {
  name: "",
  partner_type: "travel_agency",
  country_of_operation: "",
  business_registration_number: "",
  contact_name: "",
  contact_email: "",
  contact_phone: "",
  notes: "",
};

export default function PartnerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [partner, setPartner] = useState<PartnerDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [provisioning, setProvisioning] = useState(false);
  // Provisioning no longer hands back a temp password (2026-07-27) — an
  // invite email lets the partner set their own, so this is just the
  // address that invite went to, for the confirmation banner.
  const [inviteSentEmail, setInviteSentEmail] = useState<string | null>(null);
  const [editingDetails, setEditingDetails] = useState(false);
  const [detailsDraft, setDetailsDraft] = useState(emptyDraft);
  const [savingDetails, setSavingDetails] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [resettingPassword, setResettingPassword] = useState(false);
  const [passwordResetNotice, setPasswordResetNotice] = useState("");

  const load = () => {
    setLoading(true);
    fetch(`/api/admin/partners/${id}`)
      .then((r) => r.json())
      .then((res) => {
        if (res.error) throw new Error(res.error.message);
        setPartner(res.data);
      })
      .catch(() => setError("Failed to load partner."))
      .finally(() => setLoading(false));
  };

  useEffect(load, [id]);

  const updateField = async (data: Record<string, string>) => {
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/partners/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error?.message || "Failed to update partner.");
      setPartner((prev) => (prev ? { ...prev, ...body.data } : body.data));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update partner.");
    } finally {
      setSaving(false);
    }
  };

  const startEditing = () => {
    if (!partner) return;
    setDetailsDraft({
      name: partner.name,
      partner_type: partner.partner_type,
      country_of_operation: partner.country_of_operation,
      business_registration_number: partner.business_registration_number ?? "",
      contact_name: partner.contact_name,
      contact_email: partner.contact_email,
      contact_phone: partner.contact_phone,
      notes: partner.notes ?? "",
    });
    setEditingDetails(true);
  };

  const saveDetails = async () => {
    if (!partner) return;
    setSavingDetails(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/partners/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(detailsDraft),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error?.message || "Failed to update partner.");
      setPartner((prev) => (prev ? { ...prev, ...body.data } : body.data));
      setEditingDetails(false);
      if (partner.user_id && detailsDraft.contact_email !== partner.contact_email) {
        setPasswordResetNotice(`Login email updated — an email has been sent to ${detailsDraft.contact_email} with a link to set a new password.`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update partner.");
    } finally {
      setSavingDetails(false);
    }
  };

  const deletePartner = async () => {
    if (!partner) return;
    if (!window.confirm(`Remove ${partner.name}? This can't be undone.`)) return;
    setDeleting(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/partners/${id}`, { method: "DELETE" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error?.message || "Failed to remove partner.");
      router.push("/management/partners");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove partner.");
      setDeleting(false);
    }
  };

  const resetPassword = async () => {
    if (!partner) return;
    if (!window.confirm(`Reset the password for ${partner.name} (${partner.contact_email})? Their current password will stop working, and they'll be emailed a link to set a new one.`)) return;
    setResettingPassword(true);
    setError("");
    setPasswordResetNotice("");
    try {
      const res = await fetch(`/api/admin/partners/${id}/reset-password`, { method: "POST" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error?.message || "Failed to reset password.");
      setPasswordResetNotice(`Password reset — an email has been sent to ${body.data.email} with a link to set a new one.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reset password.");
    } finally {
      setResettingPassword(false);
    }
  };

  const provisionAccount = async () => {
    setProvisioning(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/partners/${id}/provision-account`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error?.message || "Failed to create partner login.");
      setInviteSentEmail(body.data.contact_email ?? partner!.contact_email);
      setPartner((prev) => (prev ? { ...prev, user_id: body.data.user_id } : prev));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create partner login.");
    } finally {
      setProvisioning(false);
    }
  };

  const { page, setPage, totalPages, paged, total, pageSize } = usePagination(partner?.candidates ?? []);

  if (loading) {
    return (
      <PortalShell roleLabel="Management" navItems={MANAGEMENT_NAV_ITEMS}>
        <p className="text-midnight-900/50">Loading…</p>
      </PortalShell>
    );
  }

  if (!partner) {
    return (
      <PortalShell roleLabel="Management" navItems={MANAGEMENT_NAV_ITEMS}>
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4 text-sm">{error || "Partner not found."}</div>
      </PortalShell>
    );
  }

  return (
    <PortalShell roleLabel="Management" navItems={MANAGEMENT_NAV_ITEMS}>
      <div className="flex items-center justify-between mb-2">
        <div>
          <p className="eyebrow mb-3">
            <span className="eyebrow-rule" />
            {PARTNER_TYPE_LABELS[partner.partner_type] ?? partner.partner_type}
          </p>
          <h1 className="section-title text-3xl md:text-4xl mb-2">{partner.name}</h1>
        </div>
        <div className="flex items-center gap-4">
          <Link href="/management/partners" className="text-sm font-medium text-midnight-900/50 hover:text-gold-600">
            ← Back to Partners
          </Link>
          <button
            onClick={deletePartner}
            disabled={deleting}
            className="text-sm font-medium text-red-500 hover:text-red-700 disabled:opacity-50 flex items-center gap-1.5"
          >
            <Trash size={14} weight="regular" /> {deleting ? "Removing…" : "Delete Partner"}
          </button>
        </div>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4 text-sm mb-6">{error}</div>}
      {passwordResetNotice && <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-lg p-4 text-sm mb-6">{passwordResetNotice}</div>}

      {inviteSentEmail && (
        <div className="card p-6 mb-6 border-l-4 border-gold-400">
          <div className="flex items-start gap-3">
            <CheckCircle size={22} weight="fill" className="text-gold-600 shrink-0 mt-0.5" />
            <div className="flex-1">
              <h3 className="font-semibold text-midnight-900 mb-1">Partner login created</h3>
              <p className="text-sm text-midnight-900/60">
                An email has been sent to <span className="font-medium">{inviteSentEmail}</span> with a link to set
                their own password.
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="card p-6 mb-8 flex items-center justify-between">
        <div>
          <h2 className="text-xs font-semibold text-midnight-900/50 uppercase tracking-wider mb-1">Partner Login</h2>
          <p className="text-sm text-midnight-900/60">
            {partner.user_id ? "This partner can log in and submit candidates through its own portal." : "No login yet — this partner can't submit candidates until one is created."}
          </p>
        </div>
        {!partner.user_id ? (
          <button onClick={provisionAccount} disabled={provisioning} className="btn-primary text-xs disabled:opacity-60">
            {provisioning ? "Creating…" : "Create Partner Login"}
          </button>
        ) : (
          <button onClick={resetPassword} disabled={resettingPassword} className="btn-secondary text-xs disabled:opacity-60 flex items-center gap-1.5">
            <Key size={14} weight="regular" /> {resettingPassword ? "Resetting…" : "Reset Password"}
          </button>
        )}
      </div>

      <div className="grid lg:grid-cols-3 gap-6 mb-8">
        <div className="card p-6 lg:col-span-3">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xs font-semibold text-midnight-900/50 uppercase tracking-wider">Details</h2>
            {!editingDetails && (
              <button onClick={startEditing} className="text-xs font-medium text-gold-600 hover:underline flex items-center gap-1">
                <PencilSimple size={13} weight="regular" /> Edit
              </button>
            )}
          </div>
          {editingDetails ? (
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="edit-name" className="block text-xs font-medium text-midnight-900/60 mb-1.5">Agency Name</label>
                <input id="edit-name" value={detailsDraft.name} onChange={(e) => setDetailsDraft({ ...detailsDraft, name: e.target.value })} className="input-field" />
              </div>
              <div>
                <label htmlFor="edit-type" className="block text-xs font-medium text-midnight-900/60 mb-1.5">Partner Type</label>
                <SearchableSelect
                  id="edit-type"
                  value={detailsDraft.partner_type}
                  onChange={(value) => setDetailsDraft({ ...detailsDraft, partner_type: value })}
                  options={Object.entries(PARTNER_TYPE_LABELS).map(([value, label]) => ({ value, label }))}
                />
              </div>
              <div>
                <label htmlFor="edit-country" className="block text-xs font-medium text-midnight-900/60 mb-1.5">Country of Operation</label>
                <input id="edit-country" value={detailsDraft.country_of_operation} onChange={(e) => setDetailsDraft({ ...detailsDraft, country_of_operation: e.target.value })} className="input-field" />
              </div>
              <div>
                <label htmlFor="edit-reg-number" className="block text-xs font-medium text-midnight-900/60 mb-1.5">Business Registration No. <span className="text-midnight-900/35 font-normal">(optional)</span></label>
                <input id="edit-reg-number" value={detailsDraft.business_registration_number} onChange={(e) => setDetailsDraft({ ...detailsDraft, business_registration_number: e.target.value })} className="input-field" />
              </div>
              <div>
                <label htmlFor="edit-contact-name" className="block text-xs font-medium text-midnight-900/60 mb-1.5">Contact Name</label>
                <input id="edit-contact-name" value={detailsDraft.contact_name} onChange={(e) => setDetailsDraft({ ...detailsDraft, contact_name: e.target.value })} className="input-field" />
              </div>
              <div>
                <label htmlFor="edit-contact-phone" className="block text-xs font-medium text-midnight-900/60 mb-1.5">Contact Phone</label>
                <input id="edit-contact-phone" value={detailsDraft.contact_phone} onChange={(e) => setDetailsDraft({ ...detailsDraft, contact_phone: e.target.value })} className="input-field" />
              </div>
              <div className="sm:col-span-2">
                <label htmlFor="edit-contact-email" className="block text-xs font-medium text-midnight-900/60 mb-1.5">Contact Email</label>
                <input id="edit-contact-email" type="email" value={detailsDraft.contact_email} onChange={(e) => setDetailsDraft({ ...detailsDraft, contact_email: e.target.value })} className="input-field" />
                {partner.user_id && detailsDraft.contact_email !== partner.contact_email && (
                  <p className="text-xs text-gold-600 mt-1.5">
                    This is also this partner's login email — changing it will email them a link to set a new password, and their current password will stop working.
                  </p>
                )}
              </div>
              <div className="sm:col-span-2">
                <label htmlFor="edit-notes" className="block text-xs font-medium text-midnight-900/60 mb-1.5">Notes <span className="text-midnight-900/35 font-normal">(optional)</span></label>
                <textarea id="edit-notes" rows={3} value={detailsDraft.notes} onChange={(e) => setDetailsDraft({ ...detailsDraft, notes: e.target.value })} className="input-field resize-none" />
              </div>
              <div className="sm:col-span-2 flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setEditingDetails(false)} className="btn-secondary text-xs px-5">Cancel</button>
                <button type="button" onClick={saveDetails} disabled={savingDetails} className="btn-primary text-xs px-5 disabled:opacity-60">
                  {savingDetails ? "Saving…" : "Save Changes"}
                </button>
              </div>
            </div>
          ) : (
            <dl className="grid sm:grid-cols-2 gap-x-8 gap-y-2 text-sm">
              <div className="flex justify-between"><dt className="text-midnight-900/50">Country</dt><dd className="text-midnight-900">{partner.country_of_operation}</dd></div>
              <div className="flex justify-between"><dt className="text-midnight-900/50">Contact</dt><dd className="text-midnight-900">{partner.contact_name}</dd></div>
              <div className="flex justify-between"><dt className="text-midnight-900/50">Email</dt><dd className="text-midnight-900">{partner.contact_email}</dd></div>
              <div className="flex justify-between"><dt className="text-midnight-900/50">Phone</dt><dd className="text-midnight-900">{partner.contact_phone}</dd></div>
              {partner.business_registration_number && (
                <div className="flex justify-between"><dt className="text-midnight-900/50">Reg. No.</dt><dd className="text-midnight-900">{partner.business_registration_number}</dd></div>
              )}
              {partner.notes && (
                <div className="flex justify-between sm:col-span-2"><dt className="text-midnight-900/50">Notes</dt><dd className="text-midnight-900 text-right max-w-md">{partner.notes}</dd></div>
              )}
            </dl>
          )}
        </div>

        <div className="card p-6">
          <label htmlFor="partner-status" className="block text-xs font-semibold text-midnight-900/50 uppercase tracking-wider mb-4">Status</label>
          <SearchableSelect
            id="partner-status"
            value={partner.status}
            disabled={saving}
            onChange={(value) => updateField({ status: value })}
            className="input-field mb-2"
            options={STATUS_OPTIONS.map((s) => ({ value: s, label: s }))}
          />
          <p className="text-xs text-midnight-900/45">Suspend a partner to stop attributing new leads to it.</p>
        </div>

        <div className="card p-6">
          <label htmlFor="partner-mou-status" className="block text-xs font-semibold text-midnight-900/50 uppercase tracking-wider mb-4">MOU / Agreement</label>
          <SearchableSelect
            id="partner-mou-status"
            value={partner.mou_status}
            disabled={saving}
            onChange={(value) => updateField({ mou_status: value })}
            className="input-field mb-2"
            options={MOU_OPTIONS.map((s) => ({ value: s, label: s }))}
          />
          {partner.mou_signed_at && (
            <p className="text-xs text-emerald-700">Signed {new Date(partner.mou_signed_at).toLocaleDateString()}</p>
          )}
        </div>
      </div>

      <h2 className="text-sm font-semibold text-midnight-900/50 uppercase tracking-wider mb-3">Candidates sourced</h2>

      {partner.candidates.length === 0 ? (
        <div className="card p-10 text-center text-midnight-900/50">No candidates sourced via this partner yet.</div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-midnight-900/10 text-left text-midnight-900/40 text-xs uppercase tracking-wider">
                <th className="px-5 py-3 font-semibold">Candidate</th>
                <th className="px-5 py-3 font-semibold">Recruiter</th>
                <th className="px-5 py-3 font-semibold">Status</th>
                <th className="px-5 py-3 font-semibold">Sourced</th>
              </tr>
            </thead>
            <tbody>
              {paged.map((c) => (
                <tr key={c.id} className="border-b border-midnight-900/5 last:border-0">
                  <td className="px-5 py-4 font-medium text-midnight-900">{c.user?.full_name ?? c.full_name ?? "— unnamed lead —"}</td>
                  <td className="px-5 py-4 text-midnight-900/70">{c.recruiter?.full_name ?? "—"}</td>
                  <td className="px-5 py-4">
                    <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold bg-slate-100 text-slate-700">
                      {formatCandidateLifecycleStatus(c.lifecycle_status)}
                    </span>
                  </td>
                  <td className="px-5 py-4 text-midnight-900/60">{new Date(c.created_at).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="px-5">
            <Pagination page={page} totalPages={totalPages} onPageChange={setPage} total={total} pageSize={pageSize} />
          </div>
        </div>
      )}
    </PortalShell>
  );
}
