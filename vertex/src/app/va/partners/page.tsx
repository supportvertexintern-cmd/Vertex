"use client";

import { useEffect, useState } from "react";
import PortalShell from "@/components/portal/PortalShell";
import { VA_NAV_ITEMS } from "@/components/portal/vaNav";

// The virtual assistant's working list (Phase 6): each partner's onboarding
// status, who looks after it and its submissions. A VA sees only its own
// partners; FastAPI decides (GET /api/v1/va/partners).

interface PartnerRow {
  id: string;
  name: string;
  status: string;
  mou_status: string;
  sla_status: string;
  assigned_team_member: { id: string; full_name: string } | null;
  submissions: number;
}

export default function VaPartnersPage() {
  const [partners, setPartners] = useState<PartnerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");

  useEffect(() => {
    fetch("/api/va/partners")
      .then((r) => r.json())
      .then((res) => { if (res.error) throw new Error(res.error.message); setPartners(res.data ?? []); })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load partners."))
      .finally(() => setLoading(false));
  }, []);

  const filtered = partners.filter((p) => p.name.toLowerCase().includes(query.toLowerCase()));

  return (
    <PortalShell roleLabel="Virtual Assistant" navItems={VA_NAV_ITEMS}>
      <div className="mb-6 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-midnight-900">Partners</h1>
          <p className="text-sm text-midnight-900/50 mt-1">{partners.length} partners on file.</p>
        </div>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search partners…"
          className="input-field w-full md:w-72"
        />
      </div>

      {error && <div className="card p-4 mb-6 border-l-4 border-red-400 text-red-700 text-sm">{error}</div>}

      <div className="card overflow-x-auto">
        {loading ? (
          <div className="p-10 text-center text-midnight-900/50">Loading partners…</div>
        ) : filtered.length === 0 ? (
          <div className="p-10 text-center text-midnight-900/50">No partners found.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-midnight-900/10 text-left text-midnight-900/40 text-xs uppercase tracking-wider">
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">MOU / SLA</th>
                <th className="px-4 py-3">Assigned to</th>
                <th className="px-4 py-3">Submissions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <tr key={p.id} className="border-b border-midnight-900/5">
                  <td className="px-4 py-3 font-semibold">{p.name}</td>
                  <td className="px-4 py-3"><span className="badge bg-midnight-100 text-midnight-800">{p.status}</span></td>
                  <td className="px-4 py-3">
                    <span className={`badge ${p.mou_status === "signed" ? "bg-emerald-100 text-emerald-800" : "bg-yellow-100 text-yellow-800"}`}>MOU {p.mou_status}</span>
                    <span className={`badge ml-1 ${p.sla_status === "signed" ? "bg-emerald-100 text-emerald-800" : "bg-yellow-100 text-yellow-800"}`}>SLA {p.sla_status}</span>
                  </td>
                  <td className="px-4 py-3">{p.assigned_team_member?.full_name ?? "—"}</td>
                  <td className="px-4 py-3">{p.submissions}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </PortalShell>
  );
}