import { v4 as uuidv4 } from "uuid";
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { signDocumentToken, verifyDocumentToken } from "./jwt";
import { scanBuffer, scannerConfigured } from "./malware-scan";
import { onScannerUnavailable } from "./security-monitor";

import { log } from "./log";
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

export class DocumentNotFoundError extends Error {}

/**
 * Saves a candidate document to R2 and returns its storage key (never a
 * public URL — callers must request a short-lived signed URL via
 * getSignedDocumentUrl to view it; the object itself is only ever read back
 * through the app's own token-gated proxy route, never a direct R2 URL).
 */
export class MalwareDetectedError extends Error {
  constructor(readonly signature: string) {
    super("This file was rejected by the malware scanner.");
  }
}

export interface SavedDocument {
  storagePath: string;
  // "unscanned" when the scanner couldn't be reached (fail-open policy);
  // such files are scanned when next opened (lib/document-access.ts).
  scanStatus: "clean" | "unscanned";
  scannedAt: Date | null;
}

export async function saveUploadedDocument(file: File, type: string): Promise<SavedDocument> {
  // The storage folder is a document-type key; never let a caller's input
  // shape the object path.
  if (!/^[a-z0-9_]{1,64}$/.test(type)) {
    throw new Error("Invalid document type.");
  }

  if (!ALLOWED_MIME_TYPES.includes(file.type)) {
    throw new Error("Invalid file type. Only PDF, JPEG, and PNG are allowed.");
  }

  if (file.size > MAX_FILE_SIZE) {
    throw new Error(`File too large. Maximum size is ${process.env.MAX_FILE_SIZE_MB || 5}MB.`);
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  if (buffer.length > MAX_FILE_SIZE) {
    throw new Error(`File too large. Maximum size is ${process.env.MAX_FILE_SIZE_MB || 5}MB.`);
  }

  // Scan everything that arrives, before any other judgement about it.
  const scan = await scanBuffer(buffer);
  if (scan.status === "infected") {
    throw new MalwareDetectedError(scan.signature);
  }
  if (scan.status === "unavailable" && scannerConfigured()) onScannerUnavailable(scan.reason);

  // The browser's declared type is only a claim: the bytes decide. The
  // extension comes from the detected type, never the user's filename.
  const detected = detectFileType(buffer);
  if (!detected || !sameFileFamily(detected.mime, file.type)) {
    throw new Error("File content does not match an allowed type (PDF, JPEG, PNG).");
  }

  const storagePath = `${type}/${uuidv4()}.${detected.ext}`;

  const r2 = getStorageClient();
  await r2.send(
    new PutObjectCommand({
      Bucket: storageBucket(),
      Key: storagePath,
      Body: buffer,
      ContentType: detected.mime,
    })
  );

  const clean = scan.status === "clean";
  return { storagePath, scanStatus: clean ? "clean" : "unscanned", scannedAt: clean ? new Date() : null };
}

/** Stores a document and returns only its storage key. */
export async function saveUploadedFile(file: File, type: string): Promise<string> {
  return (await saveUploadedDocument(file, type)).storagePath;
}

/**
 * Identifies an allowed document type from its first bytes (magic numbers),
 * independent of the filename or the browser's declared MIME type.
 */
export function detectFileType(bytes: Uint8Array): { mime: string; ext: string } | null {
  const starts = (sig: number[]) => bytes.length >= sig.length && sig.every((b, i) => bytes[i] === b);
  if (starts([0x25, 0x50, 0x44, 0x46, 0x2d])) return { mime: "application/pdf", ext: "pdf" }; // %PDF-
  if (starts([0xff, 0xd8, 0xff])) return { mime: "image/jpeg", ext: "jpg" };
  if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { mime: "image/png", ext: "png" };
  return null;
}

function sameFileFamily(detected: string, declared: string): boolean {
  const normalise = (m: string) => (m === "image/jpg" ? "image/jpeg" : m);
  return normalise(detected) === normalise(declared);
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
export async function resolveDocumentContent(token: string): Promise<ResolvedDocument & { storagePath: string }> {
  const { storagePath } = verifyDocumentToken(token);
  return { ...(await getStorageContent(storagePath)), storagePath };
}

export async function deleteUploadedFile(storagePath: string): Promise<void> {
  const r2 = getStorageClient();
  try {
    await r2.send(new DeleteObjectCommand({ Bucket: storageBucket(), Key: storagePath }));
  } catch (err) {
    log.error("storage.delete_failed", { storage_path: storagePath, err });
  }
}
