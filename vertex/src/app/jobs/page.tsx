import type { Metadata } from "next";
import Link from "next/link";
import { MapPin, Tag, CurrencyCircleDollar, Users, ArrowRight, MagnifyingGlass } from "@phosphor-icons/react/dist/ssr";
import JobsCategoryFilter from "@/components/JobsCategoryFilter";
import ServiceFeeNotice from "@/components/ServiceFeeNotice";
import { getPublicJobsList } from "@/server/services/publicJobs";
import { getAuthUser } from "@/lib/api-auth";
import { computeCreditServiceSchedule } from "@/lib/fees";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Browse Jobs",
  description: "Explore international career opportunities at Vertex International Recruitment.",
};

interface Job {
  id: string;
  title: string;
  country: string;
  city: string;
  category: string | null;
  tier: string | null;
  salary_range: string | null;
  job_description: string | null;
  status: string;
  created_at: string | Date;
  visa_type: string | null;
  duration_permit: string | null;
  service_fee_gbp: number | null;
  partner_only: boolean;
  is_credit_service: boolean;
  financing_percent: number | null;
  installment_count: number | null;
  _count: { applications: number };
}

// Calls the same query the API route uses directly (in-process), rather
// than self-fetching /api/jobs over HTTP — see server/services/publicJobs.ts.
async function getJobs(searchParams: { page?: string; country?: string; category?: string; q?: string }, includePartnerOnly: boolean) {
  try {
    return await getPublicJobsList({
      page: Number(searchParams.page || 1),
      limit: 15,
      country: searchParams.country || undefined,
      category: searchParams.category || undefined,
      q: searchParams.q || undefined,
      includePartnerOnly,
    });
  } catch {
    return { jobs: [], total: 0, pages: 1 };
  }
}

