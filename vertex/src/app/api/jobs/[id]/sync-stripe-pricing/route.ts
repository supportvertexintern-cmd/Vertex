import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { syncJobMilestonePricing } from "@/server/services/stripeProvisioning";

const JOB_MANAGER_ROLES = ["marketing", "admin"] as const;

// POST /api/jobs/:id/sync-stripe-pricing — manual retry for the case a
// provisioning attempt failed (e.g. Stripe was unreachable) and needs
// re-running without changing any other field. Unlike the create/edit
// hook points, this one is awaited and reports success/failure directly,
// since a staff member explicitly asked for it to happen now.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, [...JOB_MANAGER_ROLES]);
  if (guardRes) return guardRes;

  const { id } = await params;

  try {
    await syncJobMilestonePricing(id);
  } catch (err) {
    console.error(`Manual Stripe pricing sync failed for job ${id}.`, err);
    return NextResponse.json(
      { error: { code: "stripe_sync_failed", message: err instanceof Error ? err.message : "Failed to sync Stripe pricing." } },
      { status: 502 }
    );
  }

  const prices = await prisma.jobMilestonePrice.findMany({ where: { job_id: id } });
  return NextResponse.json({ data: prices });
}
