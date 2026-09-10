"use client";

import { useEffect, useState } from "react";
import PortalShell, { type PortalNavItem } from "@/components/portal/PortalShell";
import SearchableSelect from "@/components/SearchableSelect";
import Pagination from "@/components/Pagination";
import { usePagination } from "@/lib/usePagination";
import EditableRowTable, { type RowValue } from "@/components/portal/reports/EditableRowTable";
import { Plus, Warning } from "@phosphor-icons/react";
import FilterBar from "@/components/portal/FilterBar";
import { useDebouncedValue } from "@/lib/useDebouncedValue";

interface ExceptionRow {
  id: string;
  reference: string;
  category: string;
  raiser: { id: string; full_name: string; role: string };
  country: { id: string; name: string } | null;
  candidate: { id: string; full_name: string | null } | null;
  reference_note: string | null;
  issue_statement: string;
  immediate_impact: string;
  decision_required: string;
  decision_deadline: string;
  escalation_level: string;
  status: string;
  decision: string | null;
  decision_notes: string | null;
  decider: { id: string; full_name: string } | null;
  decided_at: string | null;
  created_at: string;
  corrective_actions: { id: string; action: string; owner: { id: string; full_name: string } | null; due_date: string | null; success_measure: string | null; status: string; evidence: string | null }[];
}

const CATEGORY_OPTIONS = [
  { value: "candidate_eligibility_screening", label: "Candidate eligibility / screening" },
  { value: "documentation_data_integrity", label: "Documentation / data integrity" },
  { value: "crm_system_issue", label: "CRM / system issue" },
  { value: "target_capacity_performance", label: "Target / capacity / performance" },
  { value: "compliance_legal_ethical_risk", label: "Compliance / legal / ethical risk" },
  { value: "candidate_welfare_conduct", label: "Candidate welfare / conduct" },
  { value: "operational_timeline_dependency", label: "Operational / timeline / third-party dependency" },
  { value: "other", label: "Other" },
];

const STATUS_STYLES: Record<string, string> = {
  open: "bg-yellow-100 text-yellow-800",
  decided: "bg-blue-100 text-blue-700",
  closed: "bg-slate-100 text-slate-700",
};

const LEVEL_LABELS: Record<string, string> = {
  regional: "Regional",
  country: "Country",
  inhouse: "In-House",
  management: "Management",
};

const LEVEL_OPTIONS = [
  { value: "", label: "All levels" },
  ...Object.entries(LEVEL_LABELS).map(([value, label]) => ({ value, label })),
];

const CORRECTIVE_ACTION_COLUMNS = [
  { key: "action", label: "Corrective Action" },
  { key: "due_date", label: "Due Date", type: "date" as const },
  { key: "success_measure", label: "Success Measure" },
];

const emptyForm = {
  category: "candidate_eligibility_screening",
  reference_note: "",
  issue_statement: "",
  immediate_impact: "",
  actions_taken: "",
  root_cause: "",
  options_considered: "",
  recommendation: "",
  decision_required: "",
  decision_deadline: "",
};

