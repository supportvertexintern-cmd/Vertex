import { NextRequest } from "next/server";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { passOn, readJson, seg } from "@/lib/pipeline";
import { FINANCE_ROLES } from "@/lib/rbac";

// POST /api/cases/:id/payments/:paymentId/mark-paid — Finance confirms a
// pending payment arrived (a bank transfer, say), with the uploaded receipt
// as the proof, so the receipt is required. Collected by FastAPI since
// payments step 7.3 (vertex_be/app/api/v1/case_payments.py, mark_paid).
// Answered as before: { data, message }.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; paymentId: string }> }) {
  const { id, paymentId } = await params;
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, FINANCE_ROLES);
  if (guardRes) return guardRes;
  const read = await readJson(req);
  if (read.invalid) return read.invalid;
  return passOn(
    `/api/v1/cases/${seg(id)}/payments/${seg(paymentId)}/mark-paid`,
    { method: "POST", body: read.body },
    { unwrap: true, reshape: (data, body) => ({ data, message: body.message }) }
  );
}
