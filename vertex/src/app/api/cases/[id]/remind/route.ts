import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser, requireRole, forbidden } from "@/lib/api-auth";
import { canAccessCase } from "@/server/scope";
import { OPERATIONS_ROLES } from "@/lib/rbac";
import { sendCaseReminderSchema } from "@/lib/validations";
import { sendCaseReminderEmail } from "@/lib/email";

import { log } from "@/lib/log";
// POST /api/cases/:id/remind — Operations sends a manual reminder email
// for a delayed document or payment (2026-07-31, per the Operational
// Workflow SOP). Deliberately staff-triggered, not a background
// scheduler — matches every other deferred-automation decision already
// made in this codebase (report reminders, permit/visa deadline alerts).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, OPERATIONS_ROLES);
  if (guardRes) return guardRes;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = sendCaseReminderSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten().fieldErrors }, { status: 422 });
  }

  const caseRecord = await prisma.case.findUnique({
    where: { id },
    include: {
      application: {
        include: {
          job: true,
          candidate: {
            include: {
              user: { select: { email: true, full_name: true } },
              partner: { select: { contact_email: true, contact_name: true } },
            },
          },
        },
      },
    },
  });
  if (!caseRecord) return NextResponse.json({ error: "Case not found." }, { status: 404 });

  const candidate = caseRecord.application.candidate;
  const allowed = await canAccessCase(user!, {
    user_id: candidate.user_id,
    recruiter_id: candidate.recruiter_id,
    country_id: candidate.country_id,
    partner_id: candidate.partner_id,
  });
  if (!allowed) return forbidden({ error: "Forbidden." });

  let recipientEmail: string | null;
  let recipientName: string;
  if (parsed.data.recipient === "partner") {
    if (!candidate.partner) {
      return NextResponse.json({ error: "This candidate has no associated partner to remind." }, { status: 422 });
    }
    recipientEmail = candidate.partner.contact_email;
    recipientName = candidate.partner.contact_name;
  } else {
    recipientEmail = candidate.user?.email ?? candidate.email;
    recipientName = candidate.user?.full_name ?? candidate.full_name ?? "there";
  }
  if (!recipientEmail) {
    return NextResponse.json({ error: "No email on file for the selected recipient." }, { status: 422 });
  }

  const candidateName = candidate.user?.full_name ?? candidate.full_name ?? "the candidate";
  const programmeTitle = caseRecord.application.job?.title ?? "their programme";

  // Awaited, not fire-and-forget — on serverless (Vercel) the function
  // instance can freeze right after the response is sent, silently
  // killing an un-awaited async send before it completes.
  await sendCaseReminderEmail(recipientEmail, recipientName, candidateName, programmeTitle, parsed.data.channel, parsed.data.message).catch((err) => log.error("email.send_failed", { err }));

  const reminder = await prisma.caseReminder.create({
    data: {
      case_id: id,
      channel: parsed.data.channel,
      recipient: recipientEmail,
      message: parsed.data.message,
      sent_by: user!.userId,
    },
  });

  return NextResponse.json({ data: reminder }, { status: 201 });
}
