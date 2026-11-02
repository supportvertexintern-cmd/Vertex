import { callBackend } from "@/lib/backend";

/**
 * The public job listing and detail, read from FastAPI since reads handover
 * R1 (GET /api/v1/jobs, GET /api/v1/jobs/:id in vertex_be/app/api/v1/jobs.py).
 * Shared by the /api/jobs* routes and the pages that render jobs on the
 * server (the homepage, /jobs, /jobs/[id]).
 *
 * FastAPI decides what the caller may see from their session: drafts and
 * other statuses, and sorting, only for a job manager; partner-only jobs
 * for a job manager, or with audience "partner" for a role that submits
 * for partners. Callers pass the request's parameters on as they are.
 */

export interface PublicPaymentStage {
  id: string;
  job_id: string;
  order: number;
  label: string;
  percent: number;
  trigger_stage: string;
  stripe_product_id: string | null;
  stripe_price_id: string | null;
  synced_amount_gbp: number | null;
  created_at: string;
  updated_at: string;
}

export interface PublicJob {
  id: string;
  title: string;
  country: string;
  city: string;
  category: string | null;
  tier: string | null;
  salary_range: string | null;
  job_description: string;
  status: "draft" | "active" | "closed";
  created_at: string;
  visa_type: string | null;
  duration_permit: string | null;
  service_fee_gbp: number | null;
  partner_only: boolean;
  is_credit_service: boolean;
  payment_stages: PublicPaymentStage[];
  sectors: { id: string; sector: string; positions: { id: string; title: string; city: string | null }[] }[];
  _count: { applications: number };
}

export interface PublicJobDetail extends PublicJob {
  requirements: string;
  processing_time: string | null;
  visa_success_rates: string | null;
}

export interface PublicJobsList {
  jobs: PublicJob[];
  total: number;
  page: number;
  pages: number;
}

export type PublicJobsQuery = Partial<Record<"page" | "limit" | "country" | "category" | "q" | "status" | "sortBy" | "sortDir" | "audience", string | number>>;

export class PublicJobsUnavailable extends Error {}

/** The listing; throws PublicJobsUnavailable when FastAPI can't answer. */
export async function getPublicJobsList(query: PublicJobsQuery = {}): Promise<PublicJobsList> {
  const result = await callBackend<PublicJobsList>("/api/v1/jobs", { query, asUser: "if-signed-in" });
  if (!result.ok) throw new PublicJobsUnavailable(result.error.message);
  return result.body.data;
}

/** A public job, or null when there is none the caller may see. */
export async function getPublicJobById(id: string, audience?: "partner"): Promise<PublicJobDetail | null> {
  const result = await callBackend<PublicJobDetail>(`/api/v1/jobs/${encodeURIComponent(id)}`, {
    query: { audience },
    asUser: "if-signed-in",
  });
  if (result.ok) return result.body.data;
  if (result.status === 404) return null;
  throw new PublicJobsUnavailable(result.error.message);
}
