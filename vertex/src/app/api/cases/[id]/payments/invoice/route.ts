import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auditedPrisma } from "@/lib/audit";
import { sendCaseInvoiceSchema } from "@/lib/validations";
import { getAuthUser, requireRole, forbidden } from "@/lib/api-auth";
import { canAccessCase } from "@/server/scope";
import { FINANCE_ROLES } from "@/lib/rbac";
import { sendCasePaymentInvoiceEmail } from "@/lib/email";
import { getStorageContent } from "@/lib/upload";
import { assertDocumentReadable, DocumentBlockedError } from "@/lib/document-access";
import { MILESTONE_DESCRIPTIONS } from "@/server/services/stripeProvisioning";

import { log } from "@/lib/log";
const CONTENT_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
};

// POST /api/cases/:id/payments/invoice — Finance emails a case milestone
// invoice they've already generated elsewhere and uploaded via
// /api/upload (2026-08-04). This app never generates the invoice itself —
// Finance supplies the amount/recipient/which uploaded file, everything
// else is resolved here. Available regardless of the candidate's source:
// partner/recruiter-sourced cases never go through Stripe at all, and
// this also covers a self-applicant case when Stripe itself isn't
// available.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, FINANCE_ROLES);
  if (guardRes) return guardRes;

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const parsed = sendCaseInvoiceSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten().fieldErrors }, { status: 422 });
  }

  const caseRecord = await prisma.case.findUnique({
    where: { id },
    include: {
      application: {
        include: {
          job: { select: { title: true, category: true } },
          candidate: {
            include: {
              user: { select: { email: true, full_name: true } },
              partner: { select: { name: true, contact_email: true, contact_name: true } },
            },
          },
        },
      },
    },
  });
  if (!caseRecord) return NextResponse.json({ error: "Case not found." }, { status: 404 });

  const candidate = caseRecord.application.candidate;
  const allowed = await canAccessCase(user!, {
    user_id: candidate.user_id,
    recruiter_id: candidate.recruiter_id,
    country_id: candidate.country_id,
    partner_id: candidate.partner_id,
  });
  if (!allowed) return forbidden({ error: "Forbidden." });

  // Same admin-configured FeePolicy gate as the Record form and Payment
  // Link routes — this is still recording/collecting a milestone payment,
  // just via an emailed invoice instead of a staff-entered receipt or a
  // real Stripe charge.
  const countryId = candidate.country_id;
  const [countryPolicy, globalPolicy] = await Promise.all([
    countryId ? prisma.feePolicy.findFirst({ where: { country_id: countryId } }) : Promise.resolve(null),
    prisma.feePolicy.findFirst({ where: { country_id: null } }),
  ]);
  const effectivePolicy = countryPolicy ?? globalPolicy;
  if (!effectivePolicy?.enabled) {
    return NextResponse.json({ error: "Milestone payments are not enabled for this destination. In-House must enable the fee policy first." }, { status: 403 });
  }

  // The uploaded invoice must actually belong to this candidate — Finance
  // uploads it fresh via /api/upload?candidate_id=this-candidate right
  // before calling this, but the id itself is client-supplied, so it's
  // not trusted without checking.
  const invoiceDocument = await prisma.document.findUnique({ where: { id: parsed.data.invoice_document_id } });
  if (!invoiceDocument || invoiceDocument.candidate_id !== candidate.id) {
    return NextResponse.json({ error: "Invoice file not found for this candidate." }, { status: 404 });
  }

  const candidateName = candidate.user?.full_name ?? candidate.full_name ?? "the candidate";

  let recipientEmail: string | null;
  // The letter greeting ("Dear ...") — the partner's own company name for
  // a partner recipient (confirmed wording), not the individual contact's
  // name.
  let recipientName: string;
  if (parsed.data.recipient === "partner") {
    if (!candidate.partner) {
      return NextResponse.json({ error: "This candidate has no associated partner to invoice." }, { status: 422 });
    }
    recipientEmail = candidate.partner.contact_email;
    recipientName = candidate.partner.name;
  } else {
    recipientEmail = candidate.user?.email ?? candidate.email;
    recipientName = candidateName;
  }
  if (!recipientEmail) {
    return NextResponse.json({ error: "No email on file for the selected recipient." }, { status: 422 });
  }

  const programmeTitle = caseRecord.application.job?.title ?? "";
  const sectorName = caseRecord.application.job?.category ?? null;

  let fileContent: Awaited<ReturnType<typeof getStorageContent>>;
  try {
    fileContent = await getStorageContent(invoiceDocument.storage_path);
    // Never email a file that fails the malware scan.
    await assertDocumentReadable(invoiceDocument.storage_path, fileContent.buffer, user!.userId);
  } catch (err) {
    if (err instanceof DocumentBlockedError) {
      return NextResponse.json({ error: { code: "invoice_blocked", message: err.message } }, { status: 422 });
    }
    log.error("api.failed_to_read_invoice_file_for_case", { message: `Failed to read invoice file for case ${id}.`, err });
    return NextResponse.json({ error: { code: "invoice_file_missing", message: "Could not read the uploaded invoice file." } }, { status: 502 });
  }

  // Awaited, not fire-and-forget — on serverless (Vercel) the function
  // instance can freeze right after the response is sent, silently
  // killing an un-awaited async send before it completes. Sent before the
  // DB write so a failed send never leaves a phantom "invoiced" payment
  // record behind with no invoice actually delivered.
  try {
    await sendCasePaymentInvoiceEmail(
      recipientEmail,
      recipientName,
      candidateName,
      candidate.passport_number,
      programmeTitle,
      sectorName,
      {
        buffer: fileContent.buffer,
        filename: `${MILESTONE_DESCRIPTIONS[parsed.data.type].replace(/\s+/g, "_")}_Invoice.${fileContent.extension}`,
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

  const payment = await auditedPrisma(user!.userId).casePayment.create({
    data: {
      case_id: id,
      type: parsed.data.type,
      amount: parsed.data.amount,
      currency: "GBP",
      receipt_reference: parsed.data.invoice_reference,
      receipt_document_id: parsed.data.invoice_document_id,
      recorded_by: user!.userId,
      status: "pending",
      sent_to_email: recipientEmail,
    },
  });

  return NextResponse.json({ data: payment }, { status: 201 });
}
