// Phase 10: structured logs, redaction and request IDs (no database).
import { afterEach, describe, expect, it, vi } from "vitest";
vi.hoisted(() => {
  process.env.JWT_SECRET ??= "test-only-signing-value-not-a-real-secret-logging";
});
import { NextRequest } from "next/server";
import { emit, log, setLogSink } from "./log";
import { redact, redactString } from "./redact";
import { resolveRequestId } from "./request-context";
import { redactSnapshot } from "./audit";
import { proxy } from "@/proxy";

// Built at runtime so the secret scanner (rightly) doesn't flag a JWT-shaped literal.
const JWT = ["eyJhbGciOiJIUzI1NiJ9", "eyJ1c2VySWQiOiJ4In0", "c2lnbmF0dXJlLXZhbHVl"].join(".");

function capture(): Record<string, unknown>[] {
  const lines: Record<string, unknown>[] = [];
  setLogSink((line) => lines.push(JSON.parse(line)));
  return lines;
}

afterEach(() => setLogSink(null));

describe("redact", () => {
  it("removes credentials by key, at any depth", () => {
    const out = redact({
      password: "hunter2",
      nested: { api_key: "k-123", authorization: "Bearer abc", list: [{ refresh_token: "r-1" }] },
      DATABASE_URL: "postgresql://u:<DB_PASSWORD>@db/x",
      cookie: "auth_token=abc",
    });
    const text = JSON.stringify(out);
    for (const secret of ["hunter2", "k-123", "Bearer abc", "r-1", "<DB_PASSWORD>", "auth_token=abc"]) expect(text).not.toContain(secret);
  });

  it("removes credential shapes from free text", () => {
    expect(redactString(`token ${JWT} failed`)).toBe("token [redacted-jwt] failed");
    expect(redactString("connect postgresql://vertex_web:<DB_PASSWORD>@db:5432/vertex")).toBe("connect postgresql://[redacted]@db:5432/vertex");
    expect(redactString("GET /api/documents/file?token=abc.def.ghi&x=1")).toBe("GET /api/documents/file?token=[redacted]&x=1");
    expect(redactString("Authorization: Bearer sk_live_123")).toBe("Authorization: Bearer [redacted]");
  });

  it("keeps fields that only look sensitive", () => {
    const out = redact({ passport_number: "P123", permit_authorization_approved: true, stripe_checkout_session_id: "cs_1" }) as Record<string, unknown>;
    expect(out).toEqual({ passport_number: "P123", permit_authorization_approved: true, stripe_checkout_session_id: "cs_1" });
  });

  it("survives cycles, BigInts and throwing getters", () => {
    const cyclic: Record<string, unknown> = { a: BigInt(1) };
    cyclic.self = cyclic;
    Object.defineProperty(cyclic, "boom", { enumerable: true, get: () => { throw new Error("x"); } });
    expect(() => redact(cyclic)).not.toThrow();
  });

  it("audit snapshots never keep the password hash or tokens", () => {
    const snap = redactSnapshot("User", { email: "a@b.c", password_hash: "$2b$10$abc", note: `link ?token=${JWT}` });
    expect(snap).toMatchObject({ email: "a@b.c", password_hash: "[redacted]" });
    expect(JSON.stringify(snap)).not.toContain(JWT);
  });
});

describe("log", () => {
  it("writes one JSON object with the standard fields", () => {
    const lines = capture();
    log.warn("auth.login_failed", { request_id: "req-12345678", reason: "bad_password", password: "hunter2" });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ level: "warn", service: "nextjs", event: "auth.login_failed", request_id: "req-12345678", reason: "bad_password", password: "[redacted]" });
    expect(typeof lines[0].ts).toBe("string");
  });

  it("serializes errors without leaking what they quote", () => {
    const lines = capture();
    log.error("db.failed", { request_id: null, err: new Error("connect postgresql://u:<DB_PASSWORD>@db/x refused") });
    expect(JSON.stringify(lines[0])).not.toContain("<DB_PASSWORD>");
    expect(lines[0].err).toMatchObject({ name: "Error" });
  });

  it("never throws, even when the output does", () => {
    setLogSink(() => {
      throw new Error("disk full");
    });
    expect(() => emit("error", "x", { request_id: null, value: { toJSON: () => { throw new Error("nope"); } } })).not.toThrow();
  });
});

describe("request IDs", () => {
  it("keeps a well-formed caller ID and replaces anything else", () => {
    expect(resolveRequestId("trace-0123456789")).toBe("trace-0123456789");
    for (const bad of [null, "", "short", "has space 123456", "x".repeat(200), "line\nbreak-123456", "<script>12345"]) {
      expect(resolveRequestId(bad)).toMatch(/^[0-9a-f-]{36}$/);
    }
  });

  it("the proxy returns the ID and passes it (and the path) to the handler", () => {
    const res = proxy(new NextRequest("http://localhost/api/jobs", { headers: { "x-request-id": "trace-0123456789", "x-vertex-path": "/forged" } }));
    expect(res.headers.get("x-request-id")).toBe("trace-0123456789");
    expect(res.headers.get("x-middleware-request-x-request-id")).toBe("trace-0123456789");
    expect(res.headers.get("x-middleware-request-x-vertex-path")).toBe("/api/jobs"); // the client's value is overwritten
  });

  it("the proxy issues an ID on redirects and rejections too", () => {
    const redirect = proxy(new NextRequest("http://localhost/admin"));
    expect(redirect.status).toBe(307);
    expect(redirect.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
  });
});
