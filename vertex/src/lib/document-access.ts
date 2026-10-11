import { prisma } from "@/lib/prisma";
import { auditedPrisma, auditSecurityEvent } from "@/lib/audit";
import { scanBuffer, scannerConfigured } from "@/lib/malware-scan";
import { onScannerUnavailable } from "@/lib/security-monitor";

export class DocumentBlockedError extends Error {
  constructor() {
    super("This document is blocked: it failed a malware scan.");
  }
}

/**
 * Called whenever a stored document's bytes are about to leave the server
 * (download links, email attachments). Uploads are scanned before storage;
 * this catches the ones accepted while the scanner was unreachable
 * (owner's fail-open policy): they're scanned now, on first access.
 *
 * - infected: always refused
 * - clean: served
 * - unscanned: scanned now; marked clean and served, or marked infected,
 *   audited and refused; if the scanner is still unreachable, served and
 *   left unscanned (fail-open, consistent with upload)
 */
export async function assertDocumentReadable(storagePath: string, bytes: Uint8Array, actorId: string | null): Promise<void> {
  const document = await prisma.document.findFirst({
    where: { storage_path: storagePath },
    select: { id: true, scan_status: true, candidate_id: true },
  });
  if (!document) return; // not a candidate document (nothing to track)
  if (document.scan_status === "infected") throw new DocumentBlockedError();
  if (document.scan_status === "clean") return;

  const scan = await scanBuffer(bytes);
  if (scan.status === "unavailable") {
    if (scannerConfigured()) onScannerUnavailable(scan.reason);
    return;
  }

  const db = auditedPrisma(actorId);
  if (scan.status === "clean") {
    await db.document.update({ where: { id: document.id }, data: { scan_status: "clean", scanned_at: new Date() } });
    return;
  }
  await db.document.update({ where: { id: document.id }, data: { scan_status: "infected", scanned_at: new Date() } });
  await auditSecurityEvent(actorId, "Document", document.id, "malware_blocked_download", { signature: scan.signature });
  throw new DocumentBlockedError();
}
