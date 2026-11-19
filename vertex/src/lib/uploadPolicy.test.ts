// The browser's upload policy (lib/uploadPolicy.ts) agrees with FastAPI's
// (vertex_be/app/services/storage.py): the same kinds, signatures and limit,
// and every file picker on the site uses it.
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_MAX_UPLOAD_MB,
  UPLOAD_ACCEPT,
  UPLOAD_MESSAGES,
  checkUploadFile,
  maxUploadMb,
  readUploadSelection,
  sniffUploadKind,
  uploadErrorMessage,
  uploadHint,
} from "@/lib/uploadPolicy";

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);
// A fresh copy is ArrayBuffer-backed, which a File's parts must be.
const file = (bytes: Uint8Array | string, name: string, type: string) =>
  new File([typeof bytes === "string" ? bytes : new Uint8Array(bytes)], name, { type });

afterEach(() => vi.unstubAllEnvs());

describe("the limit", () => {
  it("is FastAPI's MAX_FILE_SIZE_MB, 5 when unset or nonsense", () => {
    vi.stubEnv("MAX_FILE_SIZE_MB", "");
    expect(maxUploadMb()).toBe(DEFAULT_MAX_UPLOAD_MB);
    vi.stubEnv("MAX_FILE_SIZE_MB", "abc");
    expect(maxUploadMb()).toBe(5);
    vi.stubEnv("MAX_FILE_SIZE_MB", "12");
    expect(maxUploadMb()).toBe(12);
    expect(uploadHint()).toBe("PDF, JPG or PNG · Max 12 MB");
    expect(UPLOAD_MESSAGES.tooLarge()).toContain("no larger than 12 MB");
  });

  it("defaults to the same 5 MB FastAPI does", () => {
    const config = readFileSync(path.resolve(__dirname, "../../../vertex_be/app/core/config.py"), "utf8");
    expect(config).toMatch(new RegExp(`MAX_FILE_SIZE_MB: int = ${DEFAULT_MAX_UPLOAD_MB}\\b`));
  });
});

describe("a chosen file", () => {
  it("is fine as a real PDF, JPEG or PNG", async () => {
    expect(await checkUploadFile(file(PDF, "cv.pdf", "application/pdf"))).toBeNull();
    expect(await checkUploadFile(file(JPEG, "passport.jpg", "image/jpeg"))).toBeNull();
    expect(await checkUploadFile(file(PNG, "photo.png", "image/png"))).toBeNull();
    // No type from the browser: the name decides.
    expect(await checkUploadFile(file(PDF, "scan.PDF", ""))).toBeNull();
  });

  it("is refused as another kind, even an image FastAPI won't take", async () => {
    for (const [name, type] of [["a.gif", "image/gif"], ["a.heic", "image/heic"], ["a.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"], ["a.html", ""]]) {
      expect(await checkUploadFile(file(PDF, name, type))).toBe(UPLOAD_MESSAGES.wrongType());
    }
  });

  it("is refused when its bytes aren't what it says, or it's empty", async () => {
    expect(await checkUploadFile(file("<html>hi</html>", "cv.pdf", "application/pdf"))).toBe(UPLOAD_MESSAGES.invalidFile());
    expect(await checkUploadFile(file(new Uint8Array(), "cv.pdf", "application/pdf"))).toBe(UPLOAD_MESSAGES.invalidFile());
  });

  it("is refused over the limit, before it's read", async () => {
    vi.stubEnv("MAX_FILE_SIZE_MB", "1");
    const big = file(new Uint8Array(1024 * 1024 + 1), "big.pdf", "application/pdf");
    expect(await checkUploadFile(big)).toBe(UPLOAD_MESSAGES.tooLarge());
  });

  it("is cleared from its picker when refused, so it can be chosen again", async () => {
    const refused = { files: [file("nope", "cv.pdf", "application/pdf")], value: "C:\\fakepath\\cv.pdf" };
    expect(await readUploadSelection(refused as unknown as HTMLInputElement)).toEqual({ file: null, error: UPLOAD_MESSAGES.invalidFile() });
    expect(refused.value).toBe("");
    const kept = { files: [file(PDF, "cv.pdf", "application/pdf")], value: "C:\\fakepath\\cv.pdf" };
    expect((await readUploadSelection(kept as unknown as HTMLInputElement)).file).toBe(kept.files[0]);
    expect(kept.value).not.toBe("");
  });
});

describe("the signatures", () => {
  it("are FastAPI's detect_file_type", () => {
    const storage = readFileSync(path.resolve(__dirname, "../../../vertex_be/app/services/storage.py"), "utf8");
    expect(storage).toContain('data.startswith(b"%PDF-")');
    expect(storage).toContain('data.startswith(b"\\xff\\xd8\\xff")');
    expect(storage).toContain('data.startswith(b"\\x89PNG\\r\\n\\x1a\\n")');
    expect([sniffUploadKind(PDF), sniffUploadKind(JPEG), sniffUploadKind(PNG), sniffUploadKind(new Uint8Array([1, 2, 3]))]).toEqual(["pdf", "jpg", "png", null]);
  });
});

describe("a failed upload's message", () => {
  const res = (status: number, body: string) => new Response(body, { status });

  it("is FastAPI's own for a refusal", async () => {
    expect(await uploadErrorMessage(res(400, JSON.stringify({ error: "File content does not match an allowed type (PDF, JPEG, PNG)." })))).toBe(
      "File content does not match an allowed type (PDF, JPEG, PNG)."
    );
  });

  it("is the size message for the website's request cap", async () => {
    expect(await uploadErrorMessage(res(413, JSON.stringify({ error: "Request body too large." })))).toBe(UPLOAD_MESSAGES.tooLarge());
  });

  it("never shows a server error's text", async () => {
    expect(await uploadErrorMessage(res(500, JSON.stringify({ error: "relation \"Document\" does not exist" })))).toBe(UPLOAD_MESSAGES.failed());
    expect(await uploadErrorMessage(res(400, "<html>proxy error</html>"))).toBe(UPLOAD_MESSAGES.failed());
  });
});

describe("every file picker on the site", () => {
  const src = path.resolve(__dirname, "..");
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const full = path.join(dir, name);
      return statSync(full).isDirectory() ? files(full) : full.endsWith(".tsx") && !full.endsWith(".test.tsx") ? [full] : [];
    });
  const pickers = files(src).flatMap((f) =>
    [...readFileSync(f, "utf8").matchAll(/<input[^>]*?type="file"[\s\S]*?\/>/g)].map((m) => ({ file: path.relative(src, f), tag: m[0] }))
  );

  it("are found", () => {
    expect(pickers.length).toBeGreaterThanOrEqual(16);
  });

  it.each(pickers.map((p) => [p.file, p.tag] as const))("%s uses the shared accept list and check", (_file, tag) => {
    expect(tag).toContain("accept={UPLOAD_ACCEPT}");
    expect(tag).not.toMatch(/e\.target\.files/);
  });

  it("accept only what FastAPI stores", () => {
    expect(UPLOAD_ACCEPT).toBe("application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png");
  });
});
