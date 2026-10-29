import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { passOn, readJson, seg } from "@/lib/pipeline";
import { getAuthUser, requireAuth, forbidden } from "@/lib/api-auth";
// One continuous thread per candidate (2026-07-13, confirmed with the
// business) — not split per-Application or per-Case, so it carries
// through whether the candidate is still applying or already has a case
// open. Scoped to the candidate themself, their currently-assigned
// recruiter, admin, and — for a partner-sourced candidate (2026-07-31,
// per the Operational Workflow SOP) or a self-submitted one HR is
// reviewing (2026-07-31, HR-owned self-submission routing) — the sourcing
// partner and the HR/Operations/Director staff handling their
// submission/case, so partner/candidate and staff can go back and forth
// on documentation issues on the same thread. Not a general staff-visible
// channel like RecruiterNote.
async function resolveAccess(userId: string, role: string, candidateId: string) {
  const candidate = await prisma.candidate.findUnique({
    where: { id: candidateId },
    select: { user_id: true, recruiter_id: true, partner_id: true, source: true },
  });
  if (!candidate) return { allowed: false as const, candidate: null };

  let isPartnerOwner = false;
  if (role === "partner" && candidate.partner_id) {
    const partner = await prisma.partner.findUnique({ where: { user_id: userId }, select: { id: true } });
    isPartnerOwner = partner?.id === candidate.partner_id;
  }
  const isCaseStaff =
    ["hr", "operations_team", "operations_director", "director"].includes(role) &&
    (candidate.partner_id != null || candidate.source === "self_registered");

  const allowed =
    role === "admin" || candidate.user_id === userId || candidate.recruiter_id === userId || isPartnerOwner || isCaseStaff;
  return { allowed, candidate };
}

// GET /api/candidates/:id/messages
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  const guardRes = requireAuth(user);
  if (guardRes) return guardRes;

  const { id } = await params;
  const { allowed, candidate } = await resolveAccess(user!.userId, user!.role, id);
  if (!candidate) {
    return NextResponse.json({ error: { code: "not_found", message: "Candidate not found." } }, { status: 404 });
  }
  if (!allowed) {
    return forbidden({ error: { code: "forbidden", message: "Forbidden." } });
  }

  const messages = await prisma.candidateMessage.findMany({
    where: { candidate_id: id },
    select: { id: true, body: true, created_at: true, updated_at: true, sender_id: true, sender: { select: { full_name: true, role: true } } },
    orderBy: { created_at: "asc" },
  });

  return NextResponse.json({ data: messages });
}

// POST /api/candidates/:id/messages — written by FastAPI since the pipeline
// switch (step 6.7; vertex_be/app/api/v1/candidates.py, post_message),
// with the same thread access as GET. It tells whichever side didn't send
// the message; this app sends that email.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  const guardRes = requireAuth(user);
  if (guardRes) return guardRes;
  const { id } = await params;
  const read = await readJson(req);
  if (read.invalid) return read.invalid;
  return passOn(`/api/v1/candidates/${seg(id)}/messages`, { method: "POST", body: read.body });
}
