import { NextRequest, NextResponse } from "next/server";
import type { Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createJobSchema } from "@/lib/validations";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { getPublicJobsList } from "@/server/services/publicJobs";
import { syncJobMilestonePricing } from "@/server/services/stripeProvisioning";
import { log } from "@/lib/log";
export const dynamic = "force-dynamic";

// Job postings are Marketing's sole responsibility — a role deliberately
// kept outside the three-tier operational hierarchy (Regional Supervisory
// Operational Workflow). Admin keeps override access.
const JOB_MANAGER_ROLES = ["marketing", "admin"] as const;

// Same role set already authorized to submit a candidate on a partner's
// behalf (POST /api/partner/candidates) — a partner-only Job becomes
// visible in exactly the contexts a partner submission is already
// legitimately made in. regional_recruiter is deliberately excluded: the
// self-apply/recruiter-walk-in ApplicationForm never sends ?audience=
// partner at all, so this list only matters for callers that do.
const PARTNER_JOB_VISIBILITY_ROLES: Role[] = ["partner", "hr", "operations_team", "operations_director", "admin"];

// GET /api/jobs — public paginated listing. Also called directly
// (in-process, not over HTTP) by the homepage and /jobs listing Server
// Components — see server/services/publicJobs.ts for why. `status`/
// `sortBy` (2026-08-18) are only ever honored for an authenticated
// Marketing/Admin caller (their own /marketing/jobs management list,
// which previously reused this same endpoint but could never see a
// draft/closed posting — status was hardcoded to "active" unconditionally)
// — a public request never gets to see anything off the active list.
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const user = await getAuthUser(req);
  const isJobManager = user ? !requireRole(user, [...JOB_MANAGER_ROLES]) : false;
  const status = isJobManager ? (searchParams.get("status") as "draft" | "active" | "closed" | "all" | null) ?? undefined : undefined;
  const sortBy = isJobManager ? (searchParams.get("sortBy") as "created_at" | "title" | "applications" | null) ?? undefined : undefined;
  const sortDir = isJobManager && searchParams.get("sortDir") === "asc" ? "asc" : "desc";
  const wantsPartnerAudience = searchParams.get("audience") === "partner";
  // Marketing/Admin's own management list (isJobManager) always sees
  // partner-only jobs regardless of ?audience= — they're the ones who
  // create and maintain every Job, Credit Service or not, so hiding a
  // partner-only posting from their own list made it permanently
  // unreachable to edit/manage or add sectors & positions to (2026-09-07).
  // The audience=partner mechanism below is a separate, narrower gate for
  // the actual application-form/partner-portal contexts.
  const includePartnerOnly = isJobManager || (wantsPartnerAudience && !!user && PARTNER_JOB_VISIBILITY_ROLES.includes(user.role));

  const result = await getPublicJobsList({
    page: Number(searchParams.get("page") || 1),
    limit: Number(searchParams.get("limit") || 10),
    country: searchParams.get("country") || undefined,
    category: searchParams.get("category") || undefined,
    q: searchParams.get("q") || undefined,
    status,
    sortBy,
    sortDir,
    includePartnerOnly,
  });

  return NextResponse.json(result);
}

// POST /api/jobs — Marketing (admin retains override)
export async function POST(req: NextRequest) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, [...JOB_MANAGER_ROLES]);
  if (guardRes) return guardRes;

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const parsed = createJobSchema
    .refine((data) => !data.is_credit_service || (data.financing_percent != null && data.installment_count != null), {
      message: "financing_percent and installment_count are required when is_credit_service is true",
      path: ["financing_percent"],
    })
    .safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten().fieldErrors }, { status: 422 });
  }

  const job = await prisma.job.create({ data: parsed.data });

  // Provisions the 3 Stripe Products/Prices for this opportunity — never
  // blocks Job creation on a Stripe outage/misconfiguration.
  syncJobMilestonePricing(job.id).catch((err) => log.error("api.failed_to_provision_stripe_pricing_for_job", { message: `Failed to provision Stripe pricing for job ${job.id}.`, err }));

  return NextResponse.json(job, { status: 201 });
}
