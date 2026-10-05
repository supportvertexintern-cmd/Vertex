"use client";

import { useEffect, useMemo, useState } from "react";
import { CaretDown, CaretRight, Database, DownloadSimple, Plus, SlidersHorizontal, X } from "@phosphor-icons/react";
import { useDebouncedValue } from "@/lib/useDebouncedValue";

// Backup / Data Export (2026-10-05) — replaces the fixed Candidates/Partners
// CSV card. Deliberately general-first: pick Full backup or tick a few
// modules, optionally a status and date range, and download. Columns,
// related tables and specific records sit behind each module's collapsed
// "Customize" panel. Every table/column/status/relationship comes live from
// GET /api/backup/catalog (Prisma schema + the caller's role allowlist), so
// new tables appear automatically. Shared across Admin Settings, HR,
// Operations, Finance and Management/Director backup pages.

type CatalogField = {
  name: string;
  label: string;
  type: string;
  isList: boolean;
  enumValues?: string[];
  references?: string;
};
type CatalogRelation = { name: string; label: string; model: string; isList: boolean };
type CatalogTable = {
  name: string;
  label: string;
  category: string;
  primaryKey: string;
  defaultDateField: string | null;
  searchable: boolean;
  fields: CatalogField[];
  relations: CatalogRelation[];
};
type Catalog = { categories: { key: string; label: string; models: string[] }[]; tables: CatalogTable[] };

type NodeState = { model: string; fields: string[] | null; relations: Record<string, NodeState> };
type PickedRecord = { id: string; label: string };
type SectionState = {
  id: string;
  title: string;
  root: NodeState;
  dateField: string;
  enums: Record<string, string[]>;
  records: PickedRecord[];
};
// One row in the "choose what to export" checklist — a ready-made module,
// or a single table added via "Add another table".
type ModuleState = {
  key: string;
  label: string;
  description: string;
  statusField?: string; // drives the row's one simple Status dropdown, on sections[0]
  statusLabel?: string;
  checked: boolean;
  customizing: boolean;
  removable: boolean;
  sections: SectionState[];
};
type SectionSpec = { title: string; model: string; enums?: Record<string, string[]>; relations?: string[] };

const MAX_DEPTH = 4;

// Ready-made modules matching how staff describe their data. Each bundles
// one or more pre-configured sections; any table/relationship the viewer's
// role can't export is silently dropped, and a module with nothing left
// isn't shown.
const MODULES: {
  key: string;
  label: string;
  description: string;
  statusField?: string;
  statusLabel?: string;
  sections: SectionSpec[];
}[] = [
  {
    key: "partner-submissions",
    label: "Partnership Submissions",
    description: "Candidates submitted by partners, with the partner, programme and documents.",
    statusField: "status",
    sections: [
      {
        title: "Partnership Submissions",
        model: "PartnerCandidate",
        relations: ["partner", "job", "job_position", "documents", "reviewer", "bridged_candidate"],
      },
    ],
  },
  {
    key: "rejected",
    label: "Rejected Submissions",
    description: "Rejected partner submissions, rejected candidates and rejected cases.",
    sections: [
      {
        title: "Rejected Partner Submissions",
        model: "PartnerCandidate",
        enums: { status: ["rejected"] },
        relations: ["partner", "job", "reviewer", "documents"],
      },
      {
        title: "Rejected Candidates",
        model: "Candidate",
        enums: { lifecycle_status: ["rejected"] },
        relations: ["user", "applications", "documents"],
      },
      {
        title: "Rejected Cases",
        model: "Case",
        enums: { status: ["rejected"] },
        relations: ["application", "application.candidate", "rejected_by", "stage_events"],
      },
    ],
  },
  {
    key: "cases",
    label: "Case Information",
    description: "Cases with their candidate, programme, stage history, contract and payments.",
    statusField: "status",
    sections: [
      {
        title: "Case Information",
        model: "Case",
        relations: [
          "application",
          "application.candidate",
          "application.job",
          "stage_events",
          "contract",
          "payments",
          "payments.job_payment_stage",
          "reminders",
          "retention_follow_up",
          "ops_reviewed_by",
          "rejected_by",
        ],
      },
    ],
  },
  {
    key: "candidates",
    label: "Candidates",
    description: "Candidate profiles with their applications, documents and messages.",
    statusField: "lifecycle_status",
    sections: [
      {
        title: "Candidates",
        model: "Candidate",
        relations: ["user", "applications", "applications.job", "documents", "messages", "partner", "recruiter", "country"],
      },
    ],
  },
  {
    key: "users",
    label: "User Information",
    description: "Staff and user accounts (passwords are never included).",
    statusField: "role",
    statusLabel: "Role",
    sections: [{ title: "User Information", model: "User", relations: ["assigned_country", "supervisor"] }],
  },
  {
    key: "documents",
    label: "Documents",
    description: "Uploaded document records and who they belong to.",
    statusField: "verification_status",
    statusLabel: "Verification",
    sections: [{ title: "Documents", model: "Document", relations: ["candidate", "partner_candidate", "requirement_type"] }],
  },
  {
    key: "payments",
    label: "Payments",
    description: "Case payments and consultation bookings.",
    statusField: "status",
    sections: [
      {
        title: "Case Payments",
        model: "CasePayment",
        relations: ["case", "case.application", "job_payment_stage", "recorder", "receipt_document"],
      },
      { title: "Consultation Bookings", model: "ConsultationBooking" },
    ],
  },
];

