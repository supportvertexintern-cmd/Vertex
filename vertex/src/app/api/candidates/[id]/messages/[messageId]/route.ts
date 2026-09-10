import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auditedPrisma } from "@/lib/audit";
import { getAuthUser, requireAuth } from "@/lib/api-auth";

// PATCH/DELETE /api/candidates/:id/messages/:messageId — a sender
// correcting or removing their own message after sending it (CRM
// Comments follow-up, 2026-08-12). Sender-only (not a moderation tool for
// other people's messages) — ownership of the message itself is the
// access check here, not the broader thread-access rules GET/POST use,
// since editing your own past message doesn't need re-deriving whether
// you could still reach the thread today.
async function loadOwnedMessage(candidateId: string, messageId: string, userId: string) {
  const message = await prisma.candidateMessage.findUnique({ where: { id: messageId } });
  if (!message || message.candidate_id !== candidateId) return null;
  if (message.sender_id !== userId) return "forbidden" as const;
  return message;
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string; messageId: string }> }) {
  const user = await getAuthUser(req);
  const guardRes = requireAuth(user);
  if (guardRes) return guardRes;

  const { id, messageId } = await params;
  const existing = await loadOwnedMessage(id, messageId, user!.userId);
  if (existing === null) return NextResponse.json({ error: { code: "not_found", message: "Message not found." } }, { status: 404 });
  if (existing === "forbidden") return NextResponse.json({ error: { code: "forbidden", message: "You can only edit your own messages." } }, { status: 403 });

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

  const updated = await auditedPrisma(user!.userId).candidateMessage.update({
    where: { id: messageId },
    data: { body: text.trim() },
    select: { id: true, body: true, created_at: true, updated_at: true, sender_id: true, sender: { select: { full_name: true, role: true } } },
  });

  return NextResponse.json({ data: updated });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string; messageId: string }> }) {
  const user = await getAuthUser(req);
  const guardRes = requireAuth(user);
  if (guardRes) return guardRes;

  const { id, messageId } = await params;
  const existing = await loadOwnedMessage(id, messageId, user!.userId);
  if (existing === null) return NextResponse.json({ error: { code: "not_found", message: "Message not found." } }, { status: 404 });
  if (existing === "forbidden") return NextResponse.json({ error: { code: "forbidden", message: "You can only delete your own messages." } }, { status: 403 });

  await auditedPrisma(user!.userId).candidateMessage.delete({ where: { id: messageId } });

  return NextResponse.json({ data: { id: messageId } });
}
