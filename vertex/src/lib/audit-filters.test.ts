import { describe, expect, it } from "vitest";
import { auditFilters } from "./audit";

describe("auditFilters", () => {
  it("keeps allowlisted filter values", () => {
    expect(auditFilters(new URLSearchParams("start=2026-01-01&end=2026-02-01&country=Testland"))).toEqual({
      start: "2026-01-01", end: "2026-02-01", country: "Testland",
    });
  });

  it("redacts anything else, which could hold personal data", () => {
    expect(auditFilters(new URLSearchParams("q=jane.doe@example.com&name=Jane&start=2026-01-01"))).toEqual({
      q: "[redacted]", name: "[redacted]", start: "2026-01-01",
    });
  });

  it("caps value length", () => {
    expect(auditFilters(new URLSearchParams(`status=${"x".repeat(500)}`)).status).toHaveLength(100);
  });
});
