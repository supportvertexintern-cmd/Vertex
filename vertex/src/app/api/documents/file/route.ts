import { NextRequest, NextResponse } from "next/server";
import { resolveDocumentContent, DocumentNotFoundError } from "@/lib/upload";

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
  try {
    ({ buffer, extension } = await resolveDocumentContent(token));
  } catch (err) {
    if (err instanceof DocumentNotFoundError) {
      return NextResponse.json({ error: "Document not found." }, { status: 404 });
    }
    return NextResponse.json({ error: "Invalid or expired document link." }, { status: 401 });
  }

  const contentType = CONTENT_TYPES[extension] || "application/octet-stream";

  return new NextResponse(Uint8Array.from(buffer), {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": "inline",
      "Cache-Control": "private, no-store",
    },
  });
}
