"use client";

export interface KpiRow {
  label: string;
  target?: number;
  actual?: number;
  comment?: string;
}

interface Props {
  labels: string[];
  rows: KpiRow[];
  onChange: (rows: KpiRow[]) => void;
}

/**
 * The Target-and-Performance KPI table (Supervisory Reporting Framework
 * §2.1) — row labels are fixed per role/cycle (src/lib/reportTemplates.ts),
 * only target/actual/comment are editable. Variance is always derived
 * (actual - target), never entered, so it can't drift from the two
 * numbers it's supposed to describe.
 */
export default function ReportKpiTable({ labels, rows, onChange }: Props) {
  const rowFor = (label: string): KpiRow => rows.find((r) => r.label === label) ?? { label };

  const setRow = (label: string, patch: Partial<KpiRow>) => {
    const existing = rows.some((r) => r.label === label);
    const next = existing
      ? rows.map((r) => (r.label === label ? { ...r, ...patch } : r))
      : [...rows, { label, ...patch }];
    onChange(next);
  };

  if (labels.length === 0) return null;

  return (
    <div>
      <h4 className="text-sm font-semibold text-midnight-900 mb-2">Target and Performance</h4>
      <div className="border border-midnight-900/10 rounded-lg overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-midnight-900/10 text-left text-midnight-900/40 uppercase tracking-wider">
              <th className="px-3 py-2 font-semibold">KPI</th>
              <th className="px-3 py-2 font-semibold w-20">Target</th>
              <th className="px-3 py-2 font-semibold w-20">Actual</th>
              <th className="px-3 py-2 font-semibold w-20">Variance</th>
              <th className="px-3 py-2 font-semibold">Comment</th>
            </tr>
          </thead>
          <tbody>
            {labels.map((label) => {
              const row = rowFor(label);
              const variance = row.target != null && row.actual != null ? row.actual - row.target : null;
              return (
                <tr key={label} className="border-b border-midnight-900/5 last:border-0">
                  <td className="px-3 py-1.5 font-medium text-midnight-900 whitespace-nowrap">{label}</td>
                  <td className="px-2 py-1.5">
                    <input
                      type="number"
                      value={row.target ?? ""}
                      onChange={(e) => setRow(label, { target: e.target.value === "" ? undefined : Number(e.target.value) })}
                      className="input-field text-xs py-1 px-2 w-20"
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <input
                      type="number"
                      value={row.actual ?? ""}
                      onChange={(e) => setRow(label, { actual: e.target.value === "" ? undefined : Number(e.target.value) })}
                      className="input-field text-xs py-1 px-2 w-20"
                    />
                  </td>
                  <td className={`px-3 py-1.5 font-semibold ${variance == null ? "text-midnight-900/30" : variance >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                    {variance == null ? "—" : variance > 0 ? `+${variance}` : variance}
                  </td>
                  <td className="px-2 py-1.5">
                    <input
                      type="text"
                      value={row.comment ?? ""}
                      onChange={(e) => setRow(label, { comment: e.target.value })}
                      className="input-field text-xs py-1 px-2 min-w-[140px]"
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
