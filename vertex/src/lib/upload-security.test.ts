// Phase 9: uploads can't lie about their type, pick their own name or
// escape their storage folder. Runs against the configured object store
// (MinIO locally and in CI), like upload.test.ts.
import { describe, it, expect, afterAll, vi } from "vitest";
// Document links are signed tokens; give the tests their own throwaway key.
vi.hoisted(() => {
  process.env.JWT_SECRET ??= "test-only-signing-value-not-a-real-secret-upload";
});

import { saveUploadedFile, deleteUploadedFile, detectFileType, resolveDocumentContent, getSignedDocumentUrl } from "./upload";

const PDF = "%PDF-1.4\nsecurity probe\n%%EOF";
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const saved: string[] = [];

const file = (body: BlobPart, name: string, type: string) => new File([body], name, { type });
async function save(f: File, type = "cv") {
  const key = await saveUploadedFile(f, type);
  saved.push(key);
  return key;
}

afterAll(async () => {
  await Promise.all(saved.map((k) => deleteUploadedFile(k).catch(() => {})));
});

describe("detectFileType (content, not claims)", () => {
  it("recognises PDF, PNG and JPEG by their magic bytes", () => {
    expect(detectFileType(new TextEncoder().encode(PDF))?.ext).toBe("pdf");
    expect(detectFileType(PNG)?.ext).toBe("png");
    expect(detectFileType(JPEG)?.ext).toBe("jpg");
  });

  it("recognises nothing else", () => {
    expect(detectFileType(new TextEncoder().encode("<html><script>alert(1)</script>"))).toBeNull();
    expect(detectFileType(new Uint8Array([0x4d, 0x5a, 0x90, 0x00]))).toBeNull(); // Windows executable
    expect(detectFileType(new Uint8Array([]))).toBeNull();
  });
});

describe("saveUploadedFile", () => {
  it("rejects HTML that claims to be a PDF (spoofed content type)", async () => {
    await expect(save(file("<html><script>alert(1)</script></html>", "cv.pdf", "application/pdf"))).rejects.toThrow(/does not match/);
  });

  it("rejects a PDF that claims to be a PNG", async () => {
    await expect(save(file(PDF, "photo.png", "image/png"))).rejects.toThrow(/does not match/);
  });

  it("ignores the user's extension: a real PDF named .html is stored as .pdf", async () => {
    const key = await save(file(PDF, "evil.html", "application/pdf"));
    expect(key).toMatch(/^cv\/[0-9a-f-]{36}\.pdf$/);
  });

  it("ignores path tricks in the filename", async () => {
    const key = await save(file(PDF, "../../../etc/passwd.pdf", "application/pdf"));
    expect(key).toMatch(/^cv\/[0-9a-f-]{36}\.pdf$/);
    expect(key).not.toContain("..");
  });

  it("refuses a document type that would shape the storage path", async () => {
    for (const type of ["../cv", "cv/../../x", "CV", "a b", ""]) {
      await expect(saveUploadedFile(file(PDF, "x.pdf", "application/pdf"), type)).rejects.toThrow(/Invalid document type/);
    }
  });

  it("rejects an oversized file", async () => {
    const big = new Uint8Array(6 * 1024 * 1024);
    big.set(new TextEncoder().encode("%PDF-1.4\n"));
    await expect(save(file(big, "big.pdf", "application/pdf"))).rejects.toThrow(/too large/);
  });

  it("accepts PNG and JPEG with the extension of their real type", async () => {
    expect(await save(file(PNG, "p.png", "image/png"), "passport_photo")).toMatch(/^passport_photo\/[0-9a-f-]{36}\.png$/);
    expect(await save(file(JPEG, "p.jpeg", "image/jpg"), "passport_photo")).toMatch(/\.jpg$/);
  });

  it("stores the exact bytes and serves them back only through a signed link", async () => {
    const key = await save(file(PDF, "cv.pdf", "application/pdf"));
    const url = await getSignedDocumentUrl(key, 60);
    const token = new URL(url, "http://localhost").searchParams.get("token")!;
    const { buffer, extension } = await resolveDocumentContent(token);
    expect(buffer.toString()).toBe(PDF);
    expect(extension).toBe("pdf");
  });
});
