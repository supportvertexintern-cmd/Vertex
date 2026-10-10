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
