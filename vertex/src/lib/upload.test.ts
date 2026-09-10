import { describe, it, expect, afterEach } from "vitest";
import { S3Client, DeleteObjectCommand } from "@aws-sdk/client-s3";
import {
  saveUploadedFile,
  getSignedDocumentUrl,
  resolveDocumentContent,
  deleteUploadedFile,
  DocumentNotFoundError,
} from "./upload";
import { verifyDocumentToken, signDocumentToken } from "./jwt";

// Real integration tests against the configured R2 test bucket (same
// pattern as scope.test.ts running against a real database) — storage is
// R2-only now, so mocking the S3 client would mostly just be re-testing
// the mock.
const r2 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});

const cleanupKeys: string[] = [];
afterEach(async () => {
  await Promise.all(
    cleanupKeys.splice(0).map((key) =>
      r2.send(new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET_NAME!, Key: key })).catch(() => {})
    )
  );
});

function makeFile(name: string, content = "test file bytes"): File {
  return new File([content], name, { type: "application/pdf" });
}

describe("saveUploadedFile / getSignedDocumentUrl / resolveDocumentContent", () => {
  it("saves a file to R2 and returns a storage key scoped by document type", async () => {
    const storagePath = await saveUploadedFile(makeFile("cv.pdf"), "cv");
    cleanupKeys.push(storagePath);
    expect(storagePath).toMatch(/^cv\/.+\.pdf$/);
  });

  it("rejects disallowed mime types", async () => {
    const badFile = new File(["x"], "malware.exe", { type: "application/x-msdownload" });
    await expect(saveUploadedFile(badFile, "cv")).rejects.toThrow(/Invalid file type/);
  });

  it("round-trips a signed URL back to the correct file content", async () => {
    const storagePath = await saveUploadedFile(makeFile("passport.pdf"), "passport");
    cleanupKeys.push(storagePath);
    const url = await getSignedDocumentUrl(storagePath, 60);
    const token = new URL(url, "http://localhost").searchParams.get("token")!;

    const { buffer, extension } = await resolveDocumentContent(token);
    expect(buffer.toString("utf-8")).toBe("test file bytes");
    expect(extension).toBe("pdf");
  });

  it("rejects an expired token", async () => {
    const storagePath = await saveUploadedFile(makeFile("cv.pdf"), "cv");
    cleanupKeys.push(storagePath);
    const expiredToken = signDocumentToken({ storagePath }, -1);
    await expect(resolveDocumentContent(expiredToken)).rejects.toThrow();
    // sanity: verifyDocumentToken itself is what throws for expiry
    expect(() => verifyDocumentToken(expiredToken)).toThrow();
  });

  it("throws DocumentNotFoundError when the object doesn't exist in R2", async () => {
    const forgedToken = signDocumentToken({ storagePath: "cv/does-not-exist.pdf" }, 60);
    await expect(resolveDocumentContent(forgedToken)).rejects.toThrow(DocumentNotFoundError);
  });
});

describe("deleteUploadedFile", () => {
  it("removes the object from R2", async () => {
    const storagePath = await saveUploadedFile(makeFile("cv.pdf"), "cv");
    await deleteUploadedFile(storagePath);

    const forgedToken = signDocumentToken({ storagePath }, 60);
    await expect(resolveDocumentContent(forgedToken)).rejects.toThrow(DocumentNotFoundError);
  });

  it("does not throw when the object is already gone", async () => {
    await expect(deleteUploadedFile("cv/does-not-exist.pdf")).resolves.toBeUndefined();
  });
});
