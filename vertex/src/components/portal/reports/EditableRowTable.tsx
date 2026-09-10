"use client";

import { Plus, Trash } from "@phosphor-icons/react";
import SearchableSelect from "@/components/SearchableSelect";

export interface RowColumn {
  key: string;
  label: string;
  type?: "text" | "number" | "date" | "boolean" | "select";
  // Only meaningful when type is "select" — e.g. a recruiter's own
  // candidates for the Daily Activity Report's "Candidate / CRM ID"
  // column, populated by the caller (src/components/portal/reports/
  // ReportContentForm.tsx) rather than fetched by this generic component.
  options?: { value: string; label: string }[];
}

export type RowValue = string | number | boolean | undefined;

interface Props {
  title: string;
  columns: RowColumn[];
  rows: Record<string, RowValue>[];
  onChange: (rows: Record<string, RowValue>[]) => void;
  addLabel?: string;
}

/**
 * A single generic editable table used for every row-shaped section of a
 * Supervisory Reporting Framework report (daily activity, issues/
 * blockers, achievements, priorities, competencies, pipeline) — the
 * underlying shape is the same everywhere (a labeled row with a handful
 * of optional values), only the column set and title differ per
 * src/lib/reportTemplates.ts's per-role, per-cycle configuration.
 */
export default function EditableRowTable({ title, columns, rows, onChange, addLabel = "Add row" }: Props) {
  const setCell = (rowIndex: number, key: string, value: RowValue) => {
    const next = rows.map((r, i) => (i === rowIndex ? { ...r, [key]: value } : r));
    onChange(next);
  };

  const addRow = () => onChange([...rows, {}]);
  const removeRow = (rowIndex: number) => onChange(rows.filter((_, i) => i !== rowIndex));

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-sm font-semibold text-midnight-900">{title}</h4>
        <button type="button" onClick={addRow} className="btn-secondary text-xs py-1.5 px-3">
          <Plus size={12} weight="bold" /> {addLabel}
        </button>
      </div>
      {rows.length === 0 ? (
        <p className="text-xs text-midnight-900/40">No rows yet.</p>
      ) : (
        <div className="border border-midnight-900/10 rounded-lg overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-midnight-900/10 text-left text-midnight-900/40 uppercase tracking-wider">
                {columns.map((c) => (
                  <th key={c.key} className="px-3 py-2 font-semibold whitespace-nowrap">
                    {c.label}
                  </th>
                ))}
                <th className="px-2 py-2 w-8" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i} className="border-b border-midnight-900/5 last:border-0">
                  {columns.map((c) => (
                    <td key={c.key} className="px-2 py-1.5">
                      {c.type === "boolean" ? (
                        <input
                          type="checkbox"
                          checked={Boolean(row[c.key])}
                          onChange={(e) => setCell(i, c.key, e.target.checked)}
                          className="w-4 h-4"
                        />
                      ) : c.type === "select" ? (
                        <SearchableSelect
                          value={(row[c.key] as string | undefined) ?? ""}
                          onChange={(v) => setCell(i, c.key, v)}
                          options={c.options ?? []}
                          className="input-field text-xs py-1 px-2 min-w-[160px]"
                        />
                      ) : (
                        <input
                          type={c.type === "number" ? "number" : c.type === "date" ? "date" : "text"}
                          value={(row[c.key] as string | number | undefined) ?? ""}
                          onChange={(e) =>
                            setCell(i, c.key, c.type === "number" ? (e.target.value === "" ? undefined : Number(e.target.value)) : e.target.value)
                          }
                          className="input-field text-xs py-1 px-2 min-w-[100px]"
                        />
                      )}
                    </td>
                  ))}
                  <td className="px-2 py-1.5">
                    <button type="button" onClick={() => removeRow(i)} className="text-midnight-900/30 hover:text-red-500">
                      <Trash size={14} weight="bold" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
