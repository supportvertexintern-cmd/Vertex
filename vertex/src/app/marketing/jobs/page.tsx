"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import PortalShell from "@/components/portal/PortalShell";
import { MARKETING_NAV_ITEMS } from "@/components/portal/marketingNav";
import SearchableSelect from "@/components/SearchableSelect";
import SortableTh from "@/components/SortableTh";
import Pagination from "@/components/Pagination";
import { useDebouncedValue } from "@/lib/useDebouncedValue";
import { Plus } from "@phosphor-icons/react";
import FilterBar from "@/components/portal/FilterBar";

interface Job {
  id: string;
  title: string;
  country: string;
  status: string;
  created_at: string;
  _count: { applications: number };
}

const PAGE_SIZE = 15;

const STATUS_OPTIONS = [
  { value: "active", label: "Active" },
  { value: "draft", label: "Draft" },
  { value: "closed", label: "Closed" },
  { value: "all", label: "All statuses" },
];

// Real server-side pagination (2026-08-18) — previously capped at a flat
// GET /api/jobs?limit=50 with client-side slicing on top, so any posting
// past the 50th was silently unreachable, not just unpaginated. Also
// previously could never show a draft/closed posting at all (the shared
// public-listing service hardcoded status: "active"), now fixed via the
// status param's staff-only branch on GET /api/jobs.
export default function AdminJobsPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const debouncedQ = useDebouncedValue(q);
  const [status, setStatus] = useState("active");
  const [country, setCountry] = useState("");
  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState<"created_at" | "title" | "applications">("created_at");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const handleSort = (key: string) => {
    if (sortBy === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortBy(key as "created_at" | "title" | "applications"); setSortDir("asc"); }
  };

  useEffect(() => {
    setPage(1);
  }, [debouncedQ, status, country]);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE), status, sortBy, sortDir });
    if (debouncedQ) params.set("q", debouncedQ);
    if (country) params.set("country", country);
    fetch(`/api/jobs?${params}`)
      .then((r) => r.json())
      .then((res) => {
        setJobs(res.jobs ?? []);
        setTotal(res.total ?? 0);
      })
      .finally(() => setLoading(false));
  }, [page, debouncedQ, status, country, sortBy, sortDir]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const handleDelete = async (jobId: string) => {
    if (!confirm("Are you sure you want to delete this job? All associated applications will be removed too.")) return;
    const res = await fetch(`/api/jobs/${jobId}`, { method: "DELETE" });
    if (res.ok) {
      setJobs((prev) => prev.filter((j) => j.id !== jobId));
      setTotal((t) => t - 1);
    } else {
      alert("Failed to delete job.");
    }
  };

  return (
    <PortalShell roleLabel="Marketing" navItems={MARKETING_NAV_ITEMS}>
      <div className="flex items-center justify-between mb-8">
        <div>
          <p className="eyebrow mb-3">
            <span className="eyebrow-rule" />
            Recruitment
          </p>
          <h1 className="section-title text-3xl md:text-4xl">Jobs.</h1>
        </div>
        <Link href="/marketing/jobs/new" className="btn-primary text-xs">
          <Plus size={16} weight="bold" /> Post New Job
        </Link>
      </div>

      <FilterBar searchValue={q} onSearchChange={setQ} searchPlaceholder="Search by title…">
        <input
          value={country}
          onChange={(e) => setCountry(e.target.value)}
          placeholder="Country…"
          className="input-field w-48"
        />
        <SearchableSelect value={status} onChange={setStatus} className="input-field w-48" options={STATUS_OPTIONS} />
      </FilterBar>

      {loading ? (
        <p className="text-midnight-900/50">Loading…</p>
      ) : jobs.length === 0 ? (
        <div className="card p-10 text-center text-midnight-900/50">
          {q || country || status !== "active" ? "No jobs match your filters." : "No jobs posted yet."}
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="text-midnight-900/40 text-xs uppercase tracking-wider">
              <tr>
                <SortableTh label="Job Title & Location" sortKey="title" activeSort={sortBy} activeDir={sortDir} onSort={handleSort} />
                <th className="px-5 py-3 font-semibold">Status</th>
                <SortableTh label="Applicants" sortKey="applications" activeSort={sortBy} activeDir={sortDir} onSort={handleSort} />
                <SortableTh label="Posted" sortKey="created_at" activeSort={sortBy} activeDir={sortDir} onSort={handleSort} />
                <th className="px-5 py-3 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => (
                <tr key={job.id} className="border-b border-midnight-900/5 last:border-0">
                  <td className="px-5 py-4">
                    <div className="font-medium text-midnight-900">{job.title}</div>
                    <div className="text-xs text-midnight-900/45">{job.country}</div>
                  </td>
                  <td className="px-5 py-4"><span className={`badge-${job.status}`}>{job.status}</span></td>
                  <td className="px-5 py-4 font-medium text-midnight-900/70">{job._count?.applications || 0} applied</td>
                  <td className="px-5 py-4 text-xs text-midnight-900/50 whitespace-nowrap">{new Date(job.created_at).toLocaleDateString()}</td>
                  <td className="px-5 py-4 text-right space-x-4">
                    <Link href={`/jobs/${job.id}`} target="_blank" className="text-gold-600 hover:underline font-medium text-xs">View</Link>
                    <Link href={`/marketing/jobs/${job.id}/edit`} className="text-midnight-900/60 hover:text-gold-600 hover:underline font-medium text-xs">Edit</Link>
                    <button onClick={() => handleDelete(job.id)} className="text-red-500 hover:text-red-700 hover:underline font-medium text-xs">Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="px-5">
            <Pagination page={page} totalPages={totalPages} onPageChange={setPage} total={total} pageSize={PAGE_SIZE} />
          </div>
        </div>
      )}
    </PortalShell>
  );
}
