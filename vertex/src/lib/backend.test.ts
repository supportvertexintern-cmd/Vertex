import { hkdfSync } from "node:crypto";
import jwt from "jsonwebtoken";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// callBackend() (lib/backend.ts): what it sends to FastAPI and how it reads
// the answer. fetch and next/headers are stubbed; nothing leaves the process.

const state: { token: string | null; requestId: string } = { token: "user-session-token", requestId: "req-backend-1" };

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-request-id": state.requestId }),
  cookies: async () => ({ get: (name: string) => (name === "auth_token" && state.token ? { value: state.token } : undefined) }),
}));

const SERVICE_SECRET = "s".repeat(40);
const fetchMock = vi.fn();

async function load() {
  vi.resetModules(); // jwt.ts caches derived keys per process
  return import("./backend");
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

beforeEach(() => {
  state.token = "user-session-token";
  vi.stubEnv("BACKEND_URL", "http://backend:8000");
  vi.stubEnv("SERVICE_AUTH_SECRET", SERVICE_SECRET);
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("callBackend", () => {
  it("sends the service credential, the user's session and the request ID", async () => {
    const { callBackend } = await load();
    fetchMock.mockResolvedValue(json(200, { data: { ok: true } }));

    const result = await callBackend("/api/v1/fee-policy", { method: "POST", body: { a: 1 }, query: { page: 2, skip: undefined } });

    expect(result).toEqual({ ok: true, status: 200, body: { data: { ok: true } } });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("http://backend:8000/api/v1/fee-policy?page=2");
    expect(init.method).toBe("POST");
    expect(init.body).toBe('{"a":1}');
    expect(init.redirect).toBe("error");
    expect(init.headers.Authorization).toBe("Bearer user-session-token");
    expect(init.headers["x-request-id"]).toBe("req-backend-1");
    expect(init.headers["Content-Type"]).toBe("application/json");

    // The same key FastAPI derives (vertex_be/app/core/tokens.py).
    const key = Buffer.from(hkdfSync("sha256", SERVICE_SECRET, "vertex-token-keys", "vertex/jwt/service/v1", 32));
    const claims = jwt.verify(init.headers["X-Vertex-Service"], key, {
      algorithms: ["HS256"],
      issuer: "vertex-web",
      audience: "vertex:service",
    }) as jwt.JwtPayload;
    expect(claims.sub).toBe("vertex-web");
    expect(claims.scope).toBe("backend");
    expect(claims.exp! - claims.iat!).toBe(60);
  });

  it("is not signed with JWT_SECRET", async () => {
    vi.stubEnv("JWT_SECRET", "j".repeat(40));
    const { callBackend } = await load();
    fetchMock.mockResolvedValue(json(200, { data: null }));
    await callBackend("/api/v1/me");
    const token = fetchMock.mock.calls[0][1].headers["X-Vertex-Service"];
    const sessionKey = Buffer.from(hkdfSync("sha256", "j".repeat(40), "vertex-token-keys", "vertex/jwt/service/v1", 32));
    expect(() => jwt.verify(token, sessionKey, { algorithms: ["HS256"] })).toThrow();
  });

  it("passes FastAPI's error envelope and status on", async () => {
    const { callBackend, backendResponse } = await load();
    const error = { code: "validation_error", message: "Validation failed", details: { amount: ["Field required"] } };
    fetchMock.mockResolvedValue(json(422, { error }));

    const result = await callBackend("/api/v1/fee-policy", { method: "PUT", body: {} });
    expect(result).toEqual({ ok: false, status: 422, error });

    const res = backendResponse(result);
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error });
  });

  it("passes a page's extra fields on", async () => {
    const { callBackend, backendResponse } = await load();
    const page = { data: [1, 2], total: 2, page: 1, pageSize: 15 };
    fetchMock.mockResolvedValue(json(200, page));
    const res = backendResponse(await callBackend("/api/v1/things"));
    expect(await res.json()).toEqual(page);
  });

  it("treats 204 as success with no data", async () => {
    const { callBackend } = await load();
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    expect(await callBackend("/api/v1/x", { method: "DELETE" })).toEqual({ ok: true, status: 204, body: { data: null } });
  });

  it("without a session cookie, refuses before calling", async () => {
    state.token = null;
    const { callBackend } = await load();
    const result = await callBackend("/api/v1/me");
    expect(result).toMatchObject({ ok: false, status: 401, error: { code: "unauthorized" } });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends no user session when asUser is false", async () => {
    state.token = null;
    const { callBackend } = await load();
    fetchMock.mockResolvedValue(json(200, { data: 1 }));
    await callBackend("/api/v1/internal", { asUser: false });
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBeUndefined();
  });

  it.each([
    ["BACKEND_URL", 503],
    ["SERVICE_AUTH_SECRET", 503],
  ])("fails closed without %s", async (name, status) => {
    vi.stubEnv(name, "");
    const { callBackend } = await load();
    expect(await callBackend("/api/v1/me")).toMatchObject({ ok: false, status, error: { code: "backend_unavailable" } });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails closed with a short SERVICE_AUTH_SECRET", async () => {
    vi.stubEnv("SERVICE_AUTH_SECRET", "too-short");
    const { callBackend } = await load();
    expect(await callBackend("/api/v1/me")).toMatchObject({ ok: false, status: 503 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("turns a network failure into 502 and a timeout into 504", async () => {
    const { callBackend } = await load();
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    expect(await callBackend("/api/v1/me")).toMatchObject({ ok: false, status: 502, error: { code: "backend_unavailable" } });
    fetchMock.mockRejectedValueOnce(Object.assign(new Error("timed out"), { name: "TimeoutError" }));
    expect(await callBackend("/api/v1/me")).toMatchObject({ ok: false, status: 504 });
  });

  it("does not pass on a response in neither shape (e.g. a proxy's HTML error page)", async () => {
    const { callBackend } = await load();
    fetchMock.mockResolvedValue(new Response("<html>Bad gateway</html>", { status: 502 }));
    expect(await callBackend("/api/v1/me")).toMatchObject({ ok: false, status: 502, error: { code: "backend_unavailable" } });
    fetchMock.mockResolvedValue(json(200, { something: "else" }));
    expect(await callBackend("/api/v1/me")).toMatchObject({ ok: false, status: 502 });
  });

  it("only takes a path, never another host", async () => {
    const { callBackend } = await load();
    await expect(callBackend("http://evil.example/api")).rejects.toThrow();
    await expect(callBackend("//evil.example/api")).rejects.toThrow();
  });
});
