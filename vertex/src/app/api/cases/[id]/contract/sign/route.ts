import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auditedPrisma } from "@/lib/audit";
import { signContractSchema } from "@/lib/validations";
import { getAuthUser, requireRole } from "@/lib/api-auth";

// POST /api/cases/:id/contract/sign — candidate signs their own contract
// (SRS FR-4.3). This is a real, legally-recognized "simple electronic
// signature" (typed full legal name + authenticated session + timestamp +
// IP), not a placeholder — deliberate groundwork ahead of Phase 5's
// e-signature vendor integration. Only the candidate the contract belongs
// to can sign it; staff cannot sign on a candidate's behalf, which would
// defeat the point of an attestation.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, ["candidate"]);
  if (guardRes) return guardRes;

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const parsed = signContractSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten().fieldErrors }, { status: 422 });
  }

  const caseRecord = await prisma.case.findUnique({
    where: { id },
    include: { application: { include: { candidate: true } }, contract: true },
  });
  if (!caseRecord) return NextResponse.json({ error: "Case not found." }, { status: 404 });

  if (caseRecord.application.candidate.user_id !== user!.userId) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  if (!caseRecord.contract) return NextResponse.json({ error: "No contract to sign yet." }, { status: 404 });
  if (caseRecord.contract.status === "signed") {
    return NextResponse.json({ error: "Contract already signed." }, { status: 409 });
  }

  const ip = req.headers.get("x-forwarded-for") ?? "unknown";

  const contract = await auditedPrisma(user!.userId).contract.update({
    where: { case_id: id },
    data: {
      status: "signed",
      signed_by_name: parsed.data.signed_by_name,
      signed_at: new Date(),
      signed_ip: ip,
    },
  });

  return NextResponse.json({ data: contract });
}
