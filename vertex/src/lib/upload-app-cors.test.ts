import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The mobile app's intake uploads (a recruiter's Candidate Information Form,
// 2026-11-21): the Flutter web build's origins (APP_ORIGINS) may call
// /api/upload?intake=1; no other origin gets CORS headers, and no upload
// path accepts credentials cross-origin.

const callBackend = vi.fn();
vi.mock("@/lib/backend", () => ({ callBackend: (...args: unknown[]) => callBackend(...args) }));
vi.mock("@/lib/rate-limit", () => ({
  rateLimit: async () => ({ success: true, remaining: 1, resetAt: 0 }),
  limitedResponse: () => Response.json({ error: "Too many uploads." }, { status: 429 }),
}));
vi.mock("@/lib/api-auth", () => ({ getAuthUser: async () => null, requireAuth: () => Response.json({ error: "Unauthorized" }, { status: 401 }) }));

import { OPTIONS, POST } from "@/app/api/upload/route";

const APP = "https://app.example.test";
const upload = (origin?: string, query = "?intake=1&type=passport") => {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array([1, 2, 3])], { type: "image/jpeg" }), "passport.jpg");
  return POST(new NextRequest(`http://localhost/api/upload${query}`, { method: "POST", body: form, headers: origin ? { origin } : {} }));
};

beforeEach(() => {
  vi.stubEnv("APP_ORIGINS", APP);
  callBackend.mockReset().mockResolvedValue({ ok: true, status: 200, body: { data: { id: "d1", intake_token: "receipt-1" } } });
});
afterEach(() => vi.unstubAllEnvs());

describe("intake uploads from the app", () => {
  it("answer the app's origin with its receipt and CORS headers, without credentials", async () => {
    const res = await upload(APP);
    expect(await res.json()).toEqual({ documentId: "d1", intake_token: "receipt-1" });
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(APP);
    expect(res.headers.get("Access-Control-Allow-Credentials")).toBeNull();
  });

  it("give another origin no CORS headers", async () => {
    expect((await upload("https://evil.example.test")).headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("answer the app's preflight", () => {
    const res = OPTIONS(new NextRequest("http://localhost/api/upload?intake=1", { method: "OPTIONS", headers: { origin: APP } }));
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(APP);
  });

  it("leave the signed-in uploads same-origin", async () => {
    const res = await upload(APP, "?type=passport&candidate_id=c1");
    expect(res.status).toBe(401);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });
});
