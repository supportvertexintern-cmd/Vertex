"use client";

import { useEffect, useState } from "react";
import SearchableSelect from "@/components/SearchableSelect";

// Phase 6 partner tracking panel (doc §2/§7, upstream staging) — the VA
// partner view now, and the Management partner page with the next part.
// FastAPI answers every call (vertex_be/app/api/v1/partner_tracking.py) and
// keeps a virtual assistant to its own partners.
// Fetches the live tracking summary and provides the VA/team entry points:
// onboarding status (SLA, documents submitted, assigned VA), candidate
// application stats, report activity (add/update), and follow-ups
// (add/complete).

interface TrackingData {
  partner: {
    id: string;
    status: string;
    mou_status: string;
    sla_status: string;
    documents_submitted_at: string | null;
    assigned_team_member: { id: string; full_name: string } | null;
  };
  stats: {
    registered: number;
    initiated: number;
    submitted: number;
    under_review: number;
    approved: number;
    rejected_or_withdrawn: number;
    first_activity_at: string | null;
    last_activity_at: string | null;
  };
  reports: Array<{
    id: string;
    status: "pending" | "submitted" | "returned" | "closed";
    reported_at: string;
    content: unknown;
    submitter: { full_name: string } | null;
  }>;
  follow_ups: Array<{
    id: string;
    action: string;
    status: "open" | "done";
    due_at: string | null;
    assignee: { full_name: string } | null;
  }>;
  // Activity feed (DEF-004) — audit-log history for this partner's own
  // records, summarized server-side.
  activity: Array<{
    id: string;
    at: string;
    actor: string | null;
    action: string;
    entity: string;
    summary: string;
  }>;
}

const SLA_OPTIONS = ["none", "sent", "signed"];
const REPORT_STATUS_OPTIONS = ["pending", "submitted", "returned", "closed"];

// PartnerReport.content is a Json column — rows written by other tools (or
// the demo seed) can hold an object ({ notes }) rather than a plain string.
// Rendering an object as a React child throws (the Addis page crash,
// 2026-11-05), so always derive a display string defensively.
function reportSummary(content: unknown): string {
  if (typeof content === "string" && content.trim()) return content;
  if (content && typeof content === "object" && "notes" in content) {
    const notes = (content as { notes?: unknown }).notes;
    if (typeof notes === "string" && notes.trim()) return notes;
  }
  return "(no notes)";
}

const STATUS_STYLES: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-800",
  submitted: "bg-blue-100 text-blue-700",
  returned: "bg-orange-100 text-orange-700",
  closed: "bg-emerald-100 text-emerald-800",
  done: "bg-emerald-100 text-emerald-800",
  open: "bg-yellow-100 text-yellow-800",
};