function ExceptionCard({ e, onChanged }: { e: ExceptionRow; onChanged: () => void }) {
  const [decision, setDecision] = useState<"approved" | "modified" | "rejected" | "escalated" | "">("");
  const [decisionNotes, setDecisionNotes] = useState("");
  const [busy, setBusy] = useState(false);

  const escalate = async () => {
    setBusy(true);
    await fetch(`/api/exceptions/${e.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "escalate" }),
    });
    setBusy(false);
    onChanged();
  };

  const decide = async () => {
    if (!decision) return;
    setBusy(true);
    await fetch(`/api/exceptions/${e.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "decide", decision, decision_notes: decisionNotes || undefined }),
    });
    setBusy(false);
    onChanged();
  };

  const overdue = new Date(e.decision_deadline) < new Date() && e.status === "open";

  return (
    <div className="card p-5">
      <div className="flex items-start justify-between gap-4 mb-2">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="font-mono text-xs text-midnight-900/50">{e.reference}</span>
            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider ${STATUS_STYLES[e.status]}`}>
              {e.status}
            </span>
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider bg-midnight-900/5 text-midnight-900/60">
              {LEVEL_LABELS[e.escalation_level]}
            </span>
            {overdue && (
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider bg-red-100 text-red-700">
                Overdue
              </span>
            )}
          </div>
          <div className="text-xs text-midnight-900/45">
            {CATEGORY_OPTIONS.find((c) => c.value === e.category)?.label ?? e.category} · raised by {e.raiser.full_name} ·{" "}
            {new Date(e.created_at).toLocaleDateString()}
          </div>
        </div>
      </div>

      <p className="text-sm text-midnight-900 font-medium mb-1">{e.issue_statement}</p>
      <p className="text-xs text-midnight-900/60 mb-2">
        <span className="font-semibold">Impact:</span> {e.immediate_impact}
      </p>
      <p className="text-xs text-midnight-900/60 mb-3">
        <span className="font-semibold">Decision required:</span> {e.decision_required} — by{" "}
        {new Date(e.decision_deadline).toLocaleDateString()}
      </p>

      {e.corrective_actions.length > 0 && (
        <div className="mb-3">
          <div className="text-[11px] font-semibold text-midnight-900/50 uppercase tracking-wider mb-1">Corrective Actions</div>
          <ul className="space-y-1 text-xs text-midnight-900/70">
            {e.corrective_actions.map((a) => (
              <li key={a.id}>
                {a.action} {a.owner ? `— ${a.owner.full_name}` : ""} {a.due_date ? `(due ${new Date(a.due_date).toLocaleDateString()})` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}

      {e.status === "closed" && e.decision && (
        <div className="text-xs text-midnight-900/60 border-t border-midnight-900/10 pt-2 mt-2">
          <span className="font-semibold capitalize">{e.decision}</span> by {e.decider?.full_name ?? "—"}
          {e.decision_notes ? ` — ${e.decision_notes}` : ""}
        </div>
      )}

      {e.status === "open" && (
        <div className="flex flex-wrap items-center gap-2 border-t border-midnight-900/10 pt-3 mt-2">
          <button onClick={escalate} disabled={busy || e.escalation_level === "management"} className="btn-secondary text-xs py-1.5 px-3 disabled:opacity-50">
            Escalate
          </button>
          <SearchableSelect
            value={decision}
            onChange={(v) => setDecision(v as typeof decision)}
            options={[
              { value: "approved", label: "Approved" },
              { value: "modified", label: "Modified" },
              { value: "rejected", label: "Rejected" },
              { value: "escalated", label: "Escalated" },
            ]}
            placeholder="Decision…"
            className="input-field text-xs py-1.5 px-2 w-40"
          />
          <input
            value={decisionNotes}
            onChange={(e) => setDecisionNotes(e.target.value)}
            placeholder="Decision notes"
            className="input-field text-xs py-1.5 px-2 flex-1 min-w-[160px]"
          />
          <button onClick={decide} disabled={busy || !decision} className="btn-primary text-xs py-1.5 px-3 disabled:opacity-50">
            Record Decision
          </button>
        </div>
      )}
    </div>
  );
}

interface Props {
  roleLabel: string;
  navItems: PortalNavItem[];
}

/**
 * Supervisory Reporting Framework §6 — shared across every portal
 * (recruiter/supervisor/in-house/management each get a thin page.tsx
 * that just renders this with their own PortalShell config), since the
 * raise/escalate/decide flow and RBAC scoping (src/app/api/exceptions)
 * are identical regardless of which tier is using it.
 */
export default function ExceptionsPageContent({ roleLabel, navItems }: Props) {
  const [exceptions, setExceptions] = useState<ExceptionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [correctiveActions, setCorrectiveActions] = useState<Record<string, RowValue>[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Search + category/level filters (Portal Improvement Requirements item
  // 3, 2026-08-18) — applied server-side, same as every other list; the
  // Open/Decided split below is meaningful business status, not itself a
  // filter, so it stays a fixed two-section layout.
  const [q, setQ] = useState("");
  const debouncedQ = useDebouncedValue(q);
  const [category, setCategory] = useState("");
  const [level, setLevel] = useState("");

  const load = () => {
    setLoading(true);
    const params = new URLSearchParams({ pageSize: "100" });
    if (debouncedQ) params.set("q", debouncedQ);
    if (category) params.set("category", category);
    if (level) params.set("escalation_level", level);
    fetch(`/api/exceptions?${params}`)
      .then((r) => r.json())
      .then((res) => setExceptions(res.data ?? []))
      .catch(() => setError("Failed to load exceptions."))
      .finally(() => setLoading(false));
  };

  useEffect(load, [debouncedQ, category, level]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/exceptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          corrective_actions: correctiveActions
            .filter((a) => a.action)
            .map((a) => ({ action: a.action, due_date: a.due_date || undefined, success_measure: a.success_measure || undefined })),
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error?.message ?? "Failed to raise exception.");
      setForm(emptyForm);
      setCorrectiveActions([]);
      setShowForm(false);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to raise exception.");
    } finally {
      setSaving(false);
    }
  };

  const open = exceptions.filter((e) => e.status === "open");
  const closedOrDecided = exceptions.filter((e) => e.status !== "open");
  const openPagination = usePagination(open);
  const closedPagination = usePagination(closedOrDecided);

  return (
    <PortalShell roleLabel={roleLabel} navItems={navItems}>
      <div className="flex items-start justify-between gap-6 mb-2">
        <div>
          <p className="eyebrow mb-3">
            <span className="eyebrow-rule" />
            Governance
          </p>
          <h1 className="section-title text-3xl md:text-4xl">Exceptions.</h1>
        </div>
        <button onClick={() => setShowForm((v) => !v)} className="btn-primary text-xs shrink-0">
          <Plus size={16} weight="bold" /> Raise Exception
        </button>
      </div>
      <p className="text-midnight-900/55 font-light mb-8 max-w-2xl">
        Raise an issue immediately, independent of the regular reporting cycle — it escalates up the same
        Regional Recruiter → Country Supervisor → In-House Supervisor → Management line.
      </p>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4 text-sm mb-6">{error}</div>}

      {showForm && (
        <form onSubmit={submit} className="card p-6 mb-6 space-y-4">
          <h3 className="font-semibold text-midnight-900 flex items-center gap-2">
            <Warning size={16} weight="regular" /> New exception
          </h3>
          <div className="grid sm:grid-cols-2 gap-4">
            <SearchableSelect value={form.category} onChange={(v) => setForm({ ...form, category: v })} options={CATEGORY_OPTIONS} />
            <input
              placeholder="Campaign / Candidate CRM Ref. (optional)"
              value={form.reference_note}
              onChange={(e) => setForm({ ...form, reference_note: e.target.value })}
              className="input-field"
            />
          </div>
          <textarea
            required
            placeholder="Issue statement — what happened? State verified facts only."
            value={form.issue_statement}
            onChange={(e) => setForm({ ...form, issue_statement: e.target.value })}
            rows={2}
            className="input-field w-full resize-none"
          />
          <textarea
            required
            placeholder="Immediate impact"
            value={form.immediate_impact}
            onChange={(e) => setForm({ ...form, immediate_impact: e.target.value })}
            rows={2}
            className="input-field w-full resize-none"
          />
          <textarea
            placeholder="Actions already taken (optional)"
            value={form.actions_taken}
            onChange={(e) => setForm({ ...form, actions_taken: e.target.value })}
            rows={2}
            className="input-field w-full resize-none"
          />
          <div className="grid sm:grid-cols-2 gap-4">
            <textarea
              placeholder="Root cause (optional)"
              value={form.root_cause}
              onChange={(e) => setForm({ ...form, root_cause: e.target.value })}
              rows={2}
              className="input-field w-full resize-none"
            />
            <textarea
              placeholder="Options considered (optional)"
              value={form.options_considered}
              onChange={(e) => setForm({ ...form, options_considered: e.target.value })}
              rows={2}
              className="input-field w-full resize-none"
            />
          </div>
          <textarea
            placeholder="Recommendation (optional)"
            value={form.recommendation}
            onChange={(e) => setForm({ ...form, recommendation: e.target.value })}
            rows={2}
            className="input-field w-full resize-none"
          />
          <div className="grid sm:grid-cols-2 gap-4">
            <input
              required
              placeholder="Decision required"
              value={form.decision_required}
              onChange={(e) => setForm({ ...form, decision_required: e.target.value })}
              className="input-field"
            />
            <input
              required
              type="date"
              value={form.decision_deadline}
              onChange={(e) => setForm({ ...form, decision_deadline: e.target.value })}
              className="input-field"
            />
          </div>

          <EditableRowTable
            title="Corrective Actions"
            columns={CORRECTIVE_ACTION_COLUMNS}
            rows={correctiveActions}
            onChange={setCorrectiveActions}
            addLabel="Add action"
          />

          <button type="submit" disabled={saving} className="btn-primary text-xs disabled:opacity-60">
            {saving ? "Raising…" : "Raise Exception"}
          </button>
        </form>
      )}

      <FilterBar searchValue={q} onSearchChange={setQ} searchPlaceholder="Search by reference, issue, or candidate…">
        <SearchableSelect
          value={category}
          onChange={setCategory}
          placeholder="All categories"
          className="input-field w-64"
          options={[{ value: "", label: "All categories" }, ...CATEGORY_OPTIONS]}
        />
        <SearchableSelect value={level} onChange={setLevel} className="input-field w-44" options={LEVEL_OPTIONS} />
      </FilterBar>

      {loading ? (
        <p className="text-midnight-900/50">Loading…</p>
      ) : (
        <div className="space-y-8">
          <section>
            <h2 className="text-sm font-semibold text-midnight-900/50 uppercase tracking-wider mb-3">Open ({open.length})</h2>
            {open.length === 0 ? (
              <div className="card p-6 text-center text-midnight-900/40">No open exceptions match your filters.</div>
            ) : (
              <div className="space-y-3">
                {openPagination.paged.map((e) => (
                  <ExceptionCard key={e.id} e={e} onChanged={load} />
                ))}
                <Pagination
                  page={openPagination.page}
                  totalPages={openPagination.totalPages}
                  onPageChange={openPagination.setPage}
                  total={openPagination.total}
                  pageSize={openPagination.pageSize}
                />
              </div>
            )}
          </section>
          <section>
            <h2 className="text-sm font-semibold text-midnight-900/50 uppercase tracking-wider mb-3">Decided / Closed</h2>
            {closedOrDecided.length === 0 ? (
              <div className="card p-6 text-center text-midnight-900/40">None yet.</div>
            ) : (
              <div className="space-y-3">
                {closedPagination.paged.map((e) => (
                  <ExceptionCard key={e.id} e={e} onChanged={load} />
                ))}
                <Pagination
                  page={closedPagination.page}
                  totalPages={closedPagination.totalPages}
                  onPageChange={closedPagination.setPage}
                  total={closedPagination.total}
                  pageSize={closedPagination.pageSize}
                />
              </div>
            )}
          </section>
        </div>
      )}
    </PortalShell>
  );
}
