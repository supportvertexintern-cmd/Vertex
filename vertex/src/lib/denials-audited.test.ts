// G7 (Phase 10): an access denial must be recorded. API handlers deny with
// forbidden() or requireRole(), which audit it; a bare 403 response would
// leave no trace. The only bare 403s allowed are business rules, listed
// here by their message, which aren't access decisions.
import { readdirSync, readFileSync, statSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

const API_ROOT = path.resolve(__dirname, "../app/api");

const BUSINESS_RULE_403 = [
  "Please verify your email before logging in.",
  "Milestone payments are not enabled for this destination.",
  "Stripe payment links are only available for self-applicants.",
  'check.reason ?? "Transition not allowed."',
  "AI Assistant is currently offline.",
  "err.message }, { status: 403 })", // documents/file: malware block, audited as malware_blocked_download
];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? files(full) : name.endsWith(".ts") ? [full] : [];
  });
}

describe("access denials are audited (G7)", () => {
  it("no API handler returns a bare 403 for an access decision", () => {
    const bare: string[] = [];
    for (const file of files(API_ROOT)) {
      const src = readFileSync(file, "utf8");
      // Each 403 with the 300 characters before it (the response body).
      for (const m of src.matchAll(/status:\s*403/g)) {
        const context = src.slice(Math.max(0, m.index! - 300), m.index! + 20);
        if (!BUSINESS_RULE_403.some((allowed) => context.includes(allowed))) {
          bare.push(`${path.relative(API_ROOT, file)}: ${context.slice(-140).replace(/\s+/g, " ")}`);
        }
      }
    }
    expect(bare).toEqual([]);
  });

  it("forbidden() is in use (the check above isn't vacuous)", () => {
    const uses = files(API_ROOT).reduce((n, f) => n + (readFileSync(f, "utf8").match(/\bforbidden\(/g)?.length ?? 0), 0);
    expect(uses).toBeGreaterThan(50);
  });
});
