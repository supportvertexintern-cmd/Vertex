import { NextRequest, NextResponse, after } from "next/server";
import { prisma } from "@/lib/prisma";
import { auditedPrisma } from "@/lib/audit";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { submitPartnerCandidateSchema } from "@/lib/validations";
import { finalizeSubmission } from "@/server/services/partnerCandidateSubmission";
import { log } from "@/lib/log";

// POST /api/partner/candidates/:id/submit — finalize a draft into a real
// submission (2026-09-09). Full submitPartnerCandidateSchema validation —
// finishing a draft must clear exactly the same bar as submitting fresh,
// no exceptions — then the same finalizeSubmission() transaction
// POST /api/partner/candidates itself uses, upgrading the existing draft
// row in place (bridging it to a real Candidate/Application) rather than
// creating a second PartnerCandidate row.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, ["partner", "hr", "operations_team", "operations_director", "admin"]);
  if (guardRes) return guardRes;

  const { id } = await params;

  const partner =
    user!.role === "partner" ? await prisma.partner.findUnique({ where: { user_id: user!.userId } }) : null;

  const existing = await prisma.partnerCandidate.findUnique({ where: { id } });
  if (!existing || (user!.role === "partner" && existing.partner_id !== partner?.id)) {
    return NextResponse.json({ error: { code: "not_found", message: "Draft not found." } }, { status: 404 });
  }
  if (existing.status !== "draft") {
    return NextResponse.json({ error: { code: "invalid_state", message: "This submission has already been finalized." } }, { status: 409 });
  }

  const owningPartner = user!.role === "partner" ? partner! : await prisma.partner.findUnique({ where: { id: existing.partner_id } });
  if (!owningPartner) {
    return NextResponse.json({ error: { code: "not_found", message: "Partner record not found." } }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: { code: "invalid_json", message: "Invalid JSON" } }, { status: 400 });
  }

  const parsed = submitPartnerCandidateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "validation_error", message: "Validation failed", details: parsed.error.flatten().fieldErrors } },
      { status: 422 }
    );
  }

  const db = auditedPrisma(user!.userId);
  const result = await finalizeSubmission({ db, partner: owningPartner, data: parsed.data, existingPartnerCandidateId: id, submittedBy: user!.userId });
  if (!result.ok) {
    return NextResponse.json({ error: { code: result.code, message: result.message } }, { status: result.status });
  }
  const { candidate, application, partnerCandidate } = result;

  after(async () => {
    try {
      const { sendPartnerCandidateSubmittedEmail } = await import("@/lib/email");
      await sendPartnerCandidateSubmittedEmail(owningPartner.name, partnerCandidate.full_name ?? "the candidate");
    } catch (err) {
      log.error("api.failed_to_send_partner_candidate_submission_notification", { err });
    }
  });

  return NextResponse.json({ data: { ...partnerCandidate, candidateId: candidate.id, applicationId: application.id } });
}
