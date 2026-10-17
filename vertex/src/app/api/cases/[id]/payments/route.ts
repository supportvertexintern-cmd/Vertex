import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auditedPrisma } from "@/lib/audit";
import { recordCasePaymentSchema } from "@/lib/validations";
import { getAuthUser, requireRole, forbidden } from "@/lib/api-auth";
import { canAccessCase } from "@/server/scope";
import { FINANCE_ROLES } from "@/lib/rbac";

// Read-only visibility on the 3 payment milestones stays with every
// staff tier plus the sourcing partner — only recording one is
// Finance-exclusive (Director/Admin retain override, 2026-07-31).
const PAYMENT_READ_ROLES = ["regional_recruiter", "country_supervisor", "inhouse_supervisor", "director", "admin", "hr", "operations_team", "operations_director", "finance", "partner"] as const;

// POST /api/cases/:id/payments — record a milestone payment (SRS FR-4.5).
// This records that a payment was collected (with a receipt reference),
// gated by the admin-configured FeePolicy — it does not itself charge a
// card; that's the separate, already-built candidate application-fee flow.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, FINANCE_ROLES);
  if (guardRes) return guardRes;

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const parsed = recordCasePaymentSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten().fieldErrors }, { status: 422 });
  }

  const caseRecord = await prisma.case.findUnique({
    where: { id },
    include: { application: { include: { candidate: true } } },
  });
  if (!caseRecord) return NextResponse.json({ error: "Case not found." }, { status: 404 });

  const allowed = await canAccessCase(user!, {
    user_id: caseRecord.application.candidate.user_id,
    recruiter_id: caseRecord.application.candidate.recruiter_id,
    country_id: caseRecord.application.candidate.country_id,
    partner_id: caseRecord.application.candidate.partner_id,
  });
  if (!allowed) return forbidden({ error: "Forbidden." });

  // The stage must actually belong to this case's own Job — client-
  // supplied id, not trusted without checking.
  const jobPaymentStage = caseRecord.application.job_id
    ? await prisma.jobPaymentStage.findUnique({ where: { id: parsed.data.job_payment_stage_id } })
    : null;
  if (!jobPaymentStage || jobPaymentStage.job_id !== caseRecord.application.job_id) {
    return NextResponse.json({ error: "Payment stage not found for this case's opportunity." }, { status: 404 });
  }

  const countryId = caseRecord.application.candidate.country_id;
  const [countryPolicy, globalPolicy] = await Promise.all([
    countryId ? prisma.feePolicy.findFirst({ where: { country_id: countryId } }) : Promise.resolve(null),
    prisma.feePolicy.findFirst({ where: { country_id: null } }),
  ]);
  const effectivePolicy = countryPolicy ?? globalPolicy;

  if (!effectivePolicy?.enabled) {
    return NextResponse.json({ error: "Milestone payments are not enabled for this destination. In-House must enable the fee policy first." }, { status: 403 });
  }

  const payment = await auditedPrisma(user!.userId).casePayment.create({
    data: {
      case_id: id,
      job_payment_stage_id: jobPaymentStage.id,
      amount: parsed.data.amount,
      currency: parsed.data.currency,
      receipt_reference: parsed.data.receipt_reference,
      receipt_document_id: parsed.data.receipt_document_id,
      recorded_by: user!.userId,
    },
  });

  return NextResponse.json({ data: payment }, { status: 201 });
}

// GET /api/cases/:id/payments
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, [...PAYMENT_READ_ROLES]);
  if (guardRes) return guardRes;

  const caseRecord = await prisma.case.findUnique({
    where: { id },
    include: { application: { include: { candidate: true } } },
  });
  if (!caseRecord) return NextResponse.json({ error: "Case not found." }, { status: 404 });

  const allowed = await canAccessCase(user!, {
    user_id: caseRecord.application.candidate.user_id,
    recruiter_id: caseRecord.application.candidate.recruiter_id,
    country_id: caseRecord.application.candidate.country_id,
    partner_id: caseRecord.application.candidate.partner_id,
  });
  if (!allowed) return forbidden({ error: "Forbidden." });

  const payments = await prisma.casePayment.findMany({ where: { case_id: id }, orderBy: { recorded_at: "desc" } });
  return NextResponse.json({ data: payments });
}
