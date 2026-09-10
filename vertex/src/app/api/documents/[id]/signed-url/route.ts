import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser, requireAuth } from "@/lib/api-auth";
import { canAccessCandidate } from "@/server/scope";
import { getSignedDocumentUrl } from "@/lib/upload";

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

  const allowed = await canAccessCandidate(user!, document.candidate);
  if (!allowed) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const url = await getSignedDocumentUrl(document.storage_path);
  return NextResponse.json({ url });
}
