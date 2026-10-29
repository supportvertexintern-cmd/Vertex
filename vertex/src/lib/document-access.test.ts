import { beforeEach, describe, expect, it, vi } from "vitest";

// assertDocumentReadable (lib/document-access.ts): FastAPI scans and records
// (vertex_be/tests/test_documents.py); this checks what the website does
// with its answers, and that it fails safe when FastAPI can't be reached.

const callBackend = vi.fn();
vi.mock("@/lib/backend", () => ({ callBackend: (...args: unknown[]) => callBackend(...args) }));
const row = vi.hoisted(() => ({ scan_status: null as string | null }));
vi.mock("@/lib/prisma", () => ({
  prisma: { document: { findFirst: async () => (row.scan_status ? { scan_status: row.scan_status } : null) } },
}));
const malware = vi.hoisted(() => vi.fn());
vi.mock("@/lib/security-monitor", () => ({ onMalwareFound: malware }));

import { assertDocumentReadable, DocumentBlockedError } from "./document-access";

const blocked = (newlyFound: boolean) => ({
  ok: false,
  status: 403,
  error: { code: "document_blocked", message: "Blocked.", details: { document_id: "d1", newly_found: newlyFound, signature: "Eicar" } },
});

beforeEach(() => {
  callBackend.mockReset();
  malware.mockReset();
  row.scan_status = null;
});

describe("assertDocumentReadable", () => {
  it("serves what FastAPI clears, as this app or for the user", async () => {
    callBackend.mockResolvedValue({ ok: true, status: 200, body: { data: { scan_status: "clean" } } });
    await expect(assertDocumentReadable("passport/a.pdf")).resolves.toBeUndefined();
    await assertDocumentReadable("passport/a.pdf", true);
    expect(callBackend.mock.calls.map((c) => c[1].asUser)).toEqual([false, true]);
    expect(callBackend.mock.calls[0]).toEqual(["/api/v1/documents/readable", { method: "POST", body: { storage_path: "passport/a.pdf" }, asUser: false }]);
  });

  it("refuses an infected file, alerting only when it was just found", async () => {
    callBackend.mockResolvedValueOnce(blocked(true)).mockResolvedValueOnce(blocked(false));
    await expect(assertDocumentReadable("passport/a.pdf")).rejects.toBeInstanceOf(DocumentBlockedError);
    await expect(assertDocumentReadable("passport/a.pdf")).rejects.toBeInstanceOf(DocumentBlockedError);
    expect(malware.mock.calls).toEqual([["malware_blocked_download", "d1", null, "Eicar"]]);
  });

  it("without FastAPI, the row decides: infected is refused, anything else served", async () => {
    callBackend.mockResolvedValue({ ok: false, status: 503, error: { code: "backend_unavailable", message: "Unavailable." } });
    row.scan_status = "infected";
    await expect(assertDocumentReadable("passport/a.pdf")).rejects.toBeInstanceOf(DocumentBlockedError);
    row.scan_status = "unscanned";
    await expect(assertDocumentReadable("passport/a.pdf")).resolves.toBeUndefined();
    row.scan_status = null; // not a candidate document
    await expect(assertDocumentReadable("invoices/x.pdf")).resolves.toBeUndefined();
  });
});