let idCounter = 0;
const newId = () => `s${Date.now().toString(36)}${idCounter++}`;

function humanizeValue(v: string) {
  return v.replace(/_/g, " ");
}

function buildSection(tables: Map<string, CatalogTable>, spec: SectionSpec): SectionState | null {
  const table = tables.get(spec.model);
  if (!table) return null;
  const section: SectionState = {
    id: newId(),
    title: spec.title,
    root: { model: spec.model, fields: null, relations: {} },
    dateField: table.defaultDateField ?? "",
    enums: {},
    records: [],
  };
  for (const [field, values] of Object.entries(spec.enums ?? {})) {
    if (table.fields.some((f) => f.name === field)) section.enums[field] = values;
  }
  for (const path of spec.relations ?? []) {
    let node = section.root;
    for (const relName of path.split(".")) {
      const rel = tables.get(node.model)?.relations.find((r) => r.name === relName);
      if (!rel) break;
      node.relations[relName] ??= { model: rel.model, fields: null, relations: {} };
      node = node.relations[relName];
    }
  }
  return section;
}

export default function BackupExport() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [loadError, setLoadError] = useState("");
  const [mode, setMode] = useState<"full" | "custom">("full");
  const [modules, setModules] = useState<ModuleState[]>([]);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [addingTable, setAddingTable] = useState(false);
  const [showAllTables, setShowAllTables] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");
  const [lastExport, setLastExport] = useState("");

  const tables = useMemo(() => new Map((catalog?.tables ?? []).map((t) => [t.name, t])), [catalog]);

  useEffect(() => {
    fetch("/api/backup/catalog")
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Failed to load");
        const data: Catalog = await res.json();
        const byName = new Map(data.tables.map((t) => [t.name, t]));
        setCatalog(data);
        setModules(
          MODULES.map((m) => ({
            key: m.key,
            label: m.label,
            description: m.description,
            statusField: m.statusField,
            statusLabel: m.statusLabel,
            checked: false,
            customizing: false,
            removable: false,
            sections: m.sections.map((s) => buildSection(byName, s)).filter((s): s is SectionState => !!s),
          })).filter((m) => m.sections.length > 0)
        );
      })
      .catch((e: Error) => setLoadError(e.message || "Failed to load export options."));
  }, []);

  const updateModule = (key: string, patch: Partial<ModuleState>) =>
    setModules((prev) => prev.map((m) => (m.key === key ? { ...m, ...patch } : m)));

  const addTable = (model: string) => {
    const table = tables.get(model);
    const section = table ? buildSection(tables, { title: table.label, model }) : null;
    if (!table || !section) return;
    setModules((prev) => [
      ...prev,
      {
        key: section.id,
        label: table.label,
        description: catalog?.categories.find((c) => c.key === table.category)?.label ?? "",
        checked: true,
        customizing: false,
        removable: true,
        sections: [section],
      },
    ]);
    setAddingTable(false);
  };

  const selected = modules.filter((m) => m.checked);

  const download = async () => {
    setError("");
    setLastExport("");
    if (mode === "custom" && selected.length === 0) {
      setError("Tick at least one item to export.");
      return;
    }
    const body =
      mode === "full"
        ? { mode: "full" }
        : {
            mode: "custom",
            sections: selected.flatMap((m) =>
              m.sections.map((s) => ({
                title: s.title.trim() || m.label,
                root: serializeNode(s.root),
                filters: {
                  ...((start || end) && s.dateField
                    ? { dateField: s.dateField, start: start || undefined, end: end || undefined }
                    : {}),
                  enums: s.enums,
                  ...(s.records.length ? { ids: s.records.map((r) => r.id) } : {}),
                },
              }))
            ),
          };

    setExporting(true);
    try {
      const res = await fetch("/api/backup/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Export failed.");
      }
      const blob = await res.blob();
      const filename =
        /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "")?.[1] ?? "vertex-export.zip";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Revoking synchronously can cancel the download before the browser
      // has started reading the blob.
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setLastExport(filename);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed.");
    } finally {
      setExporting(false);
    }
  };

  if (loadError || !catalog) {
    return (
      <div className="card p-6">
        <h2 className="font-semibold text-midnight-900 mb-2">Backup &amp; Data Export</h2>
        <p className={`text-sm ${loadError ? "text-red-600" : "text-midnight-900/50"}`}>
          {loadError || "Loading export options…"}
        </p>
      </div>
    );
  }

  return (
    <div className="card p-6 space-y-8">
      <div>
        <h2 className="font-semibold text-midnight-900 mb-1">Backup &amp; Data Export</h2>
        <p className="text-sm text-midnight-900/50">Download your data as a ZIP of spreadsheet (CSV) files.</p>
      </div>

      <section>
        <StepHeading n={1}>What do you need?</StepHeading>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3" role="radiogroup" aria-label="Export type">
          <ModeCard
            active={mode === "full"}
            onClick={() => setMode("full")}
            icon={<Database size={20} />}
            title="Full backup"
            text="Everything you have access to, nothing left out."
          />
          <ModeCard
            active={mode === "custom"}
            onClick={() => setMode("custom")}
            icon={<SlidersHorizontal size={20} />}
            title="Choose what to export"
            text="Only the data you pick. This is not a complete backup."
          />
        </div>
      </section>

      {mode === "full" ? (
        <section>
          <p className="text-sm text-midnight-900/70">
            Includes all <strong>{catalog.tables.length} tables</strong> available to you (
            {catalog.categories.map((c) => c.label).join(", ")}), with every record and every column.
          </p>
          <button
            type="button"
            onClick={() => setShowAllTables(!showAllTables)}
            className="mt-2 inline-flex items-center gap-1 text-xs text-midnight-700 hover:underline"
            aria-expanded={showAllTables}
          >
            {showAllTables ? <CaretDown size={12} /> : <CaretRight size={12} />} See all tables
          </button>
          {showAllTables && (
            <div className="mt-3 space-y-3">
              {catalog.categories.map((c) => (
                <div key={c.key}>
                  <p className="text-xs font-medium text-midnight-900/60 mb-0.5">{c.label}</p>
                  <p className="text-xs text-midnight-900/70">{c.models.map((m) => tables.get(m)?.label ?? m).join(" · ")}</p>
                </div>
              ))}
            </div>
          )}
        </section>
      ) : (
        <>
          <section>
            <StepHeading n={2}>Choose what to export</StepHeading>
            <ul className="divide-y divide-midnight-900/10 rounded-xl border border-midnight-900/15">
              {modules.map((m) => (
                <ModuleRow
                  key={m.key}
                  module={m}
                  tables={tables}
                  onChange={(patch) => updateModule(m.key, patch)}
                  onRemove={() => setModules((prev) => prev.filter((x) => x.key !== m.key))}
                />
              ))}
            </ul>
            {addingTable ? (
              <div className="mt-3 flex items-center gap-2 max-w-md">
                <select
                  autoFocus
                  aria-label="Add another table"
                  className="input-field"
                  value=""
                  onChange={(e) => e.target.value && addTable(e.target.value)}
                >
                  <option value="">Choose a table…</option>
                  {catalog.categories.map((c) => (
                    <optgroup key={c.key} label={c.label}>
                      {c.models.map((name) => (
                        <option key={name} value={name}>
                          {tables.get(name)?.label ?? name}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => setAddingTable(false)}
                  className="text-xs text-midnight-900/50 hover:text-midnight-900"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setAddingTable(true)}
                className="mt-3 inline-flex items-center gap-1 text-xs text-midnight-700 hover:underline"
              >
                <Plus size={12} /> Add another table
              </button>
            )}
          </section>

          <section>
            <StepHeading n={3}>Date range (optional)</StepHeading>
            <div className="grid grid-cols-2 gap-3 max-w-md">
              <div>
                <label htmlFor="backup-from" className="block text-xs font-medium text-midnight-900/60 mb-1">
                  From
                </label>
                <input id="backup-from" type="date" value={start} onChange={(e) => setStart(e.target.value)} className="input-field" />
              </div>
              <div>
                <label htmlFor="backup-to" className="block text-xs font-medium text-midnight-900/60 mb-1">
                  To
                </label>
                <input id="backup-to" type="date" value={end} onChange={(e) => setEnd(e.target.value)} className="input-field" />
              </div>
            </div>
            <p className="text-xs text-midnight-900/45 mt-2">Based on when each record was created. Leave blank for all dates.</p>
          </section>
        </>
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-5 border-t border-midnight-900/10">
        <button
          onClick={download}
          disabled={exporting || (mode === "custom" && selected.length === 0)}
          className="btn-primary py-2.5 px-6 text-xs inline-flex items-center gap-2 disabled:opacity-50"
        >
          <DownloadSimple size={16} />
          {exporting ? "Preparing…" : mode === "full" ? "Download full backup" : "Download export"}
        </button>
        {mode === "custom" && (
          <span className="text-xs text-midnight-900/50">
            {selected.length === 0
              ? "Tick at least one item above"
              : `${selected.length} selected · ${start || end ? `${start || "start"} to ${end || "today"}` : "all dates"}`}
          </span>
        )}
        {lastExport && <span className="text-xs text-midnight-600">Downloaded {lastExport}</span>}
        {error && <span className="text-xs text-red-600">{error}</span>}
      </div>
    </div>
  );
}

function StepHeading({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <h3 className="flex items-center gap-2 text-sm font-semibold text-midnight-900 mb-3">
      <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-midnight-800 text-ivory-50 text-[11px]">
        {n}
      </span>
      {children}
    </h3>
  );
}

function ModuleRow({
  module: m,
  tables,
  onChange,
  onRemove,
}: {
  module: ModuleState;
  tables: Map<string, CatalogTable>;
  onChange: (patch: Partial<ModuleState>) => void;
  onRemove: () => void;
}) {
  const primary = m.sections[0];
  const statusField = m.statusField
    ? tables.get(primary.root.model)?.fields.find((f) => f.name === m.statusField && f.enumValues?.length)
    : undefined;
  const statusValues = statusField ? primary.enums[statusField.name] ?? [] : [];
  const updateSection = (id: string, patch: Partial<SectionState>) =>
    onChange({ sections: m.sections.map((s) => (s.id === id ? { ...s, ...patch } : s)) });
  const inputId = `backup-module-${m.key}`;

  return (
    <li className="p-4">
      <div className="flex flex-wrap items-start gap-3">
        <input
          id={inputId}
          type="checkbox"
          checked={m.checked}
          onChange={(e) => onChange({ checked: e.target.checked })}
          className="mt-0.5 h-4 w-4 accent-midnight-700"
        />
        <label htmlFor={inputId} className="flex-1 min-w-[12rem] cursor-pointer">
          <span className="block text-sm font-medium text-midnight-900">{m.label}</span>
          <span className="block text-xs text-midnight-900/50">{m.description}</span>
        </label>
        {m.checked && statusField && (
          <label className="flex items-center gap-2 text-xs text-midnight-900/60">
            {m.statusLabel ?? "Status"}
            <select
              value={statusValues.length === 1 ? statusValues[0] : statusValues.length > 1 ? "__multiple" : ""}
              onChange={(e) =>
                updateSection(primary.id, {
                  enums: { ...primary.enums, [statusField.name]: e.target.value ? [e.target.value] : [] },
                })
              }
              className="input-field py-1.5 text-xs w-auto capitalize"
            >
              <option value="">All</option>
              {statusValues.length > 1 && (
                <option value="__multiple" disabled>
                  {statusValues.length} selected
                </option>
              )}
              {statusField.enumValues!.map((v) => (
                <option key={v} value={v}>
                  {humanizeValue(v)}
                </option>
              ))}
            </select>
          </label>
        )}
        {m.removable && (
          <button type="button" onClick={onRemove} className="p-1 text-midnight-900/40 hover:text-red-600" aria-label={`Remove ${m.label}`}>
            <X size={14} />
          </button>
        )}
      </div>

      {m.checked && (
        <div className="ml-7 mt-2">
          <button
            type="button"
            onClick={() => onChange({ customizing: !m.customizing })}
            className="inline-flex items-center gap-1 text-xs text-midnight-700 hover:underline"
            aria-expanded={m.customizing}
          >
            {m.customizing ? <CaretDown size={12} /> : <CaretRight size={12} />}
            Customize
          </button>
          {m.customizing && (
            <div className="mt-3 space-y-4">
              {m.sections.map((s) => (
                <div key={s.id} className="rounded-lg border border-midnight-900/10 bg-ivory-50 p-4">
                  {m.sections.length > 1 && <p className="text-xs font-semibold text-midnight-900 mb-3">{s.title}</p>}
                  <SectionDetails
                    section={s}
                    tables={tables}
                    hideEnum={s === primary ? statusField?.name : undefined}
                    onChange={(patch) => updateSection(s.id, patch)}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </li>
  );
}

function serializeNode(node: NodeState): { model: string; fields?: string[]; relations?: Record<string, unknown> } {
  const relations = Object.entries(node.relations);
  return {
    model: node.model,
    ...(node.fields ? { fields: node.fields } : {}),
    ...(relations.length ? { relations: Object.fromEntries(relations.map(([k, v]) => [k, serializeNode(v)])) } : {}),
  };
}

function ModeCard({
  active,
  onClick,
  icon,
  title,
  text,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  text: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={`text-left rounded-xl border p-4 transition-colors ${
        active ? "border-midnight-700 bg-ivory-100 ring-1 ring-midnight-700" : "border-midnight-900/15 hover:border-midnight-900/30"
      }`}
    >
      <span className="flex items-center gap-2 font-semibold text-midnight-900 text-sm mb-1">
        {icon} {title}
      </span>
      <span className="block text-xs text-midnight-900/60">{text}</span>
    </button>
  );
}

// The advanced panel behind "Customize", in order of how often it's needed:
// specific records, other status/category filters (beyond the row's own
// Status dropdown), then columns and related tables. Dates are set once
// for the whole export in step 3.
function SectionDetails({
  section,
  tables,
  hideEnum,
  onChange,
}: {
  section: SectionState;
  tables: Map<string, CatalogTable>;
  hideEnum?: string;
  onChange: (patch: Partial<SectionState>) => void;
}) {
  const table = tables.get(section.root.model)!;
  const enumFields = table.fields.filter((f) => f.type === "enum" && f.enumValues?.length && f.name !== hideEnum);
  const [showFilters, setShowFilters] = useState(false);

  return (
    <div className="space-y-4">
      <RecordPicker table={table} records={section.records} onChange={(records) => onChange({ records })} />

      {enumFields.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setShowFilters(!showFilters)}
            className="inline-flex items-center gap-1 text-xs text-midnight-700 hover:underline"
            aria-expanded={showFilters}
          >
            {showFilters ? <CaretDown size={12} /> : <CaretRight size={12} />}
            More filters
          </button>
          {showFilters && (
            <div className="mt-2 space-y-3">
              {enumFields.map((f) => {
                const selected = section.enums[f.name] ?? [];
                const toggle = (v: string) =>
                  onChange({
                    enums: {
                      ...section.enums,
                      [f.name]: selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v],
                    },
                  });
                return (
                  <div key={f.name}>
                    <p className="text-xs font-medium text-midnight-900/60 mb-1.5">
                      {f.label}:{" "}
                      <span className="text-midnight-900">{selected.length ? selected.map(humanizeValue).join(", ") : "All"}</span>
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      <Chip active={selected.length === 0} onClick={() => onChange({ enums: { ...section.enums, [f.name]: [] } })}>
                        All
                      </Chip>
                      {f.enumValues!.map((v) => (
                        <Chip key={v} active={selected.includes(v)} onClick={() => toggle(v)}>
                          {humanizeValue(v)}
                        </Chip>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      <NodeEditor node={section.root} tables={tables} depth={0} onChange={(root) => onChange({ root })} />
    </div>
  );
}


function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`text-xs px-2.5 py-1 rounded-full border capitalize ${
        active ? "bg-midnight-800 text-ivory-50 border-midnight-800" : "border-midnight-900/15 text-midnight-900/70 hover:border-midnight-900/40"
      }`}
    >
      {children}
    </button>
  );
}

function NodeEditor({
  node,
  tables,
  depth,
  onChange,
}: {
  node: NodeState;
  tables: Map<string, CatalogTable>;
  depth: number;
  onChange: (node: NodeState) => void;
}) {
  const table = tables.get(node.model)!;
  const [showColumns, setShowColumns] = useState(false);
  const [showRelated, setShowRelated] = useState(false);
  const selected = node.fields ?? table.fields.map((f) => f.name);
  const includedCount = Object.keys(node.relations).length;

  const setFields = (fields: string[]) =>
    onChange({ ...node, fields: fields.length === table.fields.length ? null : fields });

  const toggleRelation = (rel: CatalogRelation) => {
    const relations = { ...node.relations };
    if (relations[rel.name]) delete relations[rel.name];
    else relations[rel.name] = { model: rel.model, fields: null, relations: {} };
    onChange({ ...node, relations });
  };

  return (
    <div className="space-y-2">
      <div>
        <button
          type="button"
          onClick={() => setShowColumns(!showColumns)}
          className="inline-flex items-center gap-1 text-xs text-midnight-700 hover:underline"
        >
          {showColumns ? <CaretDown size={12} /> : <CaretRight size={12} />}
          Columns: {selected.length === table.fields.length ? `all ${table.fields.length}` : `${selected.length} of ${table.fields.length}`}
        </button>
        {showColumns && (
          <div className="mt-2 rounded-lg bg-ivory-100/60 border border-midnight-900/10 p-3">
            <div className="flex gap-3 mb-2 text-xs">
              <button type="button" className="text-midnight-700 hover:underline" onClick={() => setFields(table.fields.map((f) => f.name))}>
                Select all
              </button>
              <button
                type="button"
                className="text-midnight-700 hover:underline"
                onClick={() => setFields([table.primaryKey])}
              >
                Clear
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-1">
              {table.fields.map((f) => (
                <label key={f.name} className="flex items-center gap-2 text-xs text-midnight-900/80 min-w-0">
                  <input
                    type="checkbox"
                    checked={selected.includes(f.name)}
                    disabled={f.name === table.primaryKey}
                    onChange={() =>
                      setFields(selected.includes(f.name) ? selected.filter((x) => x !== f.name) : [...selected, f.name])
                    }
                  />
                  <span className="truncate" title={f.name}>
                    {f.label}
                    {f.references && <span className="text-midnight-900/40"> → {tables.get(f.references)?.label ?? f.references}</span>}
                  </span>
                </label>
              ))}
            </div>
          </div>
        )}
      </div>

      {table.relations.length > 0 && depth < MAX_DEPTH && (
        <div>
          <button
            type="button"
            onClick={() => setShowRelated(!showRelated)}
            className="inline-flex items-center gap-1 text-xs text-midnight-700 hover:underline"
            aria-expanded={showRelated}
          >
            {showRelated ? <CaretDown size={12} /> : <CaretRight size={12} />}
            Related tables: {includedCount === 0 ? "none" : `${includedCount} included`}
          </button>
          {showRelated && (
            <div className="mt-2 space-y-2">
              <div className="flex flex-wrap gap-1.5">
                {table.relations.map((rel) => {
                  const target = tables.get(rel.model)?.label ?? rel.model;
                  // Only spell out the relationship name when it adds something
                  // ("Rejected By → Users"), not for "Candidate → Candidates".
                  const named = rel.label.toLowerCase() !== target.toLowerCase() && !target.toLowerCase().startsWith(rel.label.toLowerCase());
                  return (
                    <Chip key={rel.name} active={!!node.relations[rel.name]} onClick={() => toggleRelation(rel)}>
                      <span className="normal-case">{named ? `${rel.label} (${target})` : target}</span>
                    </Chip>
                  );
                })}
              </div>
              {Object.entries(node.relations).map(([relName, child]) => {
                const rel = table.relations.find((r) => r.name === relName);
                return (
                  <div key={relName} className="ml-3 pl-3 border-l-2 border-gold-300/60 space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-midnight-900">
                        {rel?.label ?? relName} ({tables.get(child.model)?.label ?? child.model})
                      </span>
                      <button
                        type="button"
                        onClick={() => rel && toggleRelation(rel)}
                        className="text-midnight-900/40 hover:text-red-600"
                        aria-label={`Remove ${rel?.label ?? relName}`}
                      >
                        <X size={12} />
                      </button>
                    </div>
                    <NodeEditor
                      node={child}
                      tables={tables}
                      depth={depth + 1}
                      onChange={(updated) => onChange({ ...node, relations: { ...node.relations, [relName]: updated } })}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function RecordPicker({
  table,
  records,
  onChange,
}: {
  table: CatalogTable;
  records: PickedRecord[];
  onChange: (records: PickedRecord[]) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{ id: string; label: string; date: string | null }[]>([]);
  const [open, setOpen] = useState(false);
  const debounced = useDebouncedValue(query, 300);

  useEffect(() => {
    if (!open) return;
    const params = new URLSearchParams({ model: table.name, q: debounced });
    let cancelled = false;
    fetch(`/api/backup/records?${params}`)
      .then((r) => (r.ok ? r.json() : { records: [] }))
      .then((data) => !cancelled && setResults(data.records ?? []))
      .catch(() => !cancelled && setResults([]));
    return () => {
      cancelled = true;
    };
  }, [debounced, open, table.name]);

  return (
    <div>
      <p className="text-xs font-medium text-midnight-900/60 mb-1.5">
        Specific records: <span className="text-midnight-900">{records.length ? `${records.length} selected` : "All matching"}</span>
      </p>
      {records.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {records.map((r) => (
            <span key={r.id} className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md bg-ivory-100 border border-midnight-900/10">
              {r.label}
              <button type="button" onClick={() => onChange(records.filter((x) => x.id !== r.id))} aria-label={`Remove ${r.label}`}>
                <X size={10} />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="relative max-w-md">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder={table.searchable ? `Search ${table.label} by name or ID…` : `Search ${table.label} by ID…`}
          className="input-field"
        />
        {open && results.length > 0 && (
          <ul className="absolute z-20 mt-1 w-full max-h-60 overflow-auto rounded-lg border border-midnight-900/15 bg-white shadow-lg">
            {results.map((r) => {
              const picked = records.some((x) => x.id === r.id);
              return (
                <li key={r.id}>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => !picked && onChange([...records, { id: r.id, label: r.label }])}
                    className={`w-full text-left px-3 py-2 text-xs hover:bg-ivory-100 ${picked ? "opacity-50" : ""}`}
                  >
                    <span className="text-midnight-900">{r.label}</span>
                    {r.date && <span className="text-midnight-900/40"> · {r.date.slice(0, 10)}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
