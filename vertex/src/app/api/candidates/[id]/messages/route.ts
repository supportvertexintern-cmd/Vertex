import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auditedPrisma } from "@/lib/audit";
import { getAuthUser, requireAuth } from "@/lib/api-auth";
import { sendCandidateMessageNotificationEmail } from "@/lib/email";

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
    return NextResponse.json({ error: { code: "forbidden", message: "Forbidden." } }, { status: 403 });
  }

  const messages = await prisma.candidateMessage.findMany({
    where: { candidate_id: id },
    select: { id: true, body: true, created_at: true, updated_at: true, sender_id: true, sender: { select: { full_name: true, role: true } } },
    orderBy: { created_at: "asc" },
  });

  return NextResponse.json({ data: messages });
}

// POST /api/candidates/:id/messages
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  const guardRes = requireAuth(user);
  if (guardRes) return guardRes;

  const { id } = await params;
  const { allowed, candidate } = await resolveAccess(user!.userId, user!.role, id);
  if (!candidate) {
    return NextResponse.json({ error: { code: "not_found", message: "Candidate not found." } }, { status: 404 });
  }
  if (!allowed) {
    return NextResponse.json({ error: { code: "forbidden", message: "Forbidden." } }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: { code: "invalid_json", message: "Invalid JSON" } }, { status: 400 });
  }

  const text = (body as { body?: unknown }).body;
  if (typeof text !== "string" || text.trim().length === 0) {
    return NextResponse.json({ error: { code: "validation_error", message: "Message body is required." } }, { status: 422 });
  }
  if (text.length > 4000) {
    return NextResponse.json({ error: { code: "validation_error", message: "Message is too long." } }, { status: 422 });
  }

  const message = await auditedPrisma(user!.userId).candidateMessage.create({
    data: { candidate_id: id, sender_id: user!.userId, body: text.trim() },
    select: { id: true, body: true, created_at: true, updated_at: true, sender_id: true, sender: { select: { full_name: true, role: true } } },
  });

  // A submission HR hasn't looked at yet flips to "under_review" the
  // moment HR says anything on the thread — a lightweight signal to the
  // partner that someone is now looking at it, without a separate manual
  // toggle (2026-07-31, per the Operational Workflow SOP).
  if (user!.role === "hr" && candidate.partner_id) {
    await prisma.partnerCandidate.updateMany({
      where: { bridged_candidate_id: id, status: "submitted" },
      data: { status: "under_review" },
    });
  }

  // Notify whichever side didn't send this. Non-blocking and best-effort,
  // same pattern as every other notification email in this app.
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const isFromCandidate = candidate.user_id === user!.userId;
  const isFromPartner = user!.role === "partner";
  const isFromCaseStaff = ["hr", "operations_team", "operations_director", "director"].includes(user!.role);

  let recipient: { email: string; full_name: string } | null = null;
  let viewUrl = `${appUrl}/dashboard`;

  if (isFromCandidate) {
    recipient = candidate.recruiter_id
      ? await prisma.user.findUnique({ where: { id: candidate.recruiter_id }, select: { email: true, full_name: true } })
      : null;
    viewUrl = `${appUrl}/recruiter/candidates/${id}`;
  } else if (isFromPartner && candidate.partner_id) {
    const origin = await prisma.partnerCandidate.findUnique({
      where: { bridged_candidate_id: id },
      select: { reviewed_by: true },
    });
    recipient = origin?.reviewed_by
      ? await prisma.user.findUnique({ where: { id: origin.reviewed_by }, select: { email: true, full_name: true } })
      : null;
    viewUrl = `${appUrl}/hr`;
  } else if (isFromCaseStaff && candidate.partner_id) {
    const partner = await prisma.partner.findUnique({ where: { id: candidate.partner_id }, select: { contact_email: true, contact_name: true } });
    recipient = partner ? { email: partner.contact_email, full_name: partner.contact_name } : null;
    viewUrl = `${appUrl}/partner`;
  } else if (candidate.user_id) {
    recipient = await prisma.user.findUnique({ where: { id: candidate.user_id }, select: { email: true, full_name: true } });
    viewUrl = `${appUrl}/dashboard`;
  }

  if (recipient) {
    // Awaited, not fire-and-forget — on a serverless platform (Vercel) the
    // function instance can freeze right after the response is sent,
    // silently killing an un-awaited async send before it actually
    // completes (invisible on a long-running local dev server, where the
    // process just keeps running regardless).
    await sendCandidateMessageNotificationEmail(recipient.email, recipient.full_name, viewUrl).catch(console.error);
  }

  return NextResponse.json({ data: message }, { status: 201 });
}
