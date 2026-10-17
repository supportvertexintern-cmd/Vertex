import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser, requireAuth, forbidden } from "@/lib/api-auth";
import { canAccessDocument } from "@/server/scope";
import { getSignedDocumentUrl } from "@/lib/upload";
import { recordSecurityEvent } from "@/lib/audit";

// GET /api/documents/:id/signed-url
// Issues a short-lived signed URL for one document, after checking the
// requester is allowed to see the candidate it belongs to (SRS FR-1.2, FR-1.6).
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  const authError = requireAuth(user);
  if (authError) return authError;

  const { id } = await params;

  const document = await prisma.document.findUnique({
    where: { id },
    include: {
      candidate: {
        select: { user_id: true, recruiter_id: true, country_id: true, partner_id: true },
      },
    },
  });

  if (!document) {
    return NextResponse.json({ error: "Document not found." }, { status: 404 });
  }

  const allowed = await canAccessDocument(user!, document);
  if (!allowed) {
    return forbidden({ error: "Forbidden." });
  }

  const url = await getSignedDocumentUrl(document.storage_path);
  await recordSecurityEvent("document_link_issued", {
    actorId: user!.userId,
    entityType: "Document",
    entityId: document.id,
    detail: { type: document.type, candidate_id: document.candidate_id },
  });
  return NextResponse.json({ url });
}
