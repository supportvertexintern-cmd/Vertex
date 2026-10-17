import { z } from "zod";
import type { Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { buildZip } from "@/lib/zip";
import {
  allowedModels,
  canExportModel,
  delegateName,
  exportableFields,
  getModel,
  humanize,
  modelLabel,
  primaryKey,
  relationFields,
  relationLink,
  roleRowFilter,
  enumValues,
  type DmmfModel,
} from "./catalog";

// Backup/export engine (2026-10-05) — replaces the two fixed
// candidates-csv/partners-csv exports, which only ever covered 2 of the
// schema's ~45 tables. Two clearly distinct modes:
//   full   — every table the role may export, every column, every row.
//   custom — user-chosen sections: one root table each, with chosen
//            columns, filters (date range, enum/status values, specific
//            records) and any related tables followed through the
//            schema's real relationships, recursively.
// Output is always a ZIP: one CSV per table (raw column names, so the
// *_id foreign-key columns join across files), relationships.csv mapping
// those joins, manifest.json and a README stating which mode produced it.

const MAX_DEPTH = 4;
const BATCH = 500; // keeps each query well under Prisma Accelerate's response-size cap
const IN_CHUNK = 1000;
const MAX_SECTIONS = 30;
// Prefixed to every CSV so Excel opens UTF-8 names (accents, non-Latin
// scripts) correctly.
const UTF8_BOM = String.fromCharCode(0xfeff);

export type ExportNode = { model: string; fields?: string[]; relations?: Record<string, ExportNode> };

const nodeSchema: z.ZodType<ExportNode> = z.lazy(() =>
  z.object({
    model: z.string(),
    fields: z.array(z.string()).optional(),
    relations: z.record(z.string(), nodeSchema).optional(),
  })
);

const sectionSchema = z.object({
  title: z.string().trim().min(1).max(120),
  root: nodeSchema,
  filters: z
    .object({
      dateField: z.string().optional(),
      start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      enums: z.record(z.string(), z.array(z.string())).optional(),
      ids: z.array(z.string()).max(5000).optional(),
    })
    .optional(),
});

export const exportRequestSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("full") }),
  z.object({ mode: z.literal("custom"), sections: z.array(sectionSchema).min(1).max(MAX_SECTIONS) }),
]);

export type ExportRequest = z.infer<typeof exportRequestSchema>;
export type ExportSection = z.infer<typeof sectionSchema>;

export class ExportValidationError extends Error {}

type Row = Record<string, unknown>;

// Rows collected for one output folder, keyed by table then primary key so
// a row reached by two different relationship paths is only written once.
type TableSet = Map<string, { rows: Map<string, Row>; columns: Set<string> }>;

function requireModel(role: Role, name: string): DmmfModel {
  const model = getModel(name);
  if (!model || !canExportModel(role, name)) {
    throw new ExportValidationError(`You don't have access to export "${name}".`);
  }
  return model;
}

function resolveColumns(model: DmmfModel, requested?: string[]): string[] {
  const available = exportableFields(model).map((f) => f.name);
  if (!requested || requested.length === 0) return available;
  const unknown = requested.filter((f) => !available.includes(f));
  if (unknown.length) throw new ExportValidationError(`Unknown column(s) on ${model.name}: ${unknown.join(", ")}`);
  // Keep schema order regardless of the order the client sent them in.
  return available.filter((f) => requested.includes(f));
}

function combineWhere(...parts: (Record<string, unknown> | undefined)[]): Record<string, unknown> {
  const defined = parts.filter((p): p is Record<string, unknown> => !!p && Object.keys(p).length > 0);
  if (defined.length === 0) return {};
  if (defined.length === 1) return defined[0];
  return { AND: defined };
}

// Every exportable column is always fetched (not just the selected ones) —
// the relationship-following below needs the FK columns even when they
// aren't part of the user's chosen output.
async function fetchRows(role: Role, model: DmmfModel, where: Record<string, unknown>): Promise<Row[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const delegate = (prisma as any)[delegateName(model.name)];
  const pk = primaryKey(model);
  const select = Object.fromEntries(exportableFields(model).map((f) => [f.name, true]));
  select[pk] = true;
  const fullWhere = combineWhere(where, roleRowFilter(role, model.name));

  const rows: Row[] = [];
  let cursor: unknown = undefined;
  for (;;) {
    const batch: Row[] = await delegate.findMany({
      where: fullWhere,
      select,
      orderBy: { [pk]: "asc" },
      take: BATCH,
      ...(cursor !== undefined ? { cursor: { [pk]: cursor }, skip: 1 } : {}),
    });
    rows.push(...batch);
    if (batch.length < BATCH) break;
    cursor = batch[batch.length - 1][pk];
  }
  return rows;
}

async function fetchRowsWhereIn(role: Role, model: DmmfModel, column: string, values: unknown[]): Promise<Row[]> {
  const out: Row[] = [];
  for (let i = 0; i < values.length; i += IN_CHUNK) {
    out.push(...(await fetchRows(role, model, { [column]: { in: values.slice(i, i + IN_CHUNK) } })));
  }
  return out;
}

