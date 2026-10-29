import { NextRequest } from "next/server";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { passOn, readJson, seg } from "@/lib/pipeline";
import { FINANCE_ROLES } from "@/lib/rbac";

// PATCH /api/cases/:id/payments/:paymentId/receipt — Finance attaches,
// swaps or (with null) removes a payment's invoice or receipt file, in
// either status. Saved by FastAPI since payments step 7.3
// (vertex_be/app/api/v1/case_payments.py, set_receipt).
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string; paymentId: string }> }) {
  const { id, paymentId } = await params;
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, FINANCE_ROLES);
  if (guardRes) return guardRes;
  const read = await readJson(req);
  if (read.invalid) return read.invalid;
  return passOn(`/api/v1/cases/${seg(id)}/payments/${seg(paymentId)}/receipt`, { method: "PATCH", body: read.body });
}
