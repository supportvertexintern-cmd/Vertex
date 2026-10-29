import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { passOn, readJson, seg } from "@/lib/pipeline";
import { getAuthUser, requireRole, forbidden } from "@/lib/api-auth";
import { canAccessCase } from "@/server/scope";
import { OPERATIONS_ROLES } from "@/lib/rbac";


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
  if (!allowed) return forbidden({ error: "Forbidden." });

  if (!caseRecord.contract) return NextResponse.json({ error: "No contract yet." }, { status: 404 });

  return NextResponse.json({ data: caseRecord.contract });
}

// POST /api/cases/:id/contract — Operations issue the contract (SRS FR-4.3),
// sent for the candidate to sign. Written by FastAPI since the pipeline
// switch (step 6.7; vertex_be/app/api/v1/cases.py, issue_contract).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, OPERATIONS_ROLES);
  if (guardRes) return guardRes;
  const read = await readJson(req, true);
  if (read.invalid) return read.invalid;
  return passOn(`/api/v1/cases/${seg(id)}/contract`, { method: "POST", body: read.body }, { legacyErrors: true });
}
