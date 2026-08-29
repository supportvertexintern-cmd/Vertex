import { NextRequest, NextResponse } from "next/server";
import type { Role } from "@prisma/client";
import { limitByIp } from "@/lib/rate-limit";
import { isNotFound, prisma } from "@/lib/prisma";
import { createJobSchema } from "@/lib/validations";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { getPublicJobById } from "@/server/services/publicJobs";
import { syncJobMilestonePricing } from "@/server/services/stripeProvisioning";
import { log } from "@/lib/log";
export const dynamic = "force-dynamic";

// Editing any of these silently leaves Stripe pricing stale otherwise —
// re-sync whenever the update payload touches one of them, not just on
// creation.
const FEE_RELEVANT_FIELDS = ["service_fee_gbp", "country", "visa_type", "duration_permit"] as const;

const JOB_MANAGER_ROLES = ["marketing", "admin"] as const;

// Same role set as src/app/api/jobs/route.ts's PARTNER_JOB_VISIBILITY_ROLES
// — see that file for the full rationale.
const PARTNER_JOB_VISIBILITY_ROLES: Role[] = ["partner", "hr", "operations_team", "operations_director", "admin"];

// GET /api/jobs/[id] — public. Also called directly (in-process, not over
// HTTP) by /jobs/[id]'s Server Component — see server/services/publicJobs.ts.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const limited = limitByIp(req, "job-detail", { max: 120 });
  if (limited) return limited;
  const { id } = await params;
  const { searchParams } = req.nextUrl;
  const wantsPartnerAudience = searchParams.get("audience") === "partner";
  const user = wantsPartnerAudience ? await getAuthUser(req) : null;
  const includePartnerOnly = wantsPartnerAudience && !!user && PARTNER_JOB_VISIBILITY_ROLES.includes(user.role);

  const job = await getPublicJobById(id, includePartnerOnly);
  if (!job) return NextResponse.json({ error: "Job not found." }, { status: 404 });
  return NextResponse.json(job);
}

// PUT /api/jobs/[id] — Marketing (admin retains override)
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, [...JOB_MANAGER_ROLES]);
  if (guardRes) return guardRes;

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const parsed = createJobSchema.partial().safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten().fieldErrors }, { status: 422 });
  }

  let job;
  try {
    job = await prisma.job.update({ where: { id }, data: parsed.data });
  } catch (err) {
    if (isNotFound(err)) return NextResponse.json({ error: "Job not found." }, { status: 404 });
    throw err;
  }

  if (FEE_RELEVANT_FIELDS.some((field) => field in parsed.data)) {
    syncJobMilestonePricing(job.id).catch((err) => log.error("api.failed_to_re_sync_stripe_pricing_for", { message: `Failed to re-sync Stripe pricing for job ${job.id}.`, err }));
  }

  return NextResponse.json(job);
}

// DELETE /api/jobs/[id] — Marketing (admin retains override)
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, [...JOB_MANAGER_ROLES]);
  if (guardRes) return guardRes;

  try {
    await prisma.job.delete({ where: { id } });
  } catch (err) {
    if (isNotFound(err)) return NextResponse.json({ error: "Job not found." }, { status: 404 });
    throw err;
  }
  return NextResponse.json({ message: "Job deleted." });
}
