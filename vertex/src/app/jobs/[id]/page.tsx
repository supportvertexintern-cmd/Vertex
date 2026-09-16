import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  MapPin, Tag, CurrencyCircleDollar, Users, CalendarBlank, CaretRight,
  IdentificationCard, Clock, ShieldCheck, CheckCircle, ArrowRight,
} from "@phosphor-icons/react/dist/ssr";
import { getPublicJobById } from "@/server/services/publicJobs";
import { getAuthUser } from "@/lib/api-auth";
import ServiceFeeNotice from "@/components/ServiceFeeNotice";
import PaymentStagesPreview, { type PaymentStageOption } from "@/components/PaymentStagesPreview";
export const dynamic = "force-dynamic";

interface Job {
  id: string;
  title: string;
  country: string;
  city: string;
  category: string | null;
  tier: string | null;
  salary_range: string | null;
  job_description: string;
  requirements: string;
  status: string;
  created_at: string | Date;
  visa_type: string | null;
  duration_permit: string | null;
  processing_time: string | null;
  service_fee_gbp: number | null;
  visa_success_rates: string | null;
  partner_only: boolean;
  is_credit_service: boolean;
  payment_stages: PaymentStageOption[];
  _count: { applications: number };
}

// Calls the same query the API route uses directly (in-process), rather
// than self-fetching /api/jobs/[id] over HTTP — see server/services/publicJobs.ts.
async function getJob(id: string, includePartnerOnly: boolean): Promise<Job | null> {
  try {
    return await getPublicJobById(id, includePartnerOnly);
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const user = await getAuthUser();
  const job = await getJob(id, user?.role === "partner");
  if (!job) return { title: "Job Not Found" };
  return {
    title: `${job.title} — ${job.city}, ${job.country}`,
    description: job.job_description.slice(0, 160),
  };
}

export default async function JobDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getAuthUser();
  const includePartnerOnly = user?.role === "partner";
  const job = await getJob(id, includePartnerOnly);
  if (!job) notFound();

  const isActive = job.status === "active";

  const ApplyButton = ({ className }: { className?: string }) =>
    isActive ? (
      job.partner_only ? (
        <Link href="/partner" className={`btn-gold ${className ?? ""}`}>
          Submit a Candidate <ArrowRight size={16} weight="bold" />
        </Link>
      ) : (
        <Link href={`/apply?job=${job.id}`} className={`btn-gold ${className ?? ""}`}>
          Apply Now <ArrowRight size={16} weight="bold" />
        </Link>
      )
    ) : (
      <div className="bg-midnight-900/5 text-midnight-900/50 rounded-full px-6 py-3.5 text-sm text-center">
        No longer accepting applications
      </div>
    );

  return (
    <div className="bg-ivory-50 min-h-screen">
      {/* Breadcrumb */}
      <div className="bg-white border-b border-midnight-900/10">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-4 text-sm flex items-center gap-2">
          <Link href="/jobs" className="text-midnight-900/50 hover:text-gold-600 font-medium transition-colors">
            Opportunities
          </Link>
          <CaretRight size={11} weight="bold" className="text-midnight-900/25" />
          <span className="text-midnight-900 font-medium truncate">{job.title}</span>
        </div>
      </div>

      {/* Hero */}
      <section className="bg-midnight-950 text-ivory-50 py-14 md:py-16">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8">
          <p className="eyebrow-dark mb-5">
            <span className="eyebrow-rule" />
            {job.country} · {job.city}
          </p>
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
            <h1 className="text-3xl md:text-5xl font-semibold tracking-tight leading-[1.05] max-w-3xl">
              {job.title}
            </h1>
            <span className={`badge-${job.status} flex-shrink-0`}>{job.status}</span>
          </div>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 mt-6 text-ivory-50/55 text-sm font-light">
            {job.is_credit_service && (
              <span className="inline-flex items-center rounded-full bg-gold-500/20 text-gold-300 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide">
                Credit Service Programme
              </span>
            )}
            {job.category && (
              <span className="inline-flex items-center gap-1.5">
                <Tag size={15} weight="regular" /> {job.category}
              </span>
            )}
            {job.tier && (
              <span className="inline-flex items-center rounded-full bg-white/10 text-ivory-50/70 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide">
                {job.tier}
              </span>
            )}
            {job.salary_range && (
              <span className="inline-flex items-center gap-1.5 text-gold-300 font-medium">
                <CurrencyCircleDollar size={15} weight="regular" /> {job.salary_range}
              </span>
            )}
            <span className="inline-flex items-center gap-1.5">
              <Users size={15} weight="regular" /> {job._count.applications} applied
            </span>
            <span className="inline-flex items-center gap-1.5">
              <CalendarBlank size={15} weight="regular" /> Posted {new Date(job.created_at).toLocaleDateString()}
            </span>
          </div>
        </div>
      </section>

      {/* Content */}
      <section className="py-12 md:py-16">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 grid lg:grid-cols-3 gap-8 lg:gap-10 items-start">
          {/* Main column */}
          <div className="lg:col-span-2 space-y-6">
            {/* Programme facts */}
            {(job.visa_type || job.duration_permit || job.processing_time) && (
              <div className="bg-white rounded-2xl border border-midnight-900/10 p-6 md:p-8">
                <h2 className="text-lg font-semibold text-midnight-900 tracking-tight mb-5">Programme Facts</h2>
                <div className="grid sm:grid-cols-3 gap-5">
                  {job.visa_type && (
                    <div>
                      <div className="flex items-center gap-1.5 text-xs uppercase tracking-[0.1em] text-midnight-900/40 font-semibold mb-1.5">
                        <IdentificationCard size={14} weight="regular" /> Visa Type
                      </div>
                      <div className="text-midnight-900 font-medium">{job.visa_type}</div>
                    </div>
                  )}
                  {job.duration_permit && (
                    <div>
                      <div className="flex items-center gap-1.5 text-xs uppercase tracking-[0.1em] text-midnight-900/40 font-semibold mb-1.5">
                        <CalendarBlank size={14} weight="regular" /> Duration / Permit
                      </div>
                      <div className="text-midnight-900 font-medium">{job.duration_permit}</div>
                    </div>
                  )}
                  {job.processing_time && (
                    <div>
                      <div className="flex items-center gap-1.5 text-xs uppercase tracking-[0.1em] text-midnight-900/40 font-semibold mb-1.5">
                        <Clock size={14} weight="regular" /> Processing Time
                      </div>
                      <div className="text-midnight-900 font-medium">{job.processing_time}</div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Visa success rate */}
            {job.visa_success_rates && (
              <div className="bg-white rounded-2xl border border-midnight-900/10 p-6 md:p-8">
                <h2 className="flex items-center gap-2 text-lg font-semibold text-midnight-900 tracking-tight mb-3">
                  <ShieldCheck size={18} weight="regular" className="text-gold-600" /> Visa Success Rate by Region
                </h2>
                <p className="text-midnight-900/60 font-light leading-relaxed">{job.visa_success_rates}</p>
              </div>
            )}

            {/* Description */}
            <div className="bg-white rounded-2xl border border-midnight-900/10 p-6 md:p-8">
              <h2 className="text-lg font-semibold text-midnight-900 tracking-tight mb-3">Overview</h2>
              <p className="text-midnight-900/65 font-light leading-relaxed whitespace-pre-wrap">
                {job.job_description}
              </p>
            </div>

            {/* Requirements */}
            <div className="bg-white rounded-2xl border border-midnight-900/10 p-6 md:p-8">
              <h2 className="flex items-center gap-2 text-lg font-semibold text-midnight-900 tracking-tight mb-3">
                <CheckCircle size={18} weight="regular" className="text-gold-600" /> Required Documents
              </h2>
              <p className="text-midnight-900/65 font-light leading-relaxed whitespace-pre-wrap">
                {job.requirements}
              </p>
            </div>

            {/* Mobile apply (sidebar is hidden below lg) */}
            <div className="lg:hidden">
              <ApplyButton className="w-full text-base py-4" />
            </div>
          </div>

          {/* Sidebar */}
          <aside className="hidden lg:block lg:sticky lg:top-28 space-y-6">
            <div className="bg-white rounded-2xl border border-midnight-900/10 p-6">
              <ApplyButton className="w-full text-base py-4" />
              <p className="text-xs text-midnight-900/40 text-center mt-3">
                Takes about 10 minutes · country &amp; type of work pre-filled
              </p>
            </div>

            {job.service_fee_gbp != null && job.payment_stages.length > 0 ? (
              <div className="bg-midnight-950 text-ivory-50 rounded-2xl p-6">
                {job.is_credit_service ? (
                  <p className="text-xs font-semibold uppercase tracking-[0.1em] text-gold-300 mb-3">Credit Service Programme</p>
                ) : (
                  <ServiceFeeNotice variant="dark" />
                )}
                <div className="flex items-baseline justify-between gap-2 mb-5 pt-1 border-t border-white/10">
                  <span className="text-xs font-semibold uppercase tracking-[0.1em] text-ivory-50/60">Total{job.is_credit_service ? " Credit Service Fee" : ""}</span>
                  <span className="text-2xl font-semibold text-gold-300">
                    {job.service_fee_gbp.toLocaleString()} <span className="text-sm font-medium">GBP</span>
                  </span>
                </div>
                <PaymentStagesPreview totalGbp={job.service_fee_gbp} stages={job.payment_stages} variant="dark" className="mb-5" />
                <p className="text-xs text-ivory-50/40 leading-relaxed">
                  {job.is_credit_service
                    ? "International airfare is not included unless a different arrangement is confirmed in writing; the consular fee is per embassy requirements and payable separately where required."
                    : "Air tickets and embassy fees are not included and are payable separately. Accommodation is provided (may be deducted from salary)."}
                </p>
              </div>
            ) : null}
          </aside>
        </div>
      </section>
    </div>
  );
}