function addRows(tables: TableSet, model: DmmfModel, rows: Row[], columns: string[]) {
  let entry = tables.get(model.name);
  if (!entry) {
    entry = { rows: new Map(), columns: new Set() };
    tables.set(model.name, entry);
  }
  columns.forEach((c) => entry!.columns.add(c));
  const pk = primaryKey(model);
  for (const row of rows) entry.rows.set(String(row[pk]), row);
}

async function collectNode(role: Role, node: ExportNode, rows: Row[], tables: TableSet, depth: number) {
  const model = requireModel(role, node.model);
  addRows(tables, model, rows, resolveColumns(model, node.fields));
  if (!node.relations) return;
  if (depth >= MAX_DEPTH) throw new ExportValidationError(`Related tables can only be nested ${MAX_DEPTH} levels deep.`);

  for (const [relationName, child] of Object.entries(node.relations)) {
    const relation = relationFields(model).find((r) => r.name === relationName);
    if (!relation || relation.type !== child.model) {
      throw new ExportValidationError(`"${relationName}" is not a relationship of ${model.name}.`);
    }
    const target = requireModel(role, child.model);
    const link = relationLink(model, relation);
    if (!link) throw new ExportValidationError(`"${relationName}" on ${model.name} can't be followed.`);

    const values = [...new Set(rows.map((r) => r[link.parentColumn]).filter((v) => v !== null && v !== undefined))];
    const related = values.length ? await fetchRowsWhereIn(role, target, link.relatedColumn, values) : [];
    await collectNode(role, child, related, tables, depth + 1);
  }
}

function sectionWhere(model: DmmfModel, filters: ExportSection["filters"]): Record<string, unknown> {
  if (!filters) return {};
  const where: Record<string, unknown> = {};

  if (filters.start || filters.end) {
    const field = model.fields.find((f) => f.name === filters.dateField && f.kind === "scalar" && f.type === "DateTime");
    if (!field) throw new ExportValidationError(`Pick a date column on ${model.name} for the date range.`);
    where[field.name] = {
      ...(filters.start ? { gte: new Date(`${filters.start}T00:00:00.000Z`) } : {}),
      ...(filters.end ? { lte: new Date(`${filters.end}T23:59:59.999Z`) } : {}),
    };
  }

  for (const [fieldName, values] of Object.entries(filters.enums ?? {})) {
    if (values.length === 0) continue; // "All"
    const field = model.fields.find((f) => f.name === fieldName && f.kind === "enum");
    if (!field) throw new ExportValidationError(`"${fieldName}" is not a status/category column on ${model.name}.`);
    const allowed = enumValues(field.type);
    const bad = values.filter((v) => !allowed.includes(v));
    if (bad.length) throw new ExportValidationError(`Invalid ${fieldName} value(s): ${bad.join(", ")}`);
    where[field.name] = field.isList ? { hasSome: values } : { in: values };
  }

  if (filters.ids && filters.ids.length > 0) where[primaryKey(model)] = { in: filters.ids };
  return where;
}

// ── CSV ────────────────────────────────────────────────────────────────

function formatValue(value: unknown, isJson: boolean): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (isJson) return JSON.stringify(value);
  if (Array.isArray(value)) return value.map((v) => (v instanceof Date ? v.toISOString() : String(v))).join("; ");
  return String(value);
}

// Guards against spreadsheet formula injection from user-entered text
// (names, addresses, notes) when a staff member opens the CSV in Excel —
// without mangling ordinary phone numbers like "+254 700…".
function neutralizeFormula(str: string): string {
  return /^[=@\t\r]/.test(str) || /^[+-][^\d\s]/.test(str) ? `'${str}` : str;
}

function csvCell(str: string): string {
  return /[",\n\r]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

function toCsv(model: DmmfModel, columns: string[], rows: Iterable<Row>): string {
  const jsonCols = new Set(model.fields.filter((f) => f.type === "Json").map((f) => f.name));
  const textCols = new Set(model.fields.filter((f) => f.type === "String" || f.type === "Json").map((f) => f.name));
  const lines = [columns.map(csvCell).join(",")];
  for (const row of rows) {
    lines.push(
      columns
        .map((c) => {
          const str = formatValue(row[c], jsonCols.has(c));
          return csvCell(textCols.has(c) ? neutralizeFormula(str) : str);
        })
        .join(",")
    );
  }
  return UTF8_BOM + lines.join("\r\n") + "\r\n";
}

function relationshipsCsv(tableNames: Set<string>): string {
  const lines = ["table,column,references_table,references_column,relationship"];
  for (const name of [...tableNames].sort()) {
    const model = getModel(name)!;
    for (const rel of relationFields(model)) {
      if (!rel.relationFromFields?.length || !tableNames.has(rel.type)) continue;
      lines.push(
        [name, rel.relationFromFields[0], rel.type, rel.relationToFields?.[0] ?? "id", rel.name].map(csvCell).join(",")
      );
    }
  }
  return UTF8_BOM + lines.join("\r\n") + "\r\n";
}

function slug(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60) || "section"
  );
}

