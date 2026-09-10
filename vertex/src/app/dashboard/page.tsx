"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import PortalShell from "@/components/portal/PortalShell";
import { CANDIDATE_NAV_ITEMS } from "@/components/portal/candidateNav";
import {
  ClipboardText,
  FileText,
  Airplane,
  Warning,
  ArrowRight,
  MapPin,
  Tray,
} from "@phosphor-icons/react";

interface Application {
  id: string;
  application_status: string;
  submitted_at: string;
  job: { id: string; title: string; country: string; city: string } | null;
  preferred_country_1: { name: string } | null;
  preferred_sector: { name: string } | null;
  required_document_types: string[];
}

interface Profile {
  documents: { type: string }[];
  _count: { applications: number };
  user: { full_name: string };
}

interface CaseSummary {
  id: string;
  current_stage: string;
  contract: { status: string } | null;
}

function StatusBadge({ status }: { status: string }) {
  const cls: Record<string, string> = {
    submitted: "badge-pending", under_review: "badge-under_review",
    interview: "badge-shortlisted", rejected: "badge-rejected", approved: "badge-hired",
  };
  return <span className={cls[status] ?? "badge bg-slate-100 text-slate-600"}>{status.replace("_", " ")}</span>;
}

export default function CandidateOverviewPage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [applications, setApplications] = useState<Application[]>([]);
  const [cases, setCases] = useState<CaseSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch("/api/candidates/profile").then((r) => r.json()),
      fetch("/api/applications").then((r) => r.json()),
      fetch("/api/cases?status=all").then((r) => r.json()).catch(() => ({ data: [] })),
    ]).then(([p, a, c]) => {
      setProfile(p.error ? null : p);
      setApplications(Array.isArray(a) ? a : []);
      setCases(c.data ?? []);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <PortalShell roleLabel="Candidate" navItems={CANDIDATE_NAV_ITEMS}>
        <p className="text-midnight-900/50">Loading…</p>
      </PortalShell>
    );
  }

  const uploadedTypes = new Set(profile?.documents.map((d) => d.type) ?? []);
  const requiredTypes = [...new Set(applications.flatMap((a) => a.required_document_types))];
  const missingTypes = requiredTypes.filter((t) => !uploadedTypes.has(t));

  const unsignedCase = cases.find((c) => c.contract && c.contract.status !== "signed");

  const pendingActions: { label: string; href: string }[] = [];
  if (missingTypes.length > 0) {
    pendingActions.push({
      label: `${missingTypes.length} document${missingTypes.length === 1 ? "" : "s"} still needed`,
      href: "/dashboard/documents",
    });
  }
  if (unsignedCase) {
    pendingActions.push({ label: "Contract awaiting your signature", href: "/dashboard/cases" });
  }

  return (
    <PortalShell roleLabel="Candidate" navItems={CANDIDATE_NAV_ITEMS}>
      <p className="eyebrow mb-3">
        <span className="eyebrow-rule" />
        My Account
      </p>
      <h1 className="section-title text-3xl md:text-4xl mb-2">Overview.</h1>
      <p className="text-midnight-900/55 font-light mb-8 max-w-2xl">
        Welcome back, {profile?.user.full_name ?? "there"}.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 mb-8">
        <div className="card p-6 flex items-center gap-4">
          <div className="w-12 h-12 rounded-full bg-midnight-950/5 flex items-center justify-center shrink-0">
            <ClipboardText size={22} weight="regular" className="text-midnight-800" />
          </div>
          <div>
            <div className="text-2xl font-semibold text-midnight-900">{profile?._count.applications ?? 0}</div>
            <div className="text-midnight-900/50 text-sm">Applications</div>
          </div>
        </div>
        <div className="card p-6 flex items-center gap-4">
          <div className="w-12 h-12 rounded-full bg-midnight-950/5 flex items-center justify-center shrink-0">
            <FileText size={22} weight="regular" className="text-midnight-800" />
          </div>
          <div>
            <div className="text-2xl font-semibold text-midnight-900">
              {requiredTypes.length - missingTypes.length}/{requiredTypes.length}
            </div>
            <div className="text-midnight-900/50 text-sm">Documents complete</div>
          </div>
        </div>
        <div className="card p-6 flex items-center gap-4">
          <div className="w-12 h-12 rounded-full bg-midnight-950/5 flex items-center justify-center shrink-0">
            <Airplane size={22} weight="regular" className="text-midnight-800" />
          </div>
          <div>
            <div className="text-2xl font-semibold text-midnight-900 capitalize">
              {cases[0]?.current_stage.replace(/_/g, " ") ?? "—"}
            </div>
            <div className="text-midnight-900/50 text-sm">{cases.length > 0 ? "Case stage" : "No case yet"}</div>
          </div>
        </div>
      </div>

      {pendingActions.length > 0 && (
        <div className="card p-6 mb-8 border-amber-200 bg-amber-50/40">
          <h2 className="text-sm font-semibold text-midnight-900/70 uppercase tracking-wider mb-3 flex items-center gap-1.5">
            <Warning size={14} weight="bold" className="text-amber-600" /> Pending actions
          </h2>
          <div className="space-y-2">
            {pendingActions.map((a) => (
              <Link key={a.href + a.label} href={a.href} className="flex items-center justify-between text-sm text-midnight-900 hover:underline">
                {a.label} <ArrowRight size={14} weight="bold" />
              </Link>
            ))}
          </div>
        </div>
      )}

      <div className="card p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold text-midnight-900">My Applications</h2>
          <Link href="/jobs" className="text-sm text-gold-600 hover:underline">Browse More Jobs →</Link>
        </div>

        {applications.length === 0 ? (
          <div className="text-center py-10 text-midnight-900/40">
            <Tray size={36} weight="regular" className="mx-auto mb-3" />
            <p>No applications yet. <Link href="/jobs" className="text-gold-600 hover:underline">Browse Jobs</Link></p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="text-midnight-900/40 text-xs uppercase tracking-wider">
                <tr className="border-b border-midnight-900/10">
                  <th className="px-5 py-3 font-semibold">Programme</th>
                  <th className="px-5 py-3 font-semibold">Status</th>
                  <th className="px-5 py-3 font-semibold">Applied On</th>
                  <th className="px-5 py-3 font-semibold text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {applications.map((app) => (
                  <tr key={app.id} className="border-b border-midnight-900/5 last:border-0">
                    <td className="px-5 py-4">
                      {app.job ? (
                        <>
                          <div className="font-medium text-midnight-900 mb-1">{app.job.title}</div>
                          <div className="text-midnight-900/45 text-xs flex items-center gap-1">
                            <MapPin size={12} weight="regular" /> {app.job.city}, {app.job.country}
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="font-medium text-midnight-900 mb-1">{app.preferred_sector?.name ?? "General Programme Application"}</div>
                          {app.preferred_country_1 && (
                            <div className="text-midnight-900/45 text-xs flex items-center gap-1">
                              <MapPin size={12} weight="regular" /> {app.preferred_country_1.name}
                            </div>
                          )}
                        </>
                      )}
                    </td>
                    <td className="px-5 py-4"><StatusBadge status={app.application_status} /></td>
                    <td className="px-5 py-4 text-midnight-900/60">{new Date(app.submitted_at).toLocaleDateString()}</td>
                    <td className="px-5 py-4 text-right">
                      {app.job && (
                        <Link href={`/jobs/${app.job.id}`} className="inline-flex items-center gap-1 text-sm font-semibold text-gold-600 hover:underline">
                          View Job <ArrowRight size={14} weight="bold" />
                        </Link>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </PortalShell>
  );
}
