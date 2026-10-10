// Authorization pipeline stage 1: bodies are capped before any handler reads them.
import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { checkRequestSize } from "./request-size";
import { proxy } from "@/proxy";

const MB = 1024 * 1024;

function req(path: string, method: string, headers: Record<string, string> = {}) {
  return new NextRequest(`http://localhost${path}`, { method, headers });
}

describe("request size limits", () => {
  it("lets ordinary JSON bodies through", () => {
    expect(checkRequestSize(req("/api/auth/login", "POST", { "content-length": "200" }))).toBeNull();
  });

  it("rejects a JSON body over 1 MB with 413", () => {
    expect(checkRequestSize(req("/api/contact", "POST", { "content-length": String(MB + 1) }))?.status).toBe(413);
  });

  it("allows an upload up to the file limit plus form overhead, not beyond", () => {
    expect(checkRequestSize(req("/api/upload", "POST", { "content-length": String(5 * MB) }))).toBeNull();
    expect(checkRequestSize(req("/api/upload", "POST", { "content-length": String(6 * MB + 1) }))?.status).toBe(413);
  });

  it("refuses a streamed body that doesn't declare its length", () => {
    expect(checkRequestSize(req("/api/chat", "POST", { "transfer-encoding": "chunked" }))?.status).toBe(411);
  });

  it("rejects a malformed Content-Length", () => {
    expect(checkRequestSize(req("/api/chat", "POST", { "content-length": "-5" }))?.status).toBe(400);
  });

  it("ignores requests without a body", () => {
    expect(checkRequestSize(req("/api/jobs", "GET"))).toBeNull();
    expect(checkRequestSize(req("/api/auth/logout", "POST"))).toBeNull();
  });

  it("is applied by the proxy to every /api request", () => {
    expect(proxy(req("/api/applications", "POST", { "content-length": String(50 * MB) })).status).toBe(413);
  });
});
