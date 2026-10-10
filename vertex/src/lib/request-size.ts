import { NextRequest, NextResponse } from "next/server";

// Authorization pipeline stage 1 (docs/security/authorization-pipeline.md):
// cap request bodies before any handler buffers them. Route handlers have
// no limit of their own, and req.json()/req.formData() read the whole body,
// including for anonymous callers. Node stops reading at the declared
// Content-Length, so checking the declaration is enough.
const MAX_JSON_BODY_BYTES = 1024 * 1024;
const UPLOAD_OVERHEAD_BYTES = 1024 * 1024; // multipart boundaries and fields

function maxBodyBytes(pathname: string): number {
  if (pathname === "/api/upload") {
    return (Number(process.env.MAX_FILE_SIZE_MB) || 5) * 1024 * 1024 + UPLOAD_OVERHEAD_BYTES;
  }
  return MAX_JSON_BODY_BYTES;
}

export function checkRequestSize(req: NextRequest): NextResponse | null {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return null;
  const declared = req.headers.get("content-length");
  if (declared === null) {
    return req.headers.get("transfer-encoding")
      ? NextResponse.json({ error: "Content-Length is required." }, { status: 411 })
      : null; // no body at all
  }
  const bytes = Number(declared);
  if (!Number.isFinite(bytes) || bytes < 0) {
    return NextResponse.json({ error: "Invalid Content-Length." }, { status: 400 });
  }
  if (bytes > maxBodyBytes(req.nextUrl.pathname)) {
    return NextResponse.json({ error: "Request body too large." }, { status: 413 });
  }
  return null;
}
