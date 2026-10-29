import { NextRequest, NextResponse } from "next/server";
import { resolveDocumentContent, DocumentNotFoundError } from "@/lib/upload";
import { assertDocumentReadable, DocumentBlockedError } from "@/lib/document-access";
import { recordSecurityEvent } from "@/lib/audit";

const CONTENT_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
};

// GET /api/documents/file?token=<signed-document-token>
// The token is short-lived and single-purpose (SRS FR-1.6) — no session/auth
// cookie is required here because possession of a valid, unexpired token is
// itself the access grant, issued by /api/documents/[id]/signed-url after an
// RBAC check. Same proxy regardless of whether the bytes actually live on
// local disk or Vercel Blob — resolveDocumentContent hides that.
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  if (!token) {
    return NextResponse.json({ error: "Missing token." }, { status: 400 });
  }

  let buffer: Buffer;
  let extension: string;
  let storagePathForAudit = "";
  try {
    let storagePath: string;
    ({ buffer, extension, storagePath } = await resolveDocumentContent(token));
    storagePathForAudit = storagePath;
    // The link holder has no session; the token is the grant.
    await assertDocumentReadable(storagePath);
  } catch (err) {
    if (err instanceof DocumentBlockedError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    if (err instanceof DocumentNotFoundError) {
      return NextResponse.json({ error: "Document not found." }, { status: 404 });
    }
    await recordSecurityEvent("document_link_rejected", { actorId: null, entityType: "Document", entityId: "invalid_link", detail: {} });
    return NextResponse.json({ error: "Invalid or expired document link." }, { status: 401 });
  }
  // The link holder is anonymous; the issuing user is on the matching
  // document_link_issued row.
  await recordSecurityEvent("document_downloaded", { actorId: null, entityType: "DocumentFile", entityId: storagePathForAudit, detail: { bytes: buffer.length } });

  const contentType = CONTENT_TYPES[extension] || "application/octet-stream";

  return new NextResponse(Uint8Array.from(buffer), {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": "inline",
      "Cache-Control": "private, no-store",
    },
  });
}
