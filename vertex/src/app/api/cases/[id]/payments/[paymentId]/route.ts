import { NextRequest } from "next/server";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { passOn, seg } from "@/lib/pipeline";

// DELETE /api/cases/:id/payments/:paymentId — Finance removes a payment
// record entered in error (no money changed hands), in either status, so
// the stage can be offered again. The finance role only, no Director/Admin
// override: it's a correction of Finance's own mistake. Removed by FastAPI
// since payments step 7.3 (vertex_be/app/api/v1/case_payments.py,
// remove_payment). Answered as before: { message }.
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string; paymentId: string }> }) {
  const { id, paymentId } = await params;
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, ["finance"]);
  if (guardRes) return guardRes;
  return passOn(
    `/api/v1/cases/${seg(id)}/payments/${seg(paymentId)}`,
    { method: "DELETE" },
    { unwrap: true, reshape: (_data, body) => ({ message: body.message }) }
  );
}
