"use client";

import { useEffect, useState } from "react";
import PortalShell from "@/components/portal/PortalShell";
import { ADMIN_NAV_ITEMS } from "@/components/portal/adminNav";

interface StaffUser {
  id: string;
  role: string;
}

interface Region {
  id: string;
  countries: { id: string }[];
}

interface Sector {
  id: string;
}

// System Administrator's Overview is deliberately system-level (staff
// headcount, reference-data footprint) — not a recruitment-operations
// dashboard. Jobs/Applications/Candidates/Finances all belong to
// Marketing/Management, who own that work; Admin's job is provisioning
// and reference data, so that's what its own landing page reflects.
export default function AdminOverviewPage() {
  const [staff, setStaff] = useState<StaffUser[]>([]);
  const [regions, setRegions] = useState<Region[]>([]);
  const [sectors, setSectors] = useState<Sector[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch("/api/admin/users").then((r) => r.json()).catch(() => ({ data: [] })),
      fetch("/api/admin/regions").then((r) => r.json()).catch(() => ({ data: [] })),
      fetch("/api/admin/sectors").then((r) => r.json()).catch(() => ({ data: [] })),
    ])
      .then(([uRes, rRes, sRes]) => {
        setStaff(uRes.data ?? []);
        setRegions(rRes.data ?? []);
        setSectors(sRes.data ?? []);
      })
      .finally(() => setLoading(false));
  }, []);

  const countryCount = regions.reduce((sum, r) => sum + r.countries.length, 0);
  const roleCounts = staff.reduce<Record<string, number>>((acc, u) => {
    acc[u.role] = (acc[u.role] ?? 0) + 1;
    return acc;
  }, {});
  const ROLE_LABELS: Record<string, string> = {
    regional_recruiter: "Regional Recruiters",
    country_supervisor: "Country Supervisors",
    inhouse_supervisor: "In-House Supervisors",
    director: "Directors",
    marketing: "Marketing",
    admin: "System Administrators",
  };

  return (
    <PortalShell roleLabel="System Administrator" navItems={ADMIN_NAV_ITEMS}>
      <p className="eyebrow mb-3">
        <span className="eyebrow-rule" />
        System
      </p>
      <h1 className="section-title text-3xl md:text-4xl mb-8">Overview.</h1>

      {loading ? (
        <p className="text-midnight-900/50">Loading…</p>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-10">
            <div className="card p-6">
              <div className="text-xs text-gold-600 font-semibold uppercase tracking-wider mb-1">Staff Accounts</div>
              <div className="text-3xl font-semibold text-midnight-900">{staff.length}</div>
            </div>
            <div className="card p-6">
              <div className="text-xs text-gold-600 font-semibold uppercase tracking-wider mb-1">Regions</div>
              <div className="text-3xl font-semibold text-midnight-900">{regions.length}</div>
            </div>
            <div className="card p-6">
              <div className="text-xs text-midnight-900/45 font-semibold uppercase tracking-wider mb-1">Countries</div>
              <div className="text-3xl font-semibold text-midnight-900">{countryCount}</div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="card overflow-x-auto">
              <div className="p-5 border-b border-midnight-900/10">
                <h2 className="font-semibold text-midnight-900">Staff by Role</h2>
              </div>
              <table className="w-full text-sm text-left">
                <tbody>
                  {Object.entries(roleCounts).map(([role, count]) => (
                    <tr key={role} className="border-b border-midnight-900/5 last:border-0">
                      <td className="px-5 py-3 text-midnight-900/70">{ROLE_LABELS[role] ?? role}</td>
                      <td className="px-5 py-3 text-right font-medium text-midnight-900">{count}</td>
                    </tr>
                  ))}
                  {staff.length === 0 && (
                    <tr><td className="p-10 text-center text-midnight-900/40">No staff accounts yet.</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="card p-6">
              <h2 className="font-semibold text-midnight-900 mb-1">Reference Data</h2>
              <p className="text-sm text-midnight-900/50 mb-4">Sectors and taxonomy that recruitment forms and job postings draw from.</p>
              <div className="text-3xl font-semibold text-midnight-900">{sectors.length}</div>
              <div className="text-xs text-midnight-900/45 uppercase tracking-wider mt-1">Sectors configured</div>
            </div>
          </div>
        </>
      )}
    </PortalShell>
  );
}
