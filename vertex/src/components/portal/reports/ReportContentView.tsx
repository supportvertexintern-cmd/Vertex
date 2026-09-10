"use client";

import type { ReportContentValue } from "./ReportContentForm";

const STATUS_DOT: Record<string, string> = {
  green: "bg-emerald-500",
  amber: "bg-amber-500",
  red: "bg-red-500",
  grey: "bg-midnight-900/30",
};

/** Read-only rendering of a submitted report's content, for the reports list/detail. */
export default function ReportContentView({ content }: { content: Partial<ReportContentValue> }) {
  const hasAny =
    content.executive_summary || (content.kpis?.length ?? 0) > 0 || (content.issues?.length ?? 0) > 0 || (content.achievements?.length ?? 0) > 0;
  if (!hasAny) return <p className="text-xs text-midnight-900/40">No content recorded.</p>;

  return (
    <div className="space-y-3 text-xs">
      {(content.campaign_or_role || content.crm_reference) && (
        <div className="flex flex-wrap gap-x-3 text-midnight-900/50">
          {content.campaign_or_role && <span>{content.campaign_or_role}</span>}
          {content.crm_reference && <span className="font-mono">Ref: {content.crm_reference}</span>}
        </div>
      )}
      {content.overall_status && (
        <div className="flex items-center gap-1.5">
          <span className={`w-2 h-2 rounded-full ${STATUS_DOT[content.overall_status] ?? "bg-midnight-900/30"}`} />
          <span className="font-medium capitalize text-midnight-900/70">{content.overall_status}</span>
        </div>
      )}
      {content.executive_summary && <p className="text-midnight-900/70">{content.executive_summary}</p>}

      {(content.kpis?.length ?? 0) > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {content.kpis!.map((k, i) => (
            <span key={i} className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-ivory-100 border border-midnight-900/10 text-midnight-900/70">
              {k.label}: <span className="font-semibold">{k.actual ?? "—"}</span>
              {k.target != null && <span className="text-midnight-900/40">/ {k.target}</span>}
            </span>
          ))}
        </div>
      )}

      {(content.issues?.length ?? 0) > 0 && (
        <div>
          <div className="font-semibold text-midnight-900/50 uppercase tracking-wider text-[10px] mb-1">Issues</div>
          <ul className="space-y-1">
            {content.issues!.map((row, i) => (
              <li key={i} className="text-midnight-900/70">
                <span className="font-medium">{String(row.label ?? "")}</span>
                {row.detail ? ` — ${row.detail}` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}

      {(content.achievements?.length ?? 0) > 0 && (
        <div>
          <div className="font-semibold text-midnight-900/50 uppercase tracking-wider text-[10px] mb-1">Achievements / Findings</div>
          <ul className="space-y-1">
            {content.achievements!.map((row, i) => (
              <li key={i} className="text-midnight-900/70">
                {String(row.label ?? "")}
              </li>
            ))}
          </ul>
        </div>
      )}

      {content.key_achievement && (
        <p className="text-midnight-900/70">
          <span className="font-semibold">Key achievement:</span> {content.key_achievement}
        </p>
      )}
      {content.next_priority && (
        <p className="text-midnight-900/70">
          <span className="font-semibold">Next priority:</span> {content.next_priority}
        </p>
      )}
    </div>
  );
}
