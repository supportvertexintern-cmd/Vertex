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

const R2_BUCKET = process.env.R2_BUCKET_NAME;

// Cloudflare R2 is the only storage backend for candidate documents — there
// is no local-disk fallback. This app runs on Vercel, whose serverless
// functions have no persistent (or even reliably writable) local
// filesystem, so a local-disk primary silently doesn't work there: writes
// either throw immediately (read-only bundle path) or vanish between
// invocations. R2 (S3-compatible) is durable, reachable from any runtime,
// and requires no host-specific storage assumptions.
function getR2Client(): S3Client {
  if (!process.env.R2_ACCOUNT_ID || !process.env.R2_ACCESS_KEY_ID || !process.env.R2_SECRET_ACCESS_KEY || !R2_BUCKET) {
    throw new Error(
      "Document storage is not configured — R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, and R2_BUCKET_NAME are all required."
    );
  }
  return new S3Client({
    region: "auto",
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
  });
}

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

  const r2 = getR2Client();
  const buffer = Buffer.from(await file.arrayBuffer());
  await r2.send(
    new PutObjectCommand({
      Bucket: R2_BUCKET,
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
  const r2 = getR2Client();
  try {
    const res = await r2.send(new GetObjectCommand({ Bucket: R2_BUCKET, Key: storagePath }));
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
  const r2 = getR2Client();
  try {
    await r2.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: storagePath }));
  } catch (err) {
    console.error("R2 delete failed for", storagePath, err);
  }
}