export default async function JobsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; country?: string; category?: string; q?: string }>;
}) {
  const params = await searchParams;
  const user = await getAuthUser();
  const includePartnerOnly = user?.role === "partner";
  const { jobs, total, pages } = await getJobs(params, includePartnerOnly);
  const currentPage = Number(params.page || 1);

  // Matches the sector naming seeded in prisma/seed.ts (2026-08-31, renamed
  // to match the business's own Positions by Country & Sector reference
  // sheet) — every work-permit programme's category is one of these.
  const categories = [
    "Agriculture", "Logistics & Warehousing", "Manufacturing & Production",
    "Construction & Trades", "Hospitality", "Healthcare", "Transport & Delivery",
    "General / Unskilled",
  ];

  return (
    <div className="bg-ivory-50 min-h-screen">
      {/* Header */}
      <section className="bg-midnight-950 text-ivory-50 py-20 md:py-24">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8">
          <p className="eyebrow-dark mb-6">
            <span className="eyebrow-rule" />
            Careers abroad
          </p>
          <h1 className="text-4xl md:text-6xl font-semibold tracking-tight leading-[1.02] mb-4">
            Open positions.
          </h1>
          <p className="text-ivory-50/50 text-lg font-light">{total} opportunities across the globe</p>
        </div>
      </section>

      {/* Filters */}
      <section className="bg-ivory-50/95 backdrop-blur-md border-b border-midnight-900/10 sticky top-20 z-40">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <form method="get" className="flex flex-col md:flex-row gap-3 items-center">
            <input
              name="q"
              defaultValue={params.q || ""}
              placeholder="Search job title or keyword..."
              className="input-field w-full md:w-auto md:min-w-[280px] text-sm"
            />
            <input
              name="country"
              defaultValue={params.country || ""}
              placeholder="Country..."
              className="input-field w-full md:w-48 text-sm"
            />
            <JobsCategoryFilter categories={categories} defaultValue={params.category || ""} />
            <button type="submit" className="btn-primary w-full md:w-auto text-xs py-3 px-7">
              <MagnifyingGlass size={14} weight="bold" /> Search
            </button>
            {(params.country || params.category || params.q) && (
              <Link href="/jobs" className="text-sm font-medium text-midnight-900/50 hover:text-red-600 transition-colors w-full md:w-auto text-center">
                Clear All
              </Link>
            )}
          </form>
        </div>
      </section>

      {/* Job list */}
      <section className="py-14 md:py-20">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8">
          <ServiceFeeNotice variant="light" />
          {jobs.length === 0 ? (
            <div className="text-center py-24 bg-white rounded-2xl border border-midnight-900/10">
              <h3 className="text-xl font-semibold text-midnight-900 tracking-tight">No jobs found</h3>
              <p className="text-midnight-900/50 font-light mt-2 mb-8">Try adjusting your search criteria or removing filters.</p>
              <Link href="/jobs" className="btn-primary">View All Jobs</Link>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {jobs.map((job: Job) => (
                <div
                  key={job.id}
                  className="bg-white border border-midnight-900/10 rounded-2xl p-8 flex flex-col h-full hover:border-gold-500/60 transition-colors group"
                >
                  <div className="flex items-start justify-between gap-4 mb-5">
                    <div>
                      <h2 className="font-semibold text-midnight-900 text-xl md:text-2xl tracking-tight group-hover:text-midnight-700 transition-colors leading-tight mb-3">
                        {job.title}
                      </h2>
                      <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-sm text-midnight-900/55 font-light">
                        <span className="inline-flex items-center gap-1.5">
                          <MapPin size={15} weight="regular" /> {job.city}, {job.country}
                        </span>
                        {job.category && (
                          <span className="inline-flex items-center gap-1.5">
                            <Tag size={15} weight="regular" /> {job.category}
                          </span>
                        )}
                        {job.salary_range && (
                          <span className="inline-flex items-center gap-1.5 text-midnight-800 font-medium">
                            <CurrencyCircleDollar size={15} weight="regular" /> {job.salary_range}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                      {job.is_credit_service && (
                        <span className="inline-flex items-center rounded-full bg-gold-500/15 text-gold-700 border border-gold-500/40 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
                          Credit Service
                        </span>
                      )}
                      {job.tier && (
                        <span className="inline-flex items-center rounded-full bg-midnight-900/5 text-midnight-900/60 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
                          {job.tier}
                        </span>
                      )}
                      <span className={`badge-${job.status}`}>{job.status}</span>
                    </div>
                  </div>

                  <p className="text-midnight-900/60 text-sm font-light mb-6 line-clamp-2 leading-relaxed flex-grow">
                    {job.job_description || "Click to view full description and requirements for this role."}
                  </p>

                  {job.service_fee_gbp != null && job.is_credit_service && job.financing_percent != null && job.installment_count != null ? (
                    <div className="flex flex-wrap items-center gap-2 mb-6">
                      {(() => {
                        const s = computeCreditServiceSchedule(job.service_fee_gbp, job.financing_percent, job.installment_count);
                        return (
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-gold-500/10 text-gold-700 border border-gold-500/30 px-3 py-1 text-xs font-semibold">
                            Upfront £{s.upfrontGbp.toLocaleString()} · {s.installmentCount}× £{s.installmentAmountGbp.toLocaleString()}
                          </span>
                        );
                      })()}
                      {job.duration_permit && (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-midnight-900/5 text-midnight-900/60 px-3 py-1 text-xs font-medium">
                          {job.duration_permit}
                        </span>
                      )}
                    </div>
                  ) : job.service_fee_gbp != null ? (
                    <div className="flex flex-wrap items-center gap-2 mb-6">
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-gold-500/10 text-gold-700 border border-gold-500/30 px-3 py-1 text-xs font-semibold">
                        Service fee: {job.service_fee_gbp.toLocaleString()} GBP
                      </span>
                      {job.duration_permit && (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-midnight-900/5 text-midnight-900/60 px-3 py-1 text-xs font-medium">
                          {job.duration_permit}
                        </span>
                      )}
                    </div>
                  ) : null}

                  <div className="flex items-center justify-between pt-6 border-t border-midnight-900/10 mt-auto">
                    <div className="flex items-center gap-5 text-xs text-midnight-900/40 uppercase tracking-[0.1em]">
                      <span className="flex items-center gap-1.5">
                        <Users size={14} weight="regular" /> {job._count?.applications || 0} applied
                      </span>
                    </div>
                    <div className="flex items-center gap-5">
                      <Link
                        href={`/jobs/${job.id}`}
                        className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.15em] text-midnight-800 hover:text-gold-600 transition-colors"
                      >
                        View details <ArrowRight size={14} weight="bold" />
                      </Link>
                      {job.status === "active" && (
                        <Link
                          href={job.partner_only ? "/partner" : `/apply?job=${job.id}`}
                          className="btn-primary text-xs py-2.5 px-5"
                        >
                          {job.partner_only ? "Submit a Candidate" : "Apply"}
                        </Link>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Pagination */}
          {pages > 1 && (
            <div className="flex justify-center mt-14">
              <div className="flex gap-1 bg-white p-1.5 rounded-full border border-midnight-900/10">
                {Array.from({ length: pages }, (_, i) => i + 1).map((p) => {
                  const search = new URLSearchParams({
                    page: p.toString(),
                    ...(params.country && { country: params.country }),
                    ...(params.category && { category: params.category }),
                    ...(params.q && { q: params.q })
                  });
                  return (
                    <Link
                      key={p}
                      href={`/jobs?${search.toString()}`}
                      className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold transition-all ${
                        p === currentPage
                          ? "bg-midnight-800 text-ivory-50"
                          : "text-midnight-900/60 hover:bg-ivory-100"
                      }`}
                    >
                      {p}
                    </Link>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
