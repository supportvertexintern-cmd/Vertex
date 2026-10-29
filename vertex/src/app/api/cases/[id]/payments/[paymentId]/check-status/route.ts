import { NextRequest } from "next/server";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { passOn, seg } from "@/lib/pipeline";
import { FINANCE_ROLES } from "@/lib/rbac";

// POST /api/cases/:id/payments/:paymentId/check-status — reconciliation for
// when the Stripe webhook never fires but the candidate or partner says
// they've paid: asks Stripe directly whether the payment's link was paid,
// and collects it if so. FastAPI does this since payments step 7.3
// (vertex_be/app/api/v1/case_payments.py, check_status). Answered as
// before: { data, message }.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; paymentId: string }> }) {
  const { id, paymentId } = await params;
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, FINANCE_ROLES);
  if (guardRes) return guardRes;
  return passOn(
    `/api/v1/cases/${seg(id)}/payments/${seg(paymentId)}/check-status`,
    { method: "POST" },
    { unwrap: true, reshape: (data, body) => ({ data, message: body.message }) }
  );
}
