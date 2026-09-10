import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auditedPrisma } from "@/lib/audit";
import { createContractSchema } from "@/lib/validations";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { canAccessCase } from "@/server/scope";
import { OPERATIONS_ROLES } from "@/lib/rbac";

// POST /api/cases/:id/contract — generate + issue a contract (SRS FR-4.3).
// Operations-owned (2026-07-31), Director/Admin retain override. The actual
// e-signature vendor (DocuSign/Dropbox Sign) is Phase 5's procurement item
// per the platform recommendation; this generates the contract document and
// moves it to "sent" so the candidate can sign it through the in-house
// signature capture at /contract/sign.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, OPERATIONS_ROLES);
  if (guardRes) return guardRes;

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const parsed = createContractSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten().fieldErrors }, { status: 422 });
  }

  const caseRecord = await prisma.case.findUnique({
    where: { id },
    include: { application: { include: { candidate: true } }, contract: true },
  });
  if (!caseRecord) return NextResponse.json({ error: "Case not found." }, { status: 404 });

  const allowed = await canAccessCase(user!, {
    user_id: caseRecord.application.candidate.user_id,
    recruiter_id: caseRecord.application.candidate.recruiter_id,
    country_id: caseRecord.application.candidate.country_id,
    partner_id: caseRecord.application.candidate.partner_id,
  });
  if (!allowed) return NextResponse.json({ error: "Forbidden." }, { status: 403 });

  if (caseRecord.contract) {
    return NextResponse.json({ error: "A contract already exists for this case." }, { status: 409 });
  }

  const contract = await auditedPrisma(user!.userId).contract.create({
    data: {
      case_id: id,
      content: parsed.data.content,
      status: "sent",
      created_by: user!.userId,
    },
  });

  return NextResponse.json({ data: contract }, { status: 201 });
}

// GET /api/cases/:id/contract
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getAuthUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const caseRecord = await prisma.case.findUnique({
    where: { id },
    include: { application: { include: { candidate: true } }, contract: true },
  });
  if (!caseRecord) return NextResponse.json({ error: "Case not found." }, { status: 404 });

  const allowed = await canAccessCase(user, {
    user_id: caseRecord.application.candidate.user_id,
    recruiter_id: caseRecord.application.candidate.recruiter_id,
    country_id: caseRecord.application.candidate.country_id,
    partner_id: caseRecord.application.candidate.partner_id,
  });
  if (!allowed) return NextResponse.json({ error: "Forbidden." }, { status: 403 });

  if (!caseRecord.contract) return NextResponse.json({ error: "No contract yet." }, { status: 404 });

  return NextResponse.json({ data: caseRecord.contract });
}
