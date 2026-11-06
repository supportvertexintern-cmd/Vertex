import { NextRequest } from "next/server";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { callBackend } from "@/lib/backend";
import { pipelineResponse, readJson, seg } from "@/lib/pipeline";
import { FINANCE_ROLES } from "@/lib/rbac";

// POST /api/cases/:id/payments/invoice — Finance emails a milestone
// invoice they generated elsewhere and uploaded via /api/upload, to the
// candidate or their partner, for any case (partner/recruiter-sourced
// cases never use Stripe). FastAPI does it all since reads handover R7b
// (vertex_be/app/api/v1/case_payments.py): checks the request, reads the
// file, refuses one that fails the malware scan, sends the email, and only
// then records the payment, so a failed send leaves nothing behind.
//
// Refusals keep their older string form; the file and email failures (and
// a blocked file) keep { error: { code, message } }.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, FINANCE_ROLES);
  if (guardRes) return guardRes;
  const read = await readJson(req, true);
  if (read.invalid) return read.invalid;

  const res = await callBackend(`/api/v1/cases/${seg(id)}/payments/invoice`, { method: "POST", body: read.body });
  return pipelineResponse(res, { legacyErrors: !res.ok && res.status < 500 && res.error.code !== "invoice_blocked" });
}
