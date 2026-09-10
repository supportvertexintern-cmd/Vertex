import { describe, it, expect } from "vitest";
import { nextEscalationLevel, roleCanActOnLevel, ESCALATION_LEVEL_ORDER } from "./exceptionWorkflow";

describe("nextEscalationLevel", () => {
  it("advances one tier at a time", () => {
    expect(nextEscalationLevel("regional")).toBe("country");
    expect(nextEscalationLevel("country")).toBe("inhouse");
    expect(nextEscalationLevel("inhouse")).toBe("management");
  });

  it("stays at management once at the top of the line", () => {
    expect(nextEscalationLevel("management")).toBe("management");
  });

  it("covers every level in ESCALATION_LEVEL_ORDER", () => {
    expect(ESCALATION_LEVEL_ORDER).toEqual(["regional", "country", "inhouse", "management"]);
  });
});

describe("roleCanActOnLevel", () => {
  it("admin can act at any level", () => {
    expect(roleCanActOnLevel("admin", "regional")).toBe(true);
    expect(roleCanActOnLevel("admin", "management")).toBe(true);
  });

  it("a country_supervisor can act on country-tier and above, not below", () => {
    expect(roleCanActOnLevel("country_supervisor", "country")).toBe(true);
    expect(roleCanActOnLevel("country_supervisor", "inhouse")).toBe(true);
    expect(roleCanActOnLevel("country_supervisor", "regional")).toBe(false);
  });

  it("an inhouse_supervisor can act on inhouse-tier and above, not below", () => {
    expect(roleCanActOnLevel("inhouse_supervisor", "inhouse")).toBe(true);
    expect(roleCanActOnLevel("inhouse_supervisor", "management")).toBe(true);
    expect(roleCanActOnLevel("inhouse_supervisor", "country")).toBe(false);
    expect(roleCanActOnLevel("inhouse_supervisor", "regional")).toBe(false);
  });

  it("a director can only act at the management tier", () => {
    expect(roleCanActOnLevel("director", "management")).toBe(true);
    expect(roleCanActOnLevel("director", "inhouse")).toBe(false);
  });

  it("a regional_recruiter (and any role with no configured floor) can never act", () => {
    expect(roleCanActOnLevel("regional_recruiter", "regional")).toBe(false);
    expect(roleCanActOnLevel("candidate", "regional")).toBe(false);
  });
});
