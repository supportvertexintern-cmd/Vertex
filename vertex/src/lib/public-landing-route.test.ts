import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// GET /api/public/landing?app=mobile (the landing CMS, part 4): the mobile
// app's home screen before sign-in. Public and rate-limited; CORS only for
// the Flutter web build's origins (APP_ORIGINS).

const limitByIp = vi.fn();
vi.mock("@/lib/rate-limit", () => ({ limitByIp: (...args: unknown[]) => limitByIp(...args) }));
const getMobileLanding = vi.fn();
vi.mock("@/server/services/landingContent", () => ({ getMobileLanding: () => getMobileLanding() }));

import { GET, OPTIONS } from "@/app/api/public/landing/route";

const ANSWER = { app: "mobile", version: 1, blocks: [{ key: "mobile.hero", visible: true, body: { headline: "H" }, revision: 2 }] };
const ask = (query = "?app=mobile", origin?: string) =>
  GET(new NextRequest(`http://localhost/api/public/landing${query}`, { headers: origin ? { origin } : {} }));

beforeEach(() => {
  vi.stubEnv("APP_ORIGINS", "https://app.example.test");
  limitByIp.mockReset().mockResolvedValue(null);
  getMobileLanding.mockReset().mockResolvedValue(ANSWER);
});

afterEach(() => vi.unstubAllEnvs());

describe("GET /api/public/landing", () => {
  it("answers the mobile app's published blocks, rate-limited per address", async () => {
    const res = await ask();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: ANSWER });
    expect(limitByIp).toHaveBeenCalledWith(expect.anything(), "public-landing", { max: 60 });
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("answers only for the mobile app", async () => {
    for (const query of ["?app=web", ""]) {
      const res = await ask(query);
      expect(res.status).toBe(400);
    }
    expect(getMobileLanding).not.toHaveBeenCalled();
  });

  it("is a 503 when FastAPI can't answer, so the app keeps its own text", async () => {
    getMobileLanding.mockResolvedValue(null);
    expect((await ask()).status).toBe(503);
  });

  it("stops at the rate limit before FastAPI", async () => {
    limitByIp.mockResolvedValue(Response.json({ error: "Too many requests." }, { status: 429, headers: { "Retry-After": "12" } }));
    const res = await ask("?app=mobile", "https://app.example.test");
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("12");
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://app.example.test");
    expect(getMobileLanding).not.toHaveBeenCalled();
  });

  it("allows the Flutter web build's origin for GET, and no other", async () => {
    const allowed = await ask("?app=mobile", "https://app.example.test");
    expect(allowed.headers.get("Access-Control-Allow-Origin")).toBe("https://app.example.test");
    expect(allowed.headers.get("Access-Control-Allow-Methods")).toBe("GET, OPTIONS");
    expect(allowed.headers.get("Access-Control-Allow-Credentials")).toBeNull();
    const other = await ask("?app=mobile", "https://evil.example.test");
    expect(other.headers.get("Access-Control-Allow-Origin")).toBeNull();
    const preflight = OPTIONS(new NextRequest("http://localhost/api/public/landing", { method: "OPTIONS", headers: { origin: "https://app.example.test" } }));
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("Access-Control-Allow-Methods")).toBe("GET, OPTIONS");
  });
});
