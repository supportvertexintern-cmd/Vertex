import { NextRequest, NextResponse } from "next/server";
import type { Role, Prisma } from "@prisma/client";
import { limitByIp } from "@/lib/rate-limit";
import { isNotFound, prisma } from "@/lib/prisma";
import { createJobSchema } from "@/lib/validations";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { getPublicJobById } from "@/server/services/publicJobs";
import { syncJobMilestonePricing } from "@/server/services/stripeProvisioning";
import { log } from "@/lib/log";
import { ensurePaymentReceiptDocumentTypes } from "@/server/services/paymentReceiptTypes";
export const dynamic = "force-dynamic";

// Editing any of these silently leaves Stripe pricing stale otherwise —
// re-sync whenever the update payload touches one of them, not just on
// creation.
const FEE_RELEVANT_FIELDS = ["service_fee_gbp", "country", "visa_type", "duration_permit", "payment_stages"] as const;

const JOB_MANAGER_ROLES = ["marketing", "admin"] as const;

// The createJobSchema fields carrying a length minimum that rows predating
// that minimum (or inserted out-of-band, bypassing POST /api/jobs) may
// legally violate — e.g. job_czech_dev's 41-char description vs the 50-char
// floor. The edit form always PUTs the complete object, so an untouched
// field would re-trigger its own minimum on every save; UNLESS this array
// has it, a one-character change elsewhere (even closing the posting) would
// 422 on stale content the user isn't editing. Stripping an unchanged field
// from the payload before validation is safe because the update below is a
// Prisma merge, not a replace — omitted fields simply don't get touched.
const MIN_LENGTH_FIELDS = ["title", "country", "city", "job_description", "requirements"] as const;

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
  const user = await getAuthUser(req);
  const isJobManager = user ? !requireRole(user, [...JOB_MANAGER_ROLES]) : false;
  // Marketing/Admin's own edit page (isJobManager) always sees a
  // partner-only job's detail regardless of ?audience= — same fix as
  // GET /api/jobs's list endpoint (2026-09-07): without this, opening a
  // Credit Service job's edit page 404'd ("Failed to load job details"),
  // since the edit page never sends audience=partner and "marketing"
  // was never in PARTNER_JOB_VISIBILITY_ROLES to begin with.
  const includePartnerOnly = isJobManager || (wantsPartnerAudience && !!user && PARTNER_JOB_VISIBILITY_ROLES.includes(user.role));

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

  const existing = await prisma.job.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Job not found." }, { status: 404 });

  // Lenient on unchanged short content (2026-09-18): the edit form submits
  // the full object, so validate only the fields that actually differ from
  // what's on file — a legacy/short description that's merely being carried
  // through unchanged must not block an unrelated edit (closing the post,
  // retweaking a fee). Fields still just skip revalidation; the merge-based
  // update below leaves them alone.
  const bodyRecord =
    typeof body === "object" && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  let payload: unknown = body;
  if (bodyRecord) {
    for (const field of MIN_LENGTH_FIELDS) {
      if (typeof bodyRecord[field] === "string" && bodyRecord[field] === existing[field]) {
        delete bodyRecord[field];
      }
    }
    payload = bodyRecord;
  }

  const parsed = createJobSchema
    .partial()
    .refine((data) => {
      if (!data.payment_stages) return true;
      // An explicit empty plan accompanies service_fee_gbp: null when
      // Marketing removes a fee from an existing posting.
      if (data.payment_stages.length === 0 && data.service_fee_gbp === null) return true;
      // Otherwise an empty plan with a fee still in place is rejected, and
      // a plan may total AT MOST 100% — financed/credit programmes list
      // only the stages the candidate actually pays through the platform,
      // with the balance repaid separately, so the percentages don't have
      // to add up to 100 anymore (2026-10-04).
      if (data.payment_stages.length === 0) return false;
      return Math.round(data.payment_stages.reduce((sum, s) => sum + s.percent, 0)) <= 100;
    }, {
      message: "Payment stage percentages must not exceed 100",
      path: ["payment_stages"],
    })
    .safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten().fieldErrors }, { status: 422 });
  }

  const { payment_stages, ...jobData } = parsed.data;
  // A full replace (delete + recreate), not a merge — Marketing's stage
  // builder always submits the complete, current set of stages, and
  // `[job_id, order]` uniqueness makes a partial upsert-by-order fragile
  // once stages are reordered/removed. CasePayment's onDelete: Restrict
  // means a stage with real payment history can't actually be deleted —
  // the transaction fails loudly instead of silently orphaning history.
  let job;
  try {
    job = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    if (payment_stages) {
      await tx.jobPaymentStage.deleteMany({ where: { job_id: id } });
      await tx.jobPaymentStage.createMany({ data: payment_stages.map((s) => ({ ...s, job_id: id })) });
    }
    return tx.job.update({ where: { id }, data: jobData });
  });
  } catch (err) {
    if (isNotFound(err)) return NextResponse.json({ error: "Job not found." }, { status: 404 });
    throw err;
  }

  if (payment_stages) {
    ensurePaymentReceiptDocumentTypes(job.id).catch((err) => console.error(`Failed to provision receipt document types for job ${job.id}.`, err));
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