function tableFiles(folder: string, tables: TableSet) {
  const files: { name: string; content: string }[] = [];
  const counts: Record<string, number> = {};
  for (const [name, entry] of [...tables.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const model = getModel(name)!;
    // Keep schema column order even when columns were unioned from several nodes.
    const columns = exportableFields(model)
      .map((f) => f.name)
      .filter((c) => entry.columns.has(c));
    files.push({ name: `${folder}${name}.csv`, content: toCsv(model, columns, entry.rows.values()) });
    counts[name] = entry.rows.size;
  }
  files.push({ name: `${folder}relationships.csv`, content: relationshipsCsv(new Set(tables.keys())) });
  return { files, counts };
}

// ── Entry point ────────────────────────────────────────────────────────

export type ExportActor = { userId: string; role: Role; name?: string | null; email?: string | null };

export async function buildExport(actor: ExportActor, request: ExportRequest, now = new Date()) {
  const stamp = now.toISOString().slice(0, 10);
  const files: { name: string; content: string }[] = [];
  const summary: { title: string; folder: string; tables: Record<string, number> }[] = [];

  if (request.mode === "full") {
    const tables: TableSet = new Map();
    for (const name of allowedModels(actor.role)) {
      const model = getModel(name)!;
      addRows(tables, model, await fetchRows(actor.role, model, {}), resolveColumns(model));
    }
    const out = tableFiles("", tables);
    files.push(...out.files);
    summary.push({ title: "Full backup", folder: "", tables: out.counts });
  } else {
    for (const [index, section] of request.sections.entries()) {
      const model = requireModel(actor.role, section.root.model);
      const rows = await fetchRows(actor.role, model, sectionWhere(model, section.filters));
      const tables: TableSet = new Map();
      await collectNode(actor.role, section.root, rows, tables, 0);
      const folder = `${String(index + 1).padStart(2, "0")}-${slug(section.title)}/`;
      const out = tableFiles(folder, tables);
      files.push(...out.files);
      summary.push({ title: section.title, folder, tables: out.counts });
    }
  }

  const isFull = request.mode === "full";
  const manifest = {
    export_type: isFull ? "full_backup" : "custom_export",
    generated_at: now.toISOString(),
    generated_by: { id: actor.userId, name: actor.name ?? null, email: actor.email ?? null, role: actor.role },
    note: isFull
      ? "Complete backup of every table this role can access — all columns, all rows."
      : "Custom export of selected tables, columns and filters only — NOT a complete backup.",
    request,
    sections: summary,
  };
  files.unshift({ name: "manifest.json", content: JSON.stringify(manifest, null, 2) });
  files.unshift({ name: "README.txt", content: readme(actor, isFull, summary, now) });

  const filename = `vertex-${isFull ? "full-backup" : "custom-export"}_${stamp}.zip`;
  return { filename, zip: buildZip(files, now), summary, manifest };
}

// README is plain ASCII so it reads correctly in any text viewer (older
// Notepad/PowerShell default to the ANSI code page for BOM-less files).
function roleLabel(role: Role): string {
  return role === "hr" ? "HR" : humanize(role);
}

function readme(
  actor: ExportActor,
  isFull: boolean,
  summary: { title: string; folder: string; tables: Record<string, number> }[],
  now: Date
): string {
  const lines = [
    isFull ? "VERTEX CRM - FULL BACKUP" : "VERTEX CRM - CUSTOM DATA EXPORT",
    "=".repeat(40),
    "",
    isFull
      ? `This is a COMPLETE backup of every table available to the ${roleLabel(actor.role)} role:\nevery column and every row, with no filters applied.`
      : `This is a CUSTOM export. It contains ONLY the tables, columns and filters that\nwere selected - it is NOT a complete backup of the CRM.`,
    "",
    `Generated: ${now.toISOString()}`,
    `By: ${actor.name ?? ""} ${actor.email ? `<${actor.email}>` : ""} (${roleLabel(actor.role)})`.trim(),
    "",
    "How to read it",
    "--------------",
    "- Each table is one CSV file, named after its database table.",
    "- Column names are the real database column names. Columns ending in _id link",
    "  rows across files; relationships.csv lists every such link in this export.",
    "- manifest.json records exactly what was selected (tables, columns, filters).",
    "",
  ];
  for (const s of summary) {
    lines.push(isFull ? "Tables" : `Section: ${s.title}  (folder ${s.folder})`, "-".repeat(40));
    const entries = Object.entries(s.tables);
    if (entries.length === 0) lines.push("  (no rows matched)");
    for (const [table, count] of entries) lines.push(`  ${table}.csv - ${modelLabel(table)}: ${count} row(s)`);
    lines.push("");
  }
  return lines.join("\r\n");
}
