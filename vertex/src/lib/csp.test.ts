// E3 (docs/security/csp.md): per-request CSP nonces, and the regression
// check the exception plan requires: the build fails if script-src ever
// allows 'unsafe-inline' or 'unsafe-eval' again, or if inline script code
// comes back into the pages.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "@/proxy";
import nextConfig from "../../next.config";
import { legacyPolicy, noncePolicy, scriptSrc } from "@/lib/csp";
import { setLogSink } from "@/lib/log";
import { POST as cspReport } from "@/app/api/csp-report/route";

function page(url = "http://localhost/jobs", init?: ConstructorParameters<typeof NextRequest>[1]) {
  return proxy(new NextRequest(url, init));
}

// NextResponse.next({ request: { headers } }) passes overridden request
// headers to the app as x-middleware-request-<name>.
const forwarded = (res: Response, name: string) => res.headers.get(`x-middleware-request-${name}`);

afterEach(() => {
  delete process.env.CSP_MODE;
});

describe("per-request nonce", () => {
  it("is 128 random bits, different on every response, and forwarded to Next.js", () => {
    const a = forwarded(page(), "x-nonce")!;
    const b = forwarded(page(), "x-nonce")!;
    expect(Buffer.from(a, "base64")).toHaveLength(16);
    expect(a).not.toBe(b);
  });

  it("is the nonce in the policy Next.js reads and the browser receives", () => {
    const res = page();
    const nonce = forwarded(res, "x-nonce")!;
    // Next.js reads the nonce from this internal request header in both modes.
    expect(forwarded(res, "content-security-policy")).toContain(`'nonce-${nonce}'`);
    expect(res.headers.get("Content-Security-Policy-Report-Only")).toContain(`'nonce-${nonce}'`);
  });

  it("can't be chosen by the client", () => {
    const res = page("http://localhost/jobs", {
      headers: { "content-security-policy": "script-src 'nonce-attacker'", "x-nonce": "attacker" },
    });
    expect(forwarded(res, "x-nonce")).not.toBe("attacker");
    expect(forwarded(res, "content-security-policy")).not.toContain("attacker");
  });

  it("covers portal redirects and the home page too", () => {
    expect(page("http://localhost/").headers.get("Content-Security-Policy-Report-Only")).toContain("'nonce-");
    expect(page("http://localhost/admin").headers.get("Content-Security-Policy-Report-Only")).toContain("'nonce-");
  });
});

describe("modes", () => {
  it("report-only (default): nonce policy reported; the enforced one stays next.config's static policy", async () => {
    const res = page();
    // Not set by the proxy: Next.js would copy it into the request and lose
    // the nonce (docs/security/csp.md §1).
    expect(res.headers.get("Content-Security-Policy")).toBeNull();
    const rules = await nextConfig.headers!();
    expect(Object.fromEntries(rules[0].headers.map((h) => [h.key, h.value]))["Content-Security-Policy"]).toBe(legacyPolicy());
    expect(res.headers.get("Content-Security-Policy-Report-Only")).toMatch(/report-uri \/api\/csp-report/);
    expect(res.headers.get("Reporting-Endpoints")).toBeNull(); // plain http: report-uri only
  });

  it("enforce: the nonce policy is enforced, with reporting on", () => {
    process.env.CSP_MODE = "enforce";
    const res = page();
    const csp = res.headers.get("Content-Security-Policy")!;
    expect(csp).toContain(`'nonce-${forwarded(res, "x-nonce")}'`);
    expect(csp).toContain("report-uri /api/csp-report");
    expect(res.headers.get("Content-Security-Policy-Report-Only")).toBeNull();
    expect(forwarded(res, "content-security-policy")).toBe(csp);
  });

  it("report-to and Reporting-Endpoints only behind HTTPS (Chromium drops report-uri when report-to is present)", () => {
    expect(noncePolicy("n", { https: false })).not.toContain("report-to");
    const res = page("http://localhost/jobs", { headers: { "x-forwarded-proto": "https" } });
    expect(res.headers.get("Content-Security-Policy-Report-Only")).toContain("report-to csp-endpoint");
    expect(res.headers.get("Reporting-Endpoints")).toBe('csp-endpoint="/api/csp-report"');
  });

  it("upgrade-insecure-requests only behind HTTPS", () => {
    expect(noncePolicy("n", { https: true })).toContain("upgrade-insecure-requests");
    expect(noncePolicy("n", { https: false })).not.toContain("upgrade-insecure-requests");
    expect(page("http://localhost/jobs", { headers: { "x-forwarded-proto": "https" } }).headers.get("Content-Security-Policy-Report-Only")).toContain("upgrade-insecure-requests");
  });
});

