// Deny-by-default coverage (docs/security/zero-trust.md §3, baseline gap G6):
// every API handler must check its caller or be a registered public endpoint.
// This is the test that would have caught G1 and G2 (admin GETs with no auth).

import { readdirSync, readFileSync, statSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { PUBLIC_ENDPOINTS } from "./public-endpoints";

const API_ROOT = path.resolve(__dirname, "../app/api");
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

// A handler counts as guarded if it calls one of the shared guards, or
// rejects a missing user itself with a 401.
const GUARD = /requireRole\(|requireAdmin\(|requireAuth\(|if\s*\(\s*!user\b[^)]*\)[\s\S]{0,200}?status:\s*40[13]/;
const RATE_LIMIT = /limitByIp\(|rateLimit\(/;
const SIGNED_TOKEN = /verify\w*Token\(|resolveDocumentContent\(/;
// Checked here, or passed on for FastAPI to check (the Stripe webhook since
// payments step 7.2; vertex_be/tests/test_payments.py covers that side).
const SIGNATURE = /constructEvent\(|forward:\s*\{\s*"Stripe-Signature":/;
// A refresh token is spent by FastAPI since users step 8.2: the handler passes
// it on, directly (the app's) or through the file's refresh() (the browser's).
const REFRESH_TOKEN = /"\/api\/v1\/auth\/refresh"|\brefresh\(req\)/;

interface Handler {
  key: string; // "GET /api/jobs/[id]"
  body: string;
}

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return routeFiles(full);
    return name === "route.ts" ? [full] : [];
  });
}

function handlers(): Handler[] {
  return routeFiles(API_ROOT).flatMap((file) => {
    const src = readFileSync(file, "utf-8");
    const route = "/api/" + path.relative(API_ROOT, path.dirname(file)).split(path.sep).join("/");
    const parts = src.split(/(?=export\s+(?:async\s+)?function\s+(?:GET|POST|PUT|PATCH|DELETE)\b)/);
    return parts.slice(1).map((body) => {
      const method = body.match(/function\s+(\w+)/)![1];
      return { key: `${method} ${route}`, body };
    });
  });
}

const all = handlers();

describe("API route guards", () => {
  it("finds the API handlers", () => {
    expect(all.length).toBeGreaterThan(100);
    for (const h of all) expect(METHODS).toContain(h.key.split(" ")[0]);
  });

  it("every handler checks its caller or is a registered public endpoint", () => {
    const unguarded = all.filter((h) => !GUARD.test(h.body) && !(h.key in PUBLIC_ENDPOINTS)).map((h) => h.key);
    expect(unguarded, "add a guard, or register the endpoint in src/lib/public-endpoints.ts").toEqual([]);
  });

  it("the public register has no stale entries", () => {
    const keys = new Set(all.map((h) => h.key));
    expect(Object.keys(PUBLIC_ENDPOINTS).filter((k) => !keys.has(k))).toEqual([]);
  });

  it("each public endpoint has the protection the register claims", () => {
    const missing: string[] = [];
    for (const h of all) {
      const entry = PUBLIC_ENDPOINTS[h.key];
      if (!entry) continue;
      if (entry.protection.includes("rate-limit") && !RATE_LIMIT.test(h.body)) missing.push(`${h.key}: rate-limit`);
      if (entry.protection.includes("signed-token") && !SIGNED_TOKEN.test(h.body)) missing.push(`${h.key}: signed-token`);
      if (entry.protection.includes("signature") && !SIGNATURE.test(h.body)) missing.push(`${h.key}: signature`);
      if (entry.protection.includes("refresh-token") && !REFRESH_TOKEN.test(h.body)) missing.push(`${h.key}: refresh-token`);
    }
    expect(missing).toEqual([]);
  });

  // Zero-trust §9 / 5.5: bulk reads of personal data must leave an audit trail.
  it("bulk exports and backups are audited", () => {
    // Reviewed exceptions: no row data leaves these handlers.
    const NO_ROW_DATA: Record<string, string> = {
      "GET /api/backup/catalog": "describes tables and columns from the Prisma schema; returns no records",
    };
    const unaudited = all
      .filter((h) => /\/(export|backup)(\/|$)/.test(h.key))
      .filter((h) => !(h.key in NO_ROW_DATA))
      .filter((h) => !/auditAccess\(/.test(h.body))
      .map((h) => h.key);
    expect(unaudited, "call auditAccess() before returning exported data").toEqual([]);
  });

  // Authorization pipeline (docs/security/authorization-pipeline.md): no data
  // access or side effect before the caller is checked. Exceptions are
  // stage-1 request validation only, each named here.
  it("guarded handlers check the caller before touching data", () => {
    const DATA = /\bprisma\.|auditedPrisma\(|\$transaction\(|send\w*Email\(|getSignedDocumentUrl\(|saveUploadedFile\(|stripe\.|fetch\(/;
    const VALIDATION_LOOKUPS: Record<string, string> = {
      "POST /api/upload": "validates the `type` parameter against DocumentRequirementType (reference data)",
    };
    const early = all
      .filter((h) => !(h.key in PUBLIC_ENDPOINTS) && !(h.key in VALIDATION_LOOKUPS))
      .filter((h) => {
        const guard = h.body.search(GUARD);
        const data = h.body.search(DATA);
        return guard >= 0 && data >= 0 && data < guard;
      })
      .map((h) => h.key);
    expect(early, "authenticate and authorize before reading or changing data").toEqual([]);
  });

  it("admin endpoints are never public", () => {
    expect(Object.keys(PUBLIC_ENDPOINTS).filter((k) => k.includes("/api/admin/"))).toEqual([]);
  });
});
