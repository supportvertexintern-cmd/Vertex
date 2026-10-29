import { NextRequest, NextResponse } from "next/server";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { callBackend } from "@/lib/backend";
import { pipelineResponse, readJson, seg } from "@/lib/pipeline";
import { FINANCE_ROLES } from "@/lib/rbac";
import { sendCasePaymentInvoiceEmail } from "@/lib/email";
import { getStorageContent } from "@/lib/upload";
import { assertDocumentReadable, DocumentBlockedError } from "@/lib/document-access";
import { log } from "@/lib/log";

const CONTENT_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
};

// What FastAPI's check resolves for the email.
interface InvoicePlan {
  recipient_email: string;
  recipient_name: string;
  candidate_name: string;
  passport_number: string | null;
  programme_title: string;
  sector_name: string | null;
  stage_label: string;
  storage_path: string;
}

// POST /api/cases/:id/payments/invoice — Finance emails a milestone
// invoice they generated elsewhere and uploaded via /api/upload, to the
// candidate or their partner, for any case (partner/recruiter-sourced
// cases never use Stripe). The payment is recorded by FastAPI since
// payments step 7.3 (vertex_be/app/api/v1/case_payments.py).
//
// The email is sent before the payment is recorded, so a failed send never
// leaves an "invoiced" payment behind: FastAPI checks the request first
// (/invoice/check writes nothing), this app reads and scans the file and
// sends it, then FastAPI records it (/invoice checks again).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, FINANCE_ROLES);
  if (guardRes) return guardRes;
  const read = await readJson(req, true);
  if (read.invalid) return read.invalid;

  const path = `/api/v1/cases/${seg(id)}/payments/invoice`;
  const check = await callBackend<InvoicePlan>(`${path}/check`, { method: "POST", body: read.body });
  if (!check.ok) return pipelineResponse(check, { legacyErrors: check.status < 500 });
  const plan = check.body.data;

  let fileContent: Awaited<ReturnType<typeof getStorageContent>>;
  try {
    fileContent = await getStorageContent(plan.storage_path);
    // Never email a file that fails the malware scan.
    await assertDocumentReadable(plan.storage_path, true);
  } catch (err) {
    if (err instanceof DocumentBlockedError) {
      return NextResponse.json({ error: { code: "invoice_blocked", message: err.message } }, { status: 422 });
    }
    log.error("api.failed_to_read_invoice_file_for_case", { message: `Failed to read invoice file for case ${id}.`, err });
    return NextResponse.json({ error: { code: "invoice_file_missing", message: "Could not read the uploaded invoice file." } }, { status: 502 });
  }

  try {
    await sendCasePaymentInvoiceEmail(
      plan.recipient_email,
      plan.recipient_name,
      plan.candidate_name,
      plan.passport_number,
      plan.programme_title,
      plan.sector_name,
      {
        buffer: fileContent.buffer,
        filename: `${plan.stage_label.replace(/\s+/g, "_")}_Invoice.${fileContent.extension}`,
        contentType: CONTENT_TYPES[fileContent.extension] || "application/octet-stream",
      }
    );
  } catch (err) {
    log.error("api.failed_to_send_invoice_email_for_case", { message: `Failed to send invoice email for case ${id}.`, err });
    return NextResponse.json(
      { error: { code: "invoice_email_failed", message: err instanceof Error ? err.message : "Failed to send invoice email." } },
      { status: 502 }
    );
  }

  const recorded = await callBackend(path, { method: "POST", body: read.body });
  // Sent but not recorded (FastAPI went down in between): Finance sees the
  // error and can record it by hand; the log says the email did go.
  if (!recorded.ok) log.error("api.invoice_sent_not_recorded", { case_id: id, status: recorded.status });
  return pipelineResponse(recorded, { legacyErrors: recorded.status < 500 });
}
