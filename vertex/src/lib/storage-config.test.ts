// Which object store the app talks to is chosen by configuration only:
// MinIO locally, AWS S3 later, Cloudflare R2 for older settings.
import { describe, it, expect } from "vitest";
import { resolveStorageConfig } from "./upload";

const keys = { S3_ACCESS_KEY_ID: "app-key", S3_SECRET_ACCESS_KEY: "app-secret" };

describe("resolveStorageConfig", () => {
  it("MinIO: explicit endpoint, path-style addressing, any region", () => {
    const c = resolveStorageConfig({ ...keys, S3_ENDPOINT: "http://minio:9000", S3_BUCKET: "vertex-dev" });
    expect(c).toMatchObject({ endpoint: "http://minio:9000", bucket: "vertex-dev", forcePathStyle: true, region: "us-east-1" });
  });

  it("AWS S3: no endpoint, the region decides, default addressing", () => {
    const c = resolveStorageConfig({ ...keys, S3_REGION: "eu-central-1", S3_BUCKET: "vertex-prod" });
    expect(c).toMatchObject({ endpoint: undefined, region: "eu-central-1", forcePathStyle: false });
  });

  it("Cloudflare R2: the legacy R2_* settings still work", () => {
    const c = resolveStorageConfig({
      R2_ACCOUNT_ID: "acct", R2_ACCESS_KEY_ID: "k", R2_SECRET_ACCESS_KEY: "s", R2_BUCKET_NAME: "docs",
    });
    expect(c).toMatchObject({ endpoint: "https://acct.r2.cloudflarestorage.com", bucket: "docs", forcePathStyle: false });
  });

  it("S3_* settings take precedence over R2_*", () => {
    const c = resolveStorageConfig({ ...keys, S3_ENDPOINT: "http://minio:9000", S3_BUCKET: "new", R2_BUCKET_NAME: "old" });
    expect(c.bucket).toBe("new");
  });

  it("refuses to run half-configured", () => {
    expect(() => resolveStorageConfig({ S3_BUCKET: "b" })).toThrow(/not configured/);
    expect(() => resolveStorageConfig({ ...keys, S3_BUCKET: "b" })).toThrow(/S3_REGION/); // AWS needs a region
  });
});
