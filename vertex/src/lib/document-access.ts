import { prisma } from "@/lib/prisma";
import { callBackend } from "@/lib/backend";
import { log } from "@/lib/log";
import { onMalwareFound } from "@/lib/security-monitor";

export class DocumentBlockedError extends Error {
  constructor() {
    super("This document is blocked: it failed a malware scan.");
  }
}

/**
 * Called whenever a stored document's bytes are about to leave the server
 * (download links, email attachments). Uploads are scanned before storage;
 * this catches the ones accepted while the scanner was unreachable (the
 * owner's fail-open policy): FastAPI scans them now, on first access, and
 * records the result (vertex_be/app/api/v1/documents.py, readable; the
 * Document row is FastAPI's since the pipeline switch, step 6.7).
 *
 * - infected: always refused
 * - clean, or not a candidate document: served
 * - unscanned and the scanner still unreachable: served (fail-open)
 *
 * If FastAPI itself can't be reached, the row decides: a file already
 * known to be infected is refused, anything else is served as unscanned.
 */
export async function assertDocumentReadable(storagePath: string, forUser = false): Promise<void> {
  // forUser: a signed-in staff member's request (the audit trail names
  // them); a download link's holder has no session, so it's this app's.
  const result = await callBackend("/api/v1/documents/readable", {
    method: "POST",
    body: { storage_path: storagePath },
    asUser: forUser,
  });
  if (result.ok) return;
  if (result.error.code === "document_blocked") {
    // FastAPI recorded it; the alert is this app's, once, when it's found.
    const found = result.error.details as { document_id?: string; newly_found?: boolean; signature?: string } | undefined;
    if (found?.newly_found) onMalwareFound("malware_blocked_download", found.document_id ?? storagePath, null, found.signature);
    throw new DocumentBlockedError();
  }

  log.warn("document.readable_check_failed", { status: result.status, code: result.error.code });
  const document = await prisma.document.findFirst({ where: { storage_path: storagePath }, select: { scan_status: true } });
  if (document?.scan_status === "infected") throw new DocumentBlockedError();
}
