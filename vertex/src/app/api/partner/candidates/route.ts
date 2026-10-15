import { NextRequest, NextResponse, after } from "next/server";
import { prisma } from "@/lib/prisma";
import { auditedPrisma } from "@/lib/audit";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { submitPartnerCandidateSchema } from "@/lib/validations";
import { finalizeSubmission } from "@/server/services/partnerCandidateSubmission";

import { log } from "@/lib/log";
// GET /api/partner/candidates — a partner sees only its own submissions
// (SRS FR-5.1). Scoped by Partner.user_id, not a role-wide query — a
// partner has no visibility into any other agency's candidates.
export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, ["partner"]);
  if (guardRes) return guardRes;

  const partner = await prisma.partner.findUnique({ where: { user_id: user!.userId } });
  if (!partner) return NextResponse.json({ error: { code: "not_found", message: "Partner record not found." } }, { status: 404 });

  const candidates = await prisma.partnerCandidate.findMany({
    where: { partner_id: partner.id, status: { not: "draft" } },
    include: {
      job: { select: { title: true, country: true, city: true } },
    },
    orderBy: { submitted_at: "desc" },
  });

  // "Needs attention" signals (2026-07-31) — a document HR rejected (the
  // candidate stays exactly where it was; only the document itself needs
  // a new version), or the last message on the thread came from HR/
  // Operations rather than the partner, meaning the ball is in the
  // partner's court. Mirrors the same signals built for HR's own
  // dashboard, from the partner's side of the same data.
  const withSignals = await Promise.all(
    candidates.map(async (c: (typeof candidates)[number]) => {
      if (!c.bridged_candidate_id) {
        return { ...c, has_rejected_document: false, awaiting_partner_reply: false };
      }
      const candidateId = c.bridged_candidate_id;
      const [rejectedCount, lastMessage] = await Promise.all([
        prisma.document.count({ where: { candidate_id: candidateId, verification_status: "rejected" } }),
        prisma.candidateMessage.findFirst({
          where: { candidate_id: candidateId },
          orderBy: { created_at: "desc" },
          select: { sender: { select: { role: true } } },
        }),
      ]);
      return {
        ...c,
        has_rejected_document: rejectedCount > 0,
        awaiting_partner_reply: !!lastMessage && lastMessage.sender.role !== "partner",
      };
    })
  );

  const summary = {
    needs_attention_count: withSignals.filter((c) => c.has_rejected_document || c.awaiting_partner_reply).length,
  };

  return NextResponse.json({ data: withSignals, summary });
}

// POST /api/partner/candidates — the partner's own candidate-submission
// form (Agency Application Form Sections 2-6). Materializes a real
// Candidate + Application immediately (2026-07-27) — a partner has already
// screened/verified this candidate themselves, so it skips Vertex's
// internal recruiter/screening/verification funnel entirely and goes
// straight to an operations review that opens the Case (see
// PATCH /api/partner-candidates/:id/create-case). No User/login is ever
// created here — "candidates submitted by partners will not get their own
// accounts" is a confirmed, deliberate decision, not a gap to fill in
// later. Best-effort notifies staff by email; returns candidateId so the
// form can immediately follow up with real per-file document uploads
// (POST /api/upload?candidate_id=) against it.
export async function POST(req: NextRequest) {
  const user = await getAuthUser(req);
  // hr/operations_team/operations_director/admin (CRM Comments item 10,
  // 2026-08-10) — staff entering a partner's already-vetted, pre-CRM
  // candidates on their behalf (e.g. SANISA Travel and Recruitment's
  // paper-form backlog), since the scanned documents aren't clear enough
  // for the partner to self-serve. A staff caller must supply partner_id
  // explicitly; a partner's own submission still always derives its
  // Partner.id from the login, never from the request body.
  const guardRes = requireRole(user, ["partner", "hr", "operations_team", "operations_director", "admin"]);
  if (guardRes) return guardRes;

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

  const partner =
    user!.role === "partner"
      ? await prisma.partner.findUnique({ where: { user_id: user!.userId } })
      : parsed.data.partner_id
      ? await prisma.partner.findUnique({ where: { id: parsed.data.partner_id } })
      : null;
  if (!partner) {
    return NextResponse.json(
      {
        error: {
          code: "not_found",
          message: user!.role === "partner" ? "Partner record not found." : "partner_id is required and must reference a real partner.",
        },
      },
      { status: user!.role === "partner" ? 404 : 422 }
    );
  }

  const db = auditedPrisma(user!.userId);
  const result = await finalizeSubmission({ db, partner, data: parsed.data, submittedBy: user!.userId });
  if (!result.ok) {
    return NextResponse.json({ error: { code: result.code, message: result.message } }, { status: result.status });
  }
  const { candidate, application, partnerCandidate } = result;

  // Deferred via after() (2026-08-06) — Candidate/Application/
  // PartnerCandidate are already committed above, so a slow/failed staff
  // notification shouldn't hold up the partner's own response. See
  // screening.ts's screenAndInvite for why after(), not a bare un-awaited
  // promise.
  after(async () => {
    try {
      const { sendPartnerCandidateSubmittedEmail } = await import("@/lib/email");
      await sendPartnerCandidateSubmittedEmail(partner.name, partnerCandidate.full_name ?? "the candidate");
    } catch (err) {
      log.error("api.failed_to_send_partner_candidate_submission_notification", { err });
    }
  });

  return NextResponse.json(
    { data: { ...partnerCandidate, candidateId: candidate.id, applicationId: application.id } },
    { status: 201 }
  );
}
