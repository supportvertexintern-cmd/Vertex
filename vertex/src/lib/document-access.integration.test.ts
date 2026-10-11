// Scan on access (Phase 9): documents accepted while the scanner was down
// are scanned the first time they're read. Needs the database, the object
// store and clamd (CLAMD_HOST).
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
vi.hoisted(() => {
  process.env.JWT_SECRET ??= "test-only-signing-value-not-a-real-secret-access";
});

import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { prisma } from "@/lib/prisma";
import { resolveStorageConfig, deleteUploadedFile } from "@/lib/upload";
import { assertDocumentReadable, DocumentBlockedError } from "@/lib/document-access";
import { EICAR } from "@/test-fixtures/eicar";

const tag = `scan-${Date.now()}`;
const PDF = Buffer.from("%PDF-1.4\nscan on access\n%%EOF");
let candidateId = "";
const keys: string[] = [];

async function storeUnscanned(bytes: Buffer) {
  const c = resolveStorageConfig();
  const client = new S3Client({ region: c.region, endpoint: c.endpoint, forcePathStyle: c.forcePathStyle, credentials: c });
  const key = `cv/${tag}-${keys.length}.pdf`;
  // Bypasses saveUploadedDocument on purpose: this is a file that got in
  // while the scanner was unreachable.
  await client.send(new PutObjectCommand({ Bucket: c.bucket, Key: key, Body: bytes }));
  keys.push(key);
  const doc = await prisma.document.create({ data: { candidate_id: candidateId, type: "cv", storage_path: key, scan_status: "unscanned" } });
  return { key, id: doc.id };
}

beforeAll(async () => {
  candidateId = (await prisma.candidate.create({ data: { full_name: `${tag} candidate` } })).id;
});

afterAll(async () => {
  await prisma.document.deleteMany({ where: { candidate_id: candidateId } });
  await prisma.candidate.deleteMany({ where: { id: candidateId } });
  await Promise.all(keys.map((k) => deleteUploadedFile(k).catch(() => {})));
});

describe.skipIf(!process.env.CLAMD_HOST)("assertDocumentReadable", () => {
  it("scans an unscanned clean file on first access and marks it clean", async () => {
    const { key, id } = await storeUnscanned(PDF);
    await expect(assertDocumentReadable(key, PDF, null)).resolves.toBeUndefined();
    expect(await prisma.document.findUniqueOrThrow({ where: { id } })).toMatchObject({ scan_status: "clean" });
  });

  it("blocks an unscanned infected file, marks it infected and audits it", async () => {
    const { key, id } = await storeUnscanned(EICAR);
    await expect(assertDocumentReadable(key, EICAR, null)).rejects.toBeInstanceOf(DocumentBlockedError);
    expect(await prisma.document.findUniqueOrThrow({ where: { id } })).toMatchObject({ scan_status: "infected" });
    const audit = await prisma.auditLog.findFirst({ where: { entity_id: id, action: "malware_blocked_download" } });
    expect(audit?.after).toMatchObject({ signature: "Eicar-Test-Signature" });
    // Once infected, always refused, without rescanning.
    await expect(assertDocumentReadable(key, PDF, null)).rejects.toBeInstanceOf(DocumentBlockedError);
  });

  it("serves an unscanned file when the scanner is down, and leaves it unscanned", async () => {
    const { key, id } = await storeUnscanned(PDF);
    const before = { host: process.env.CLAMD_HOST, port: process.env.CLAMD_PORT };
    process.env.CLAMD_HOST = "127.0.0.1";
    process.env.CLAMD_PORT = "1";
    try {
      await expect(assertDocumentReadable(key, PDF, null)).resolves.toBeUndefined();
    } finally {
      process.env.CLAMD_HOST = before.host;
      process.env.CLAMD_PORT = before.port;
    }
    expect(await prisma.document.findUniqueOrThrow({ where: { id } })).toMatchObject({ scan_status: "unscanned" });
  });
});
