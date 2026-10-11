import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auditedPrisma } from "@/lib/audit";
import { getAuthUser, requireAuth, forbidden } from "@/lib/api-auth";
import { canAccessCandidate } from "@/server/scope";
import { verifyDocumentSchema } from "@/lib/validations";
import type { Role } from "@prisma/client";

// Verification is a check performed on a candidate's documents —
// country_supervisor/inhouse_supervisor for the internal recruiter
// pipeline (the sourcing recruiter themselves is deliberately excluded to
// avoid self-verification), and hr for a partner-sourced submission
// (2026-07-31) — a rejection here is document-level only and never
// touches PartnerCandidate.status, so the submission stays exactly where
// it was (submitted/under_review) while the partner replaces the file.
const VERIFIER_ROLES: Role[] = ["country_supervisor", "inhouse_supervisor", "director", "admin", "hr"];

// PATCH /api/documents/:id/verify — SRS FR-2.7 verification workflow
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  const authError = requireAuth(user);
  if (authError) return authError;

  if (!VERIFIER_ROLES.includes(user!.role)) {
    return forbidden({ error: { code: "forbidden", message: "Not authorized to verify documents." } });
  }

  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: { code: "invalid_json", message: "Invalid JSON" } }, { status: 400 });
  }

  const parsed = verifyDocumentSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "validation_error", message: "Validation failed", details: parsed.error.flatten().fieldErrors } },
      { status: 422 }
    );
  }

  const document = await prisma.document.findUnique({
    where: { id },
    include: { candidate: { select: { user_id: true, recruiter_id: true, country_id: true } } },
  });
  if (!document) {
    return NextResponse.json({ error: { code: "not_found", message: "Document not found." } }, { status: 404 });
  }

  const allowed = await canAccessCandidate(user!, document.candidate);
  if (!allowed) {
    return forbidden({ error: { code: "forbidden", message: "Forbidden." } });
  }

  const updated = await auditedPrisma(user!.userId).document.update({
    where: { id },
    data: {
      verification_status: parsed.data.verification_status,
      verified_by: user!.userId,
      verified_at: new Date(),
    },
  });

  return NextResponse.json({ data: updated });
}
