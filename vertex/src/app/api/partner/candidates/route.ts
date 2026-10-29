import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { passOn, readJson } from "@/lib/pipeline";
import { getAuthUser, requireRole } from "@/lib/api-auth";
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
    where: { partner_id: partner.id },
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

// POST /api/partner/candidates — a partner submitting a candidate (SRS
// FR-5.1), or HR, operations or admin entering a partner's backlog for it
// (naming partner_id). Written by FastAPI since the pipeline switch (step
// 6.7; vertex_be/app/api/v1/partner_submissions.py): the checks, then the
// Candidate, Application and bridged submission in one transaction.
export async function POST(req: NextRequest) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, ["partner", "hr", "operations_team", "operations_director", "admin"]);
  if (guardRes) return guardRes;
  const read = await readJson(req);
  if (read.invalid) return read.invalid;
  return passOn("/api/v1/partner/candidates", { method: "POST", body: read.body });
}
