import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser, requireRole, forbidden } from "@/lib/api-auth";
import { canAccessCase } from "@/server/scope";
import { FINANCE_ROLES } from "@/lib/rbac";
import { passOn, readJson, seg } from "@/lib/pipeline";

// Read-only visibility on the 3 payment milestones stays with every
// staff tier plus the sourcing partner — only recording one is
// Finance-exclusive (Director/Admin retain override, 2026-07-31).
const PAYMENT_READ_ROLES = ["regional_recruiter", "country_supervisor", "inhouse_supervisor", "director", "admin", "hr", "operations_team", "operations_director", "finance", "partner"] as const;

// POST /api/cases/:id/payments — record a milestone payment (SRS FR-4.5):
// that a payment was collected, with a receipt reference or file, gated by
// the FeePolicy. Recorded by FastAPI since payments step 7.3
// (vertex_be/app/api/v1/case_payments.py, record_payment).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, FINANCE_ROLES);
  if (guardRes) return guardRes;
  const read = await readJson(req, true);
  if (read.invalid) return read.invalid;
  return passOn(`/api/v1/cases/${seg(id)}/payments`, { method: "POST", body: read.body }, { legacyErrors: true });
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
