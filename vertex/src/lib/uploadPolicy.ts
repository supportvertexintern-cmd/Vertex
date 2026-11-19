// One upload policy for every file picker on the site (upstream staging,
// 2026-10-24 and 2026-11-13), so a refused file is caught when it's chosen,
// with a message that says what to do, instead of after it has uploaded.
//
// FastAPI decides (vertex_be/app/services/storage.py): PDF, JPEG or PNG,
// judged from the file's bytes, up to MAX_FILE_SIZE_MB. This mirrors that
// rule for the browser; it isn't a security boundary.
//
// The size limit is read when the page renders, not when the image is
// built: images are built once and promoted, so a limit baked in at build
// time could disagree with the FastAPI it's deployed next to. The root
// layout puts the server's MAX_FILE_SIZE_MB on <html data-max-upload-mb>.

export const DEFAULT_MAX_UPLOAD_MB = 5;
export const MAX_UPLOAD_MB_ATTRIBUTE = "data-max-upload-mb";

/** The limit as FastAPI applies it: MAX_FILE_SIZE_MB, 5 when unset. */
export function maxUploadMb(): number {
  const raw =
    typeof document === "undefined"
      ? process.env.MAX_FILE_SIZE_MB
      : document.documentElement.getAttribute(MAX_UPLOAD_MB_ATTRIBUTE);
  const mb = Number(raw);
  return Number.isFinite(mb) && mb > 0 ? mb : DEFAULT_MAX_UPLOAD_MB;
}

// For <input type="file" accept={UPLOAD_ACCEPT}>: narrows the picker to the
// kinds FastAPI takes (not "image/*", which offers GIF, HEIC and WebP).
export const UPLOAD_ACCEPT = "application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png";

/** Shown next to upload controls. */
export function uploadHint(): string {
  return `PDF, JPG or PNG · Max ${maxUploadMb()} MB`;
}

export const UPLOAD_MESSAGES = {
  tooLarge: () => `This file is too large. Please upload a file no larger than ${maxUploadMb()} MB.`,
  wrongType: () => "Only PDF, JPG and PNG files are allowed. Please select a PDF document or a JPG/PNG image.",
  invalidFile: () => "This file does not appear to be a valid PDF, JPG or PNG. Please upload a valid file.",
  failed: () => "We couldn't upload this file. Please check your connection and try again.",
};

const ACCEPTED_MIMES = new Set(["application/pdf", "image/jpeg", "image/jpg", "image/png"]);

/** True when the browser's declared type (or, failing that, the name) is one we take. */
export function looksLikeAcceptedSelection(file: { name: string; type: string }): boolean {
  // Some browsers report no type at all; only then does the name decide.
  if (file.type) return ACCEPTED_MIMES.has(file.type);
  return /\.(pdf|jpe?g|png)$/i.test(file.name);
}

// The same signatures FastAPI's detect_file_type checks, at the start of the file.
const SIGNATURES: [string, number[]][] = [
  ["pdf", [0x25, 0x50, 0x44, 0x46, 0x2d]], // %PDF-
  ["jpg", [0xff, 0xd8, 0xff]],
  ["png", [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
];

/** The accepted kind the file's first bytes show, or null. */
export function sniffUploadKind(head: Uint8Array): "pdf" | "jpg" | "png" | null {
  for (const [kind, sig] of SIGNATURES) {
    if (head.length >= sig.length && sig.every((b, i) => head[i] === b)) return kind as "pdf" | "jpg" | "png";
  }
  return null;
}

/**
 * Checks a chosen file before any upload: an accepted type, the size limit,
 * and bytes that really are a PDF, JPEG or PNG. Returns the message to show,
 * or null when the file is fine.
 */
export async function checkUploadFile(file: File): Promise<string | null> {
  if (!looksLikeAcceptedSelection(file)) return UPLOAD_MESSAGES.wrongType();
  if (file.size > maxUploadMb() * 1024 * 1024) return UPLOAD_MESSAGES.tooLarge();
  if (file.size === 0) return UPLOAD_MESSAGES.invalidFile();
  try {
    const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
    if (!sniffUploadKind(head)) return UPLOAD_MESSAGES.invalidFile();
  } catch {
    // Can't read it here: FastAPI's own check decides.
  }
  return null;
}

/**
 * The file chosen in an <input type="file">, checked. A refused file is
 * cleared from the input, so choosing the same file again after fixing it
 * still fires onChange. Pass e.currentTarget before any await.
 */
export async function readUploadSelection(input: HTMLInputElement): Promise<{ file: File | null; error: string | null }> {
  const file = input.files?.[0] ?? null;
  if (!file) return { file: null, error: null };
  const error = await checkUploadFile(file);
  if (error) {
    input.value = "";
    return { file: null, error };
  }
  return { file, error: null };
}

/** The first problem among several files, or null. */
export async function checkUploadFiles(files: File[]): Promise<string | null> {
  for (const file of files) {
    const problem = await checkUploadFile(file);
    if (problem) return problem;
  }
  return null;
}

/**
 * A failed POST /api/upload as a message for the user: FastAPI's own
 * message for a refusal it words for users (4xx), never a server error's
 * text. A 413 is the website's request-size cap, before FastAPI saw it.
 */
export async function uploadErrorMessage(res: Response): Promise<string> {
  if (res.status === 413) return UPLOAD_MESSAGES.tooLarge();
  if (res.status >= 500) return UPLOAD_MESSAGES.failed();
  try {
    const message = ((await res.json()) as { error?: unknown }).error;
    if (typeof message === "string" && message) return message;
  } catch {
    // Not JSON: fall through.
  }
  return UPLOAD_MESSAGES.failed();
}
