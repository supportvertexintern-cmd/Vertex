import { describe, it, expect, afterEach, vi } from "vitest";
// Document links are signed tokens; give the tests their own throwaway key.
vi.hoisted(() => {
  process.env.JWT_SECRET ??= "test-only-signing-value-not-a-real-secret-upload";
});

import { randomUUID } from "node:crypto";
import { S3Client, DeleteObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedDocumentUrl, resolveDocumentContent, DocumentNotFoundError } from "./upload";
import { verifyDocumentToken, signDocumentToken } from "./jwt";

// Real integration tests against the configured object store (MinIO in CI
// and locally, the same S3 API as AWS S3 and R2), like scope.test.ts runs
// against a real database: mocking the S3 client would only test the mock.
const env = process.env;
const BUCKET = (env.S3_BUCKET || env.R2_BUCKET_NAME)!;
const r2 = new S3Client({
  region: env.S3_REGION || "us-east-1",
  endpoint: env.S3_ENDPOINT || env.R2_ENDPOINT || `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  forcePathStyle: Boolean(env.S3_ENDPOINT || env.R2_ENDPOINT),
  credentials: {
    accessKeyId: (env.S3_ACCESS_KEY_ID || env.R2_ACCESS_KEY_ID)!,
    secretAccessKey: (env.S3_SECRET_ACCESS_KEY || env.R2_SECRET_ACCESS_KEY)!,
  },
});

const cleanupKeys: string[] = [];
afterEach(async () => {
  await Promise.all(
    cleanupKeys.splice(0).map((key) =>
      r2.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key })).catch(() => {})
    )
  );
});

// FastAPI stores documents since the pipeline switch (step 6.7); this app
// reads them back. Each test puts its object straight into the bucket.
async function stored(type: string, content = "%PDF-1.4\ntest file bytes\n%%EOF"): Promise<string> {
  const storagePath = `${type}/${randomUUID()}.pdf`;
  await r2.send(new PutObjectCommand({ Bucket: BUCKET, Key: storagePath, Body: content, ContentType: "application/pdf" }));
  cleanupKeys.push(storagePath);
  return storagePath;
}

describe("getSignedDocumentUrl / resolveDocumentContent", () => {
  it("round-trips a signed URL back to the correct file content", async () => {
    const storagePath = await stored("passport");
    const url = await getSignedDocumentUrl(storagePath, 60);
    const token = new URL(url, "http://localhost").searchParams.get("token")!;

    const { buffer, extension } = await resolveDocumentContent(token);
    expect(buffer.toString("utf-8")).toBe("%PDF-1.4\ntest file bytes\n%%EOF");
    expect(extension).toBe("pdf");
  });

  it("rejects an expired token", async () => {
    const storagePath = await stored("cv");
    const expiredToken = signDocumentToken({ storagePath }, -1);
    await expect(resolveDocumentContent(expiredToken)).rejects.toThrow();
    // sanity: verifyDocumentToken itself is what throws for expiry
    expect(() => verifyDocumentToken(expiredToken)).toThrow();
  });

  it("throws DocumentNotFoundError when the object doesn't exist", async () => {
    const forgedToken = signDocumentToken({ storagePath: "cv/does-not-exist.pdf" }, 60);
    await expect(resolveDocumentContent(forgedToken)).rejects.toThrow(DocumentNotFoundError);
  });
});