describe("regression check (E3 step 9)", () => {
  it("the nonce policy's script-src never allows inline scripts or eval", () => {
    for (const mode of ["report-only", "enforce"]) {
      process.env.CSP_MODE = mode;
      const res = page();
      const policy = res.headers.get(mode === "enforce" ? "Content-Security-Policy" : "Content-Security-Policy-Report-Only")!;
      const src = scriptSrc(policy);
      expect(src).toMatch(/'nonce-[A-Za-z0-9+/=]{24}'/);
      expect(src).toContain("'strict-dynamic'");
      expect(src).not.toContain("'unsafe-inline'");
      expect(src).not.toContain("'unsafe-eval'"); // NODE_ENV is "test", as in production builds: no eval
    }
  });

  it("the nonce policy keeps the other hardening directives", () => {
    const p = noncePolicy("n", { https: true });
    for (const d of ["default-src 'self'", "object-src 'none'", "base-uri 'none'", "frame-ancestors 'none'", "form-action 'self'"]) {
      expect(p).toContain(d);
    }
  });

  it("the pages contain no inline script code", () => {
    const root = path.resolve(__dirname, "..");
    const files = (function walk(dir: string): string[] {
      return readdirSync(dir).flatMap((n) => {
        const f = path.join(dir, n);
        return statSync(f).isDirectory() ? walk(f) : /\.(tsx|ts)$/.test(n) && !/\.test\.ts$/.test(n) ? [f] : [];
      });
    })(root);
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, "utf-8");
      const rel = path.relative(root, f);
      if (/<script[\s>]/.test(src)) offenders.push(`${rel}: raw <script>`);
      if (/dangerouslySetInnerHTML/.test(src)) offenders.push(`${rel}: dangerouslySetInnerHTML`);
      if (/<Script\b[^>]*[^/>]>\s*\{?\s*[`'"]/.test(src)) offenders.push(`${rel}: inline <Script> body`);
      if (/["'`]javascript:/i.test(src)) offenders.push(`${rel}: javascript: URL`);
      if (/\son[a-z]+="/.test(src)) offenders.push(`${rel}: string event handler`);
    }
    expect(offenders, "move inline code to an external file (docs/security/csp.md)").toEqual([]);
  });
});

describe("report endpoint", () => {
  const post = (body: string, type = "application/csp-report") =>
    cspReport(new NextRequest("http://localhost/api/csp-report", { method: "POST", headers: { "content-type": type }, body }));

  it("logs both report formats, keeping only clipped fields and no query strings", async () => {
    const lines: Record<string, unknown>[] = [];
    setLogSink((l) => lines.push(JSON.parse(l)));
    try {
      const legacy = { "csp-report": { "document-uri": "http://localhost/admin?token=secret", "violated-directive": "script-src-elem", "blocked-uri": "inline", "line-number": 3, cookie: "x" } };
      expect((await post(JSON.stringify(legacy))).status).toBe(204);
      const modern = [{ type: "csp-violation", body: { documentURL: "http://localhost/jobs#x", effectiveDirective: "script-src", blockedURL: "https://evil.example/a.js?k=v" } }];
      expect((await post(JSON.stringify(modern), "application/reports+json")).status).toBe(204);
    } finally {
      setLogSink(null);
    }
    const v = lines.filter((l) => l.event === "csp.violation");
    expect(v).toHaveLength(2);
    expect(v[0]).toMatchObject({ page: "http://localhost/admin", directive: "script-src-elem", blocked: "inline", line: 3 });
    expect(v[1]).toMatchObject({ page: "http://localhost/jobs", blocked: "https://evil.example/a.js" });
    expect(JSON.stringify(v)).not.toMatch(/secret|k=v|cookie/);
  });

  it("ignores junk and oversized bodies without an error", async () => {
    expect((await post("not json")).status).toBe(204);
    expect((await post("x".repeat(20_000))).status).toBe(204);
    expect((await post(JSON.stringify({ hello: 1 }))).status).toBe(204);
  });
});
