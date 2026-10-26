import { NextRequest } from "next/server";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { backendResponse, callBackend } from "@/lib/backend";

// Must match JOB_MANAGERS in vertex_be/app/api/v1/jobs.py (tests check it).
const JOB_MANAGER_ROLES = ["marketing", "admin"] as const;

// POST /api/jobs/:id/sync-stripe-pricing — manual retry for the case a
// provisioning attempt failed (e.g. Stripe was unreachable) and needs
// re-running without changing any other field. FastAPI talks to Stripe
// since backend plan step 3.2 (vertex_be/app/services/stripe_pricing.py):
// it runs the sync now and answers { data: [each stage's Stripe ids] }, or
// 502 stripe_sync_failed / 503 stripe_not_configured.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, [...JOB_MANAGER_ROLES]);
  if (guardRes) return guardRes;

  const { id } = await params;
  return backendResponse(await callBackend(`/api/v1/jobs/${encodeURIComponent(id)}/stripe-pricing/sync`, { method: "POST" }));
}
