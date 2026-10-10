import { v4 as uuidv4 } from "uuid";
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { signDocumentToken, verifyDocumentToken } from "./jwt";

const ALLOWED_MIME_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/jpg",
  "image/png",
];

const CONTENT_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
};

const MAX_FILE_SIZE = (Number(process.env.MAX_FILE_SIZE_MB) || 5) * 1024 * 1024;
const DEFAULT_SIGNED_URL_TTL_SECONDS = 300; // 5 minutes

// Candidate documents live in S3-compatible object storage only, never on
// local disk (serverless and container filesystems aren't durable). One
// client, three kinds of backend, chosen by configuration alone:
//   - MinIO (the local Docker stacks): S3_ENDPOINT=http://minio:9000
//   - AWS S3: no S3_ENDPOINT, S3_REGION set (e.g. eu-central-1)
//   - Cloudflare R2: the legacy R2_* variables, still honoured
// S3_* names win; R2_* are the fallback for existing configurations.
export interface StorageConfig {
  bucket: string;
  region: string;
  endpoint?: string; // undefined for AWS S3: the SDK derives it from the region
  forcePathStyle: boolean;
  accessKeyId: string;
  secretAccessKey: string;
}

export function resolveStorageConfig(env: Record<string, string | undefined> = process.env): StorageConfig {
  const bucket = env.S3_BUCKET || env.R2_BUCKET_NAME;
  const accessKeyId = env.S3_ACCESS_KEY_ID || env.R2_ACCESS_KEY_ID;
  const secretAccessKey = env.S3_SECRET_ACCESS_KEY || env.R2_SECRET_ACCESS_KEY;
  const endpoint =
    env.S3_ENDPOINT ||
    env.R2_ENDPOINT ||
    (env.R2_ACCOUNT_ID ? `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com` : undefined);
  const region = env.S3_REGION || (endpoint ? "us-east-1" : undefined);
  if (!bucket || !accessKeyId || !secretAccessKey || !region) {
    throw new Error(
      "Document storage is not configured: set S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY and either S3_ENDPOINT (MinIO, R2) or S3_REGION (AWS S3)."
    );
  }
  // MinIO serves buckets by path (http://minio:9000/<bucket>); AWS and R2
  // use their default addressing.
  const forcePathStyle = Boolean(env.S3_ENDPOINT || env.R2_ENDPOINT);
  return { bucket, region, endpoint, forcePathStyle, accessKeyId, secretAccessKey };
}

function getStorageClient(): S3Client {
  const { region, endpoint, forcePathStyle, accessKeyId, secretAccessKey } = resolveStorageConfig();
  return new S3Client({ region, endpoint, forcePathStyle, credentials: { accessKeyId, secretAccessKey } });
}

const storageBucket = () => resolveStorageConfig().bucket;

function contentTypeForPath(storagePath: string): string {
  const ext = (storagePath.split(".").pop() || "").toLowerCase();
  return CONTENT_TYPES[ext] || "application/octet-stream";
}

export class DocumentNotFoundError extends Error {}

/**
 * Saves a candidate document to R2 and returns its storage key (never a
 * public URL — callers must request a short-lived signed URL via
 * getSignedDocumentUrl to view it; the object itself is only ever read back
 * through the app's own token-gated proxy route, never a direct R2 URL).
 */
export async function saveUploadedFile(
  file: File,
  type: string
): Promise<string> {
  if (!ALLOWED_MIME_TYPES.includes(file.type)) {
    throw new Error("Invalid file type. Only PDF, JPEG, and PNG are allowed.");
  }

  if (file.size > MAX_FILE_SIZE) {
    throw new Error(`File too large. Maximum size is ${process.env.MAX_FILE_SIZE_MB || 5}MB.`);
  }

  const ext = file.name.split(".").pop() || "bin";
  const uniqueName = `${uuidv4()}.${ext}`;
  const storagePath = `${type}/${uniqueName}`;

  const r2 = getStorageClient();
  const buffer = Buffer.from(await file.arrayBuffer());
  await r2.send(
    new PutObjectCommand({
      Bucket: storageBucket(),
      Key: storagePath,
      Body: buffer,
      ContentType: contentTypeForPath(storagePath),
    })
  );

  return storagePath;
}

/**
 * Generates a short-lived signed URL for a private document. Call this
 * on-demand at view time — never cache or persist the result.
 */
export async function getSignedDocumentUrl(
  storagePath: string,
  expiresInSeconds: number = DEFAULT_SIGNED_URL_TTL_SECONDS
): Promise<string> {
  const token = signDocumentToken({ storagePath }, expiresInSeconds);
  return `/api/documents/file?token=${encodeURIComponent(token)}`;
}

export interface ResolvedDocument {
  buffer: Buffer;
  extension: string;
}

/**
 * Fetches a stored document's raw bytes directly by its R2 key — no token
 * involved, so this is for trusted server-side callers only (an API route
 * that's already independently authorized the request, e.g. attaching an
 * uploaded invoice to an outbound email) rather than anything reachable
 * from a client request. Client-facing reads must go through
 * resolveDocumentContent below instead.
 */
export async function getStorageContent(storagePath: string): Promise<ResolvedDocument> {
  const extension = (storagePath.split(".").pop() || "bin").toLowerCase();
  const r2 = getStorageClient();
  try {
    const res = await r2.send(new GetObjectCommand({ Bucket: storageBucket(), Key: storagePath }));
    const bytes = await res.Body?.transformToByteArray();
    if (!bytes) throw new DocumentNotFoundError("Document not found in storage.");
    return { buffer: Buffer.from(bytes), extension };
  } catch (err) {
    if (err instanceof DocumentNotFoundError) throw err;
    throw new DocumentNotFoundError("Document not found in storage.");
  }
}

/**
 * Resolves a signed document token to its actual bytes, fetched directly
 * from R2. Throws if the token is invalid/expired or the object doesn't
 * exist.
 */
export async function resolveDocumentContent(token: string): Promise<ResolvedDocument> {
  const { storagePath } = verifyDocumentToken(token);
  return getStorageContent(storagePath);
}

export async function deleteUploadedFile(storagePath: string): Promise<void> {
  const r2 = getStorageClient();
  try {
    await r2.send(new DeleteObjectCommand({ Bucket: storageBucket(), Key: storagePath }));
  } catch (err) {
    console.error("R2 delete failed for", storagePath, err);
  }
}
