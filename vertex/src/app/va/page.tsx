"use client";

import { useEffect, useState } from "react";
import PortalShell from "@/components/portal/PortalShell";
import { VA_NAV_ITEMS } from "@/components/portal/vaNav";

// The virtual assistant's dashboard (Phase 6): summary widgets, the partners
// needing attention and the commissions due, worked out by FastAPI on every
// read (GET /api/v1/va/overview). The per-partner tracking pages come next.

interface OverviewData {
  summary: {
    total_partners: number;
    agreements_signed: number;
    agreements_unsigned: number;
    reports_submitted: number;
    reports_outstanding: number;
    applications_started: number;
    applications_not_started: number;
    total_candidates: number;
    no_recent_activity: number;
    commissions_due: number;
    partners_flagged: number;
  };
  flags: Array<{ partner_id: string; partner_name: string; assigned_to: string | null; flags: string[]; commissions_due: number }>;
  recent_partners: Array<{ id: string; name: string; status: string; assigned_to: string | null; candidates: number }>;
}

const FLAG_STYLES: Record<string, string> = {
  "MOU not signed": "bg-yellow-100 text-yellow-800",
  "SLA not signed": "bg-yellow-100 text-yellow-800",
  "Onboarding documents pending": "bg-orange-100 text-orange-700",
  "Report outstanding": "bg-red-100 text-red-700",
  "No report recorded": "bg-orange-100 text-orange-700",
  "Signed but no applications yet": "bg-blue-100 text-blue-700",
  "No candidates submitted": "bg-blue-100 text-blue-700",
  "No activity in 14 days": "bg-midnight-100 text-midnight-800",
};

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="card p-4">
      <div className="text-xs font-semibold text-midnight-900/50 uppercase tracking-wider">{label}</div>
      <div className="text-xl font-bold text-midnight-900 mt-1">{value}</div>
    </div>
  );
}

export default function VaOverviewPage() {
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/va/overview")
      .then((r) => r.json())
      .then((res) => { if (res.error) throw new Error(res.error.message); setData(res.data); })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load dashboard."))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <PortalShell roleLabel="Virtual Assistant" navItems={VA_NAV_ITEMS}>
        <div className="card p-10 text-center text-midnight-900/50">Loading dashboard…</div>
      </PortalShell>
    );
  }

  if (error) {
    return (
      <PortalShell roleLabel="Virtual Assistant" navItems={VA_NAV_ITEMS}>
        <div className="card p-6 border-l-4 border-red-400 text-red-700 text-sm">{error}</div>
      </PortalShell>
    );
  }

  const s = data!.summary;

  return (
    <PortalShell roleLabel="Virtual Assistant" navItems={VA_NAV_ITEMS}>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-midnight-900">Partner Overview</h1>
        <p className="text-sm text-midnight-900/50 mt-1">Real-time partner onboarding, reporting, application progress and commission follow-ups.</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 mb-8">
        <Stat label="Total partners" value={s.total_partners} />
        <Stat label="Agreements signed" value={`${s.agreements_signed} / ${s.total_partners}`} />
        <Stat label="Reports on file" value={`${s.reports_submitted} / ${s.total_partners}`} />
        <Stat label="Applications started" value={s.applications_started} />
        <Stat label="Candidates submitted" value={s.total_candidates} />
        <Stat label="Partners awaiting follow-up" value={s.partners_flagged} />
        <Stat label="No activity (14 days)" value={s.no_recent_activity} />
        <Stat label="Commissions due (USD)" value={s.commissions_due.toLocaleString()} />
      </div>

      <h2 className="text-sm font-semibold text-midnight-900/50 uppercase tracking-wider mb-3">Needs attention</h2>
      {data!.flags.length === 0 ? (
        <div className="card p-8 text-center text-midnight-900/50 mb-8">No partner flags — everything is on track.</div>
      ) : (
        <div className="card overflow-x-auto mb-8">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-midnight-900/10 text-left text-midnight-900/40 text-xs uppercase tracking-wider">
                <th className="px-4 py-3">Partner</th>
                <th className="px-4 py-3">Assigned to</th>
                <th className="px-4 py-3">Flags</th>
                <th className="px-4 py-3">Commissions due</th>
              </tr>
            </thead>
            <tbody>
              {data!.flags.map((f) => (
                <tr key={f.partner_id} className="border-b border-midnight-900/5">
                  <td className="px-4 py-3 font-semibold">{f.partner_name}</td>
                  <td className="px-4 py-3">{f.assigned_to ?? "—"}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1.5">
                      {f.flags.map((flag) => (
                        <span key={flag} className={`badge ${FLAG_STYLES[flag] ?? "bg-midnight-100 text-midnight-800"}`}>{flag}</span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3">USD {f.commissions_due.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2 className="text-sm font-semibold text-midnight-900/50 uppercase tracking-wider mb-3">Partners</h2>
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-midnight-900/10 text-left text-midnight-900/40 text-xs uppercase tracking-wider">
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Assigned to</th>
              <th className="px-4 py-3">Candidates</th>
            </tr>
          </thead>
          <tbody>
            {data!.recent_partners.map((p) => (
              <tr key={p.id} className="border-b border-midnight-900/5">
                <td className="px-4 py-3 font-semibold">{p.name}</td>
                <td className="px-4 py-3"><span className="badge bg-midnight-100 text-midnight-800">{p.status}</span></td>
                <td className="px-4 py-3">{p.assigned_to ?? "—"}</td>
                <td className="px-4 py-3">{p.candidates}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </PortalShell>
  );
}