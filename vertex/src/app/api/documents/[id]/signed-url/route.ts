import { NextRequest, NextResponse } from "next/server";
import { getAuthUser, requireAuth } from "@/lib/api-auth";
import { callBackend, legacyErrorResponse } from "@/lib/backend";
import { seg } from "@/lib/pipeline";
import { getSignedDocumentUrl } from "@/lib/upload";

// GET /api/documents/:id/signed-url
// Issues a short-lived signed URL for one document, after checking the
// requester is allowed to see the candidate it belongs to (SRS FR-1.2, FR-1.6).
// FastAPI decides and records the issue since reads handover R5
// (vertex_be/app/api/v1/case_reads.py, document_link); the link is signed
// here, with the key only this app holds.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  const authError = requireAuth(user);
  if (authError) return authError;

  const { id } = await params;
  const result = await callBackend<{ storage_path: string }>(`/api/v1/documents/${seg(id)}/link`);
  if (!result.ok) return legacyErrorResponse(result);
  return NextResponse.json({ url: await getSignedDocumentUrl(result.body.data.storage_path) });
}
