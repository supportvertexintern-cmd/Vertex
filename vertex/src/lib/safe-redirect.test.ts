import { describe, expect, it } from "vitest";
import { safeRedirectPath } from "./safe-redirect";

describe("safeRedirectPath", () => {
  it.each(["/dashboard", "/recruiter/cases?id=1", "/jobs/abc#apply", "%2Fadmin%2Fusers"])("keeps same-site path %s", (v) => {
    expect(safeRedirectPath(v)).toBe(decodeURIComponent(v));
  });

  it.each([
    "https://evil.com",
    "//evil.com",
    "/\\evil.com",
    "@evil.com",
    ".evil.com",
    "evil.com",
    "%2F%2Fevil.com",
    "/%0a/evil.com",
    "javascript:alert(1)",
    "%E0%A4%A",
    "",
    null,
    undefined,
  ])("rejects %s", (v) => {
    expect(safeRedirectPath(v as string | null | undefined)).toBe("/dashboard");
  });
});