export default function PartnerTrackingPanel({ partnerId }: { partnerId: string }) {
  const [data, setData] = useState<TrackingData | null>(null);
  const [vaUsers, setVaUsers] = useState<Array<{ id: string; full_name: string }>>([]);
  const [viewerRole, setViewerRole] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [reportDraft, setReportDraft] = useState({ status: "submitted", content: "" });
  const [followUpDraft, setFollowUpDraft] = useState({ action: "", due: "" });

  // Onboarding status (SLA, documents, assignment) is written by the
  // partner-manager tier only — a VA viewing their own assigned partner
  // sees these as read-only, not owner-editable controls that would 403.
  const canEditOnboarding = viewerRole !== "virtual_assistant";

  // Starts loading; a reload after a save keeps the panel on screen.
  const load = () => {
    fetch(`/api/management/partners/${partnerId}/tracking`)
      .then((r) => r.json())
      .then((res) => {
        if (res.error) throw new Error(res.error.message ?? "Failed to load tracking.");
        setData(res.data);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load tracking."))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // VA team list — partner-manager gate (same tier that owns partners),
    // unlike the admin-only staff directory.
    fetch("/api/admin/va-users")
      .then((r) => r.json())
      .then((res) =>
        setVaUsers(
          (res.data ?? [])
            // Only active VAs can be assigned (a deactivated VA may still
            // hold old partners until reassigned, but cannot take new ones).
            .filter((u: { is_active?: boolean }) => u.is_active !== false)
            .map((u: { id: string; full_name: string }) => ({ id: u.id, full_name: u.full_name }))
        )
      )
      .catch(() => {});
    // Which viewer is using this panel — drives the onboarding
    // read-only/editable split above.
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((res) => setViewerRole(res?.data?.role ?? null))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partnerId]);

  const patchPartner = async (patch: Record<string, unknown>) => {
    setSaving(true);
    setError("");
    setNotice("");
    const res = await fetch(`/api/admin/partners/${partnerId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const payload = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) {
      setError(payload?.error?.message ?? "Failed to save.");
      return;
    }
    setNotice("Saved.");
    load();
  };

  const addReport = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    const res = await fetch("/api/partner-reports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ partner_id: partnerId, status: reportDraft.status, content: reportDraft.content }),
    });
    setSaving(false);
    if (!res.ok) {
      const payload = await res.json().catch(() => ({}));
      setError(payload?.error?.message ?? "Failed to save report.");
      return;
    }
    setReportDraft({ status: "submitted", content: "" });
    setNotice("Report recorded.");
    load();
  };

  const setReportStatus = async (id: string, status: string) => {
    const res = await fetch(`/api/partner-reports/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (res.ok) { setNotice("Report status updated."); load(); }
    else { const p = await res.json().catch(() => ({})); setError(p?.error?.message ?? "Failed to update report."); }
  };

  const addFollowUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    const res = await fetch("/api/partner-follow-ups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        partner_id: partnerId,
        action: followUpDraft.action,
        // DEF-012: the API supported due_at all along — the form had no
        // date field, so a follow-up date could never be entered.
        due_at: followUpDraft.due ? new Date(followUpDraft.due).toISOString() : undefined,
      }),
    });
    setSaving(false);
    if (!res.ok) {
      const payload = await res.json().catch(() => ({}));
      setError(payload?.error?.message ?? "Failed to save follow-up.");
      return;
    }
    setFollowUpDraft({ action: "", due: "" });
    setNotice("Follow-up added.");
    load();
  };

  const completeFollowUp = async (id: string) => {
    const res = await fetch(`/api/partner-follow-ups/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "done" }),
    });
    if (res.ok) { setNotice("Follow-up completed."); load(); }
    else { const p = await res.json().catch(() => ({})); setError(p?.error?.message ?? "Failed to complete follow-up."); }
  };

  if (loading) return <div className="card p-10 text-center text-midnight-900/50">Loading tracking…</div>;
  if (error) return <div className="card p-6 border-l-4 border-red-400 text-red-700 text-sm">{error}</div>;
  if (!data) return null;

  const { partner, stats: s, reports, follow_ups, activity } = data;

  return (
    <div>
      <h2 className="text-sm font-semibold text-midnight-900/50 uppercase tracking-wider mb-3">Partner tracking</h2>
      {notice && <div className="card p-4 mb-4 border-l-4 border-emerald-400 text-emerald-700 text-sm">{notice}</div>}

      {/* Onboarding status */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="card p-4">
          <label className="block text-xs font-semibold text-midnight-900/50 uppercase tracking-wider mb-2">SLA status</label>
          {canEditOnboarding ? (
            <SearchableSelect
              id="sla-status"
              value={partner.sla_status}
              disabled={saving}
              onChange={(value) => patchPartner({ sla_status: value })}
              className="input-field"
              options={SLA_OPTIONS.map((s) => ({ value: s, label: s }))}
            />
          ) : (
            <p className="text-sm text-midnight-900/70">{partner.sla_status}</p>
          )}
        </div>
        <div className="card p-4 flex flex-col justify-between">
          <label className="block text-xs font-semibold text-midnight-900/50 uppercase tracking-wider">Onboarding documents</label>
          <p className="text-sm text-midnight-900/70 mt-2">
            {partner.documents_submitted_at
              ? `Submitted ${new Date(partner.documents_submitted_at).toLocaleDateString()}`
              : "Not submitted yet"}
          </p>
          {canEditOnboarding && (
            <button
              onClick={() => patchPartner({ documents_submitted: !partner.documents_submitted_at })}
              disabled={saving}
              className="btn-secondary text-xs mt-3"
            >
              {saving ? "…" : partner.documents_submitted_at ? "Mark as not submitted" : "Mark documents submitted"}
            </button>
          )}
        </div>
        <div className="card p-4">
          <label className="block text-xs font-semibold text-midnight-900/50 uppercase tracking-wider mb-2">Assigned VA / team member</label>
          {canEditOnboarding ? (
            <>
              <SearchableSelect
                id="assigned-va"
                value={partner.assigned_team_member?.id ?? ""}
                disabled={saving}
                onChange={(value) => patchPartner({ assigned_team_member_id: value || null })}
                className="input-field"
                options={[{ value: "", label: "Unassigned" }, ...vaUsers.map((u) => ({ value: u.id, label: u.full_name }))]}
              />
              {vaUsers.length === 0 && (
                <p className="text-xs text-midnight-900/45 mt-2">No Virtual Assistant users exist yet — add one on Management → VA Team.</p>
              )}
            </>
          ) : (
            <p className="text-sm text-midnight-900/70">{partner.assigned_team_member?.full_name ?? "Unassigned"}</p>
          )}
        </div>
      </div>

      {/* Candidate application stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {[
          { label: "Registered", value: s.registered },
          { label: "Initiated (incl. drafts)", value: s.initiated },
          { label: "Submitted", value: s.submitted },
          { label: "Under review", value: s.under_review },
          { label: "Approved", value: s.approved },
          { label: "Rejected / withdrawn", value: s.rejected_or_withdrawn },
          { label: "First activity", value: s.first_activity_at ? new Date(s.first_activity_at).toLocaleDateString() : "—" },
          { label: "Last activity", value: s.last_activity_at ? new Date(s.last_activity_at).toLocaleDateString() : "—" },
        ].map((t) => (
          <div key={t.label} className="card p-4">
            <div className="text-xs font-semibold text-midnight-900/50 uppercase tracking-wider">{t.label}</div>
            <div className="text-xl font-bold text-midnight-900 mt-1">{t.value}</div>
          </div>
        ))}
      </div>

      {/* Reports */}
      <div className="card p-6 mb-6">
        <h3 className="font-semibold text-midnight-900 mb-3">Reports</h3>
        <form onSubmit={addReport} className="flex flex-col md:flex-row gap-3 mb-4">
          <select
            value={reportDraft.status}
            onChange={(e) => setReportDraft((d) => ({ ...d, status: e.target.value }))}
            className="input-field w-full md:w-48"
          >
            {REPORT_STATUS_OPTIONS.map((s) => (<option key={s} value={s}>{s}</option>))}
          </select>
          <input
            value={reportDraft.content}
            onChange={(e) => setReportDraft((d) => ({ ...d, content: e.target.value }))}
            placeholder="Report notes / content…"
            className="input-field flex-1"
          />
          <button
            type="submit"
            disabled={saving || !reportDraft.content.trim()}
            className="btn-primary disabled:opacity-60"
          >
            {saving ? "…" : "Record report"}
          </button>
        </form>
        {reports.length === 0 ? (
          <p className="text-sm text-midnight-900/50">No reports recorded.</p>
        ) : (
          <div className="space-y-2">
            {reports.map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-3 border border-midnight-900/10 rounded-lg px-4 py-2.5">
                <div className="min-w-0">
                  <div className="text-sm text-midnight-900 truncate">{reportSummary(r.content)}</div>
                  <div className="text-xs text-midnight-900/45">
                    {new Date(r.reported_at).toLocaleDateString()} · by {r.submitter?.full_name ?? "—"}
                  </div>
                </div>
                <select
                  value={r.status}
                  onChange={(e) => setReportStatus(r.id, e.target.value)}
                  className="input-field w-40 text-xs"
                >
                  {REPORT_STATUS_OPTIONS.map((s) => (<option key={s} value={s}>{s}</option>))}
                </select>
                <span className={`badge ${STATUS_STYLES[r.status] ?? ""}`}>{r.status}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Follow-ups */}
      <div className="card p-6">
        <h3 className="font-semibold text-midnight-900 mb-3">Follow-ups</h3>
        <form onSubmit={addFollowUp} className="flex flex-col md:flex-row gap-3 mb-4">
          <input
            value={followUpDraft.action}
            onChange={(e) => setFollowUpDraft((d) => ({ ...d, action: e.target.value }))}
            placeholder="Action required — e.g. chase signed MOU, outstanding report…"
            className="input-field flex-1"
          />
          <input
            type="date"
            value={followUpDraft.due}
            onChange={(e) => setFollowUpDraft((d) => ({ ...d, due: e.target.value }))}
            className="input-field w-full md:w-44"
            aria-label="Follow-up due date"
          />
          <button type="submit" disabled={saving} className="btn-primary">{saving ? "…" : "Add"}</button>
        </form>
        {follow_ups.length === 0 ? (
          <p className="text-sm text-midnight-900/50">No follow-ups yet.</p>
        ) : (
          <div className="space-y-2">
            {follow_ups.map((f) => (
              <div key={f.id} className="flex items-center justify-between gap-3 border border-midnight-900/10 rounded-lg px-4 py-2.5">
                <div className="min-w-0">
                  <div className="text-sm text-midnight-900">{f.action}</div>
                  <div className="text-xs text-midnight-900/45">
                    {f.due_at ? `Due ${new Date(f.due_at).toLocaleDateString()} · ` : ""}assigned to {f.assignee?.full_name ?? "—"}
                  </div>
                </div>
                <span className={`badge ${STATUS_STYLES[f.status] ?? ""}`}>{f.status}</span>
                {f.status === "open" && (
                  <button onClick={() => completeFollowUp(f.id)} className="btn-secondary text-xs">Complete</button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Activity history (DEF-004) — audit-log driven */}
      <div className="card p-6 mt-6">
        <h3 className="font-semibold text-midnight-900 mb-3">Activity</h3>
        {activity.length === 0 ? (
          <p className="text-sm text-midnight-900/50">
            No activity recorded yet — changes to this partner, its reports, follow-ups and submissions appear here.
          </p>
        ) : (
          <ul className="space-y-3">
            {activity.map((a) => (
              <li key={a.id} className="flex items-start gap-3 text-sm">
                <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-gold-500 shrink-0" />
                <div className="min-w-0">
                  <div className="text-midnight-900">{a.summary}</div>
                  <div className="text-xs text-midnight-900/45">
                    {new Date(a.at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })} ·{" "}
                    {a.actor ?? "System"}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}