import { prisma } from "@/lib/prisma";

/**
 * Shared query logic behind the public /jobs listing, /jobs/[id] detail,
 * and the homepage's featured jobs — called directly (in-process) by both
 * the Server Component pages and the /api/jobs* route handlers, rather
 * than a page self-fetching its own API route over HTTP. A self-fetch
 * needs an absolute base URL (NEXT_PUBLIC_APP_URL) that's easy to
 * misconfigure per-environment, and — on a project with Vercel Deployment
 * Protection enabled — gets blocked by that same protection wall even when
 * the URL is correct, since Vercel doesn't distinguish "the server calling
 * its own public URL" from any other external request.
 */

const PUBLIC_JOB_LIST_SELECT = {
  id: true,
  title: true,
  country: true,
  city: true,
  category: true,
  tier: true,
  salary_range: true,
  job_description: true,
  status: true,
  created_at: true,
  visa_type: true,
  duration_permit: true,
  service_fee_gbp: true,
  _count: { select: { applications: true } },
} as const;

export interface PublicJobsListParams {
  page?: number;
  limit?: number;
  country?: string;
  category?: string;
  q?: string;
  // Only ever set by the route's own staff-auth branch (Marketing/Admin
  // managing their own postings, 2026-08-18) — every public caller
  // (homepage, /jobs listing) leaves this unset and gets the original
  // "active" cap. Marketing needs its own draft/closed postings visible
  // too, and "all" opts out of the status filter entirely.
  status?: "draft" | "active" | "closed" | "all";
  sortBy?: "created_at" | "title" | "applications";
  sortDir?: "asc" | "desc";
}

export async function getPublicJobsList(params: PublicJobsListParams = {}) {
  const page = Math.max(1, params.page ?? 1);
  // The 50-row cap only ever applied to the public listing (a sane
  // ceiling for a public page-size param) — Marketing's own management
  // list passes its own real limit and needs every posting reachable,
  // not silently truncated at 50.
  const maxLimit = params.status ? 200 : 50;
  const limit = Math.min(maxLimit, Math.max(1, params.limit ?? 10));
  const skip = (page - 1) * limit;

  const where = {
    ...(params.status && params.status !== "all" ? { status: params.status } : params.status === "all" ? {} : { status: "active" as const }),
    ...(params.country ? { country: { contains: params.country, mode: "insensitive" as const } } : {}),
    ...(params.category ? { category: { equals: params.category } } : {}),
    ...(params.q
      ? {
          OR: [
            { title: { contains: params.q, mode: "insensitive" as const } },
            { job_description: { contains: params.q, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const sortDir = params.sortDir ?? "desc";
  const orderBy =
    params.sortBy === "title"
      ? { title: sortDir }
      : params.sortBy === "applications"
      ? { applications: { _count: sortDir } }
      : { created_at: sortDir };

  const [jobs, total] = await Promise.all([
    prisma.job.findMany({
      where,
      skip,
      take: limit,
      orderBy,
      select: PUBLIC_JOB_LIST_SELECT,
    }),
    prisma.job.count({ where }),
  ]);

  return { jobs, total, page, pages: Math.ceil(total / limit) };
}

export async function getPublicJobById(id: string) {
  return prisma.job.findUnique({
    where: { id },
    include: { _count: { select: { applications: true } } },
  });
}
