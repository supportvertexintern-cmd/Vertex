import { NextRequest } from "next/server";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { callBackend } from "@/lib/backend";
import { pipelineResponse, readJson, seg } from "@/lib/pipeline";
import { FINANCE_ROLES } from "@/lib/rbac";

// POST /api/cases/:id/payments/link — Finance (Director/Admin keep the
// override) sends a Stripe Payment Link for one of a self-applicant case's
// payment stages, on the stage's provisioned Price, to the candidate or
// their partner. FastAPI creates the link and the pending payment since
// payments step 7.3 (vertex_be/app/api/v1/case_payments.py,
// send_payment_link); this app sends the email it lists. Answered as
// before: { data: { payment, url } }, refusals as { error }, and Stripe's
// own failures as { error: { code, message } }.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, FINANCE_ROLES);
  if (guardRes) return guardRes;
  const read = await readJson(req, true);
  if (read.invalid) return read.invalid;
  const result = await callBackend(`/api/v1/cases/${seg(id)}/payments/link`, { method: "POST", body: read.body });
  return pipelineResponse(result, { legacyErrors: result.status < 500 });
}
