"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CaretDown,
  CaretRight,
  Database,
  DownloadSimple,
  Funnel,
  Plus,
  SlidersHorizontal,
  Trash,
  X,
} from "@phosphor-icons/react";
import { useDebouncedValue } from "@/lib/useDebouncedValue";

// Backup / Data Export builder (2026-10-05) — replaces the fixed
// Candidates/Partners CSV card. Everything listed here (tables, columns,
// statuses, relationships) comes live from GET /api/backup/catalog, which
// reads the Prisma schema and the caller's role allowlist, so new tables
// appear automatically. Shared across Admin Settings, HR, Operations,
// Finance and Management/Director backup pages.

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
  start: string;
  end: string;
  enums: Record<string, string[]>;
  records: PickedRecord[];
  open: boolean;
};

const MAX_DEPTH = 4;

// Ready-made modules matching how staff describe their data. Each adds one
// or more pre-configured sections (still fully editable afterwards); any
// table/relationship the viewer's role can't export is silently dropped.
const PRESETS: {
  key: string;
  label: string;
  sections: { title: string; model: string; enums?: Record<string, string[]>; relations?: string[] }[];
}[] = [
  {
    key: "partner-submissions",
    label: "Partnership Submissions",
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
    sections: [{ title: "User Information", model: "User", relations: ["assigned_country", "supervisor"] }],
  },
  {
    key: "documents",
    label: "Documents",
    sections: [
      { title: "Documents", model: "Document", relations: ["candidate", "partner_candidate", "requirement_type"] },
    ],
  },
  {
    key: "payments",
    label: "Payments",
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

export default function BackupExport() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [loadError, setLoadError] = useState("");
  const [mode, setMode] = useState<"full" | "custom">("full");
  const [sections, setSections] = useState<SectionState[]>([]);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");
  const [lastExport, setLastExport] = useState("");

  useEffect(() => {
    fetch("/api/backup/catalog")
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Failed to load");
        setCatalog(await res.json());
      })
      .catch((e: Error) => setLoadError(e.message || "Failed to load export options."));
  }, []);

  const tables = useMemo(() => new Map((catalog?.tables ?? []).map((t) => [t.name, t])), [catalog]);

  const newSection = (model: string, title?: string): SectionState => {
    const table = tables.get(model)!;
    return {
      id: newId(),
      title: title ?? table.label,
      root: { model, fields: null, relations: {} },
      dateField: table.defaultDateField ?? "",
      start: "",
      end: "",
      enums: {},
      records: [],
      open: true,
    };
  };

  const addPreset = (preset: (typeof PRESETS)[number]) => {
    const added: SectionState[] = [];
    for (const spec of preset.sections) {
      const table = tables.get(spec.model);
      if (!table) continue;
      const section = newSection(spec.model, spec.title);
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
      added.push(section);
    }
    setSections((prev) => [...prev.map((s) => ({ ...s, open: false })), ...added]);
  };

  const availablePresets = PRESETS.filter((p) => p.sections.some((s) => tables.has(s.model)));

  const updateSection = (id: string, patch: Partial<SectionState>) =>
    setSections((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));

  const download = async () => {
    setError("");
    setLastExport("");
    if (mode === "custom" && sections.length === 0) {
      setError("Add at least one table or module to export.");
      return;
    }
    const body =
      mode === "full"
        ? { mode: "full" }
        : {
            mode: "custom",
            sections: sections.map((s) => ({
              title: s.title.trim() || tables.get(s.root.model)?.label || s.root.model,
              root: serializeNode(s.root),
              filters: {
                ...(s.start || s.end ? { dateField: s.dateField, start: s.start || undefined, end: s.end || undefined } : {}),
                enums: s.enums,
                ...(s.records.length ? { ids: s.records.map((r) => r.id) } : {}),
              },
            })),
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

  if (loadError) {
    return (
      <div className="card p-6">
        <h2 className="font-semibold text-midnight-900 mb-2">Backup &amp; Data Export</h2>
        <p className="text-sm text-red-600">{loadError}</p>
      </div>
    );
  }
  if (!catalog) {
    return (
      <div className="card p-6">
        <h2 className="font-semibold text-midnight-900 mb-2">Backup &amp; Data Export</h2>
        <p className="text-sm text-midnight-900/50">Loading export options…</p>
      </div>
    );
  }

  return (
    <div className="card p-6 space-y-6">
      <div>
        <h2 className="font-semibold text-midnight-900 mb-1">Backup &amp; Data Export</h2>
        <p className="text-sm text-midnight-900/50">
          Downloads a ZIP with one CSV per table. Columns ending in <code>_id</code> link rows across files, and{" "}
          <code>relationships.csv</code> inside the ZIP explains every link. Only tables your role can access are listed.
        </p>
      </div>

      {/* Mode */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3" role="radiogroup" aria-label="Export type">
        <ModeCard
          active={mode === "full"}
          onClick={() => setMode("full")}
          icon={<Database size={20} />}
          title="Full backup"
          text="Every table available to you — all columns, all records, no filters. Use this as a complete copy outside the CRM."
        />
        <ModeCard
          active={mode === "custom"}
          onClick={() => setMode("custom")}
          icon={<SlidersHorizontal size={20} />}
          title="Custom export"
          text="Choose the tables, columns, related tables, date range, status and specific records. Not a complete backup."
        />
      </div>

      {mode === "full" ? (
        <div className="space-y-3">
          <p className="text-xs font-medium uppercase tracking-wide text-midnight-900/50">Included in the full backup</p>
          {catalog.categories.map((c) => (
            <div key={c.key}>
              <p className="text-sm font-medium text-midnight-900 mb-1.5">{c.label}</p>
              <div className="flex flex-wrap gap-1.5">
                {c.models.map((m) => (
                  <span key={m} className="text-xs px-2 py-1 rounded-md bg-ivory-100 border border-midnight-900/10 text-midnight-900/70">
                    {tables.get(m)?.label ?? m}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-5">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-midnight-900/50 mb-2">Quick modules</p>
            <div className="flex flex-wrap gap-2">
              {availablePresets.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => addPreset(p)}
                  className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border border-midnight-900/15 hover:border-midnight-700 hover:bg-ivory-100 text-midnight-900"
                >
                  <Plus size={12} /> {p.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label htmlFor="backup-add-table" className="block text-xs font-medium uppercase tracking-wide text-midnight-900/50 mb-2">
              Or add any table
            </label>
            <select
              id="backup-add-table"
              className="input-field max-w-md"
              value=""
              onChange={(e) => {
                if (!e.target.value) return;
                const section = newSection(e.target.value);
                setSections((prev) => [...prev.map((s) => ({ ...s, open: false })), section]);
              }}
            >
              <option value="">Choose a table…</option>
              {catalog.categories.map((c) => (
                <optgroup key={c.key} label={c.label}>
                  {c.models.map((m) => (
                    <option key={m} value={m}>
                      {tables.get(m)?.label ?? m}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>

          {sections.length === 0 ? (
            <p className="text-sm text-midnight-900/50 border border-dashed border-midnight-900/15 rounded-xl p-6 text-center">
              Nothing selected yet — add a quick module or a table above.
            </p>
          ) : (
            <div className="space-y-3">
              {sections.map((s) => (
                <SectionCard
                  key={s.id}
                  section={s}
                  tables={tables}
                  onChange={(patch) => updateSection(s.id, patch)}
                  onRemove={() => setSections((prev) => prev.filter((x) => x.id !== s.id))}
                />
              ))}
            </div>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-midnight-900/10">
        <button onClick={download} disabled={exporting} className="btn-primary py-2.5 px-6 text-xs inline-flex items-center gap-2 mt-4">
          <DownloadSimple size={16} />
          {exporting ? "Preparing export…" : mode === "full" ? "Download full backup" : "Download custom export"}
        </button>
        {mode === "custom" && sections.length > 0 && (
          <span className="text-xs text-midnight-900/50 mt-4">
            {sections.length} section{sections.length === 1 ? "" : "s"}, {countTables(sections)} table
            {countTables(sections) === 1 ? "" : "s"}
          </span>
        )}
        {lastExport && <span className="text-xs text-midnight-600 mt-4">Downloaded {lastExport}</span>}
        {error && <span className="text-xs text-red-600 mt-4">{error}</span>}
      </div>
    </div>
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

function countTables(sections: SectionState[]): number {
  const walk = (n: NodeState): number => 1 + Object.values(n.relations).reduce((sum, c) => sum + walk(c), 0);
  return sections.reduce((sum, s) => sum + walk(s.root), 0);
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

function SectionCard({
  section,
  tables,
  onChange,
  onRemove,
}: {
  section: SectionState;
  tables: Map<string, CatalogTable>;
  onChange: (patch: Partial<SectionState>) => void;
  onRemove: () => void;
}) {
  const table = tables.get(section.root.model)!;
  const enumFields = table.fields.filter((f) => f.type === "enum" && f.enumValues?.length);
  const dateFields = table.fields.filter((f) => f.type === "DateTime" && !f.isList);
  const activeFilters =
    (section.start || section.end ? 1 : 0) +
    Object.values(section.enums).filter((v) => v.length).length +
    (section.records.length ? 1 : 0);
  const related = Object.keys(section.root.relations).length;

  return (
    <div className="rounded-xl border border-midnight-900/15">
      <div className="flex items-center gap-2 p-3">
        <button
          type="button"
          onClick={() => onChange({ open: !section.open })}
          className="p-1 text-midnight-900/60 hover:text-midnight-900"
          aria-label={section.open ? "Collapse section" : "Expand section"}
        >
          {section.open ? <CaretDown size={16} /> : <CaretRight size={16} />}
        </button>
        <input
          value={section.title}
          onChange={(e) => onChange({ title: e.target.value })}
          className="flex-1 min-w-0 bg-transparent font-medium text-sm text-midnight-900 focus:outline-none focus:ring-1 focus:ring-midnight-700 rounded px-1"
          aria-label="Section title"
        />
        <span className="hidden sm:inline text-xs text-midnight-900/50 whitespace-nowrap">
          {table.label}
          {related ? ` + ${related} related` : ""}
          {activeFilters ? ` · ${activeFilters} filter${activeFilters === 1 ? "" : "s"}` : " · all records"}
        </span>
        <button type="button" onClick={onRemove} className="p-1 text-midnight-900/40 hover:text-red-600" aria-label="Remove section">
          <Trash size={16} />
        </button>
      </div>

      {section.open && (
        <div className="border-t border-midnight-900/10 p-4 space-y-5">
          {/* Filters */}
          <div className="space-y-4">
            <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-midnight-900/50">
              <Funnel size={12} /> Filters for {table.label}
            </p>

            {dateFields.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-midnight-900/60 mb-1">Date column</label>
                  <select value={section.dateField} onChange={(e) => onChange({ dateField: e.target.value })} className="input-field">
                    {dateFields.map((f) => (
                      <option key={f.name} value={f.name}>
                        {f.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-midnight-900/60 mb-1">From</label>
                  <input type="date" value={section.start} onChange={(e) => onChange({ start: e.target.value })} className="input-field" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-midnight-900/60 mb-1">To</label>
                  <input type="date" value={section.end} onChange={(e) => onChange({ end: e.target.value })} className="input-field" />
                </div>
              </div>
            )}

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
                    {f.label}: <span className="text-midnight-900">{selected.length ? selected.map(humanizeValue).join(", ") : "All"}</span>
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

            <RecordPicker table={table} records={section.records} onChange={(records) => onChange({ records })} />
          </div>

          {/* Columns + related tables */}
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-midnight-900/50 mb-2">Columns &amp; related tables</p>
            <NodeEditor
              node={section.root}
              tables={tables}
              depth={0}
              onChange={(root) => onChange({ root })}
            />
          </div>
        </div>
      )}
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
  const selected = node.fields ?? table.fields.map((f) => f.name);

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
          Columns: {selected.length === table.fields.length ? "all" : selected.length} of {table.fields.length}
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
        <div className="space-y-1.5">
          <p className="text-xs text-midnight-900/50">Include related tables:</p>
          <div className="flex flex-wrap gap-1.5">
            {table.relations.map((rel) => (
              <Chip key={rel.name} active={!!node.relations[rel.name]} onClick={() => toggleRelation(rel)}>
                <span className="normal-case">
                  {rel.label} <span className="opacity-60">({tables.get(rel.model)?.label ?? rel.model}{rel.isList ? ", many" : ""})</span>
                </span>
              </Chip>
            ))}
          </div>
        </div>
      )}

      {Object.entries(node.relations).map(([relName, child]) => {
        const rel = table.relations.find((r) => r.name === relName);
        return (
          <div key={relName} className="ml-3 pl-3 border-l-2 border-gold-300/60 space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-midnight-900">
                {rel?.label ?? relName} → {tables.get(child.model)?.label ?? child.model}
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
