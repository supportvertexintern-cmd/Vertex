import { describe, it, expect } from "vitest";
import { canAccessPortal, homeFor, isStaffRole, PORTAL_ACCESS } from "./rbac";
import type { Role } from "@prisma/client";

const ALL_ROLES: Role[] = [
  "candidate",
  "regional_recruiter",
  "country_supervisor",
  "inhouse_supervisor",
  "director",
  "admin",
  "marketing",
  "partner",
  "hr",
  "operations_team",
  "operations_director",
  "finance",
];

describe("canAccessPortal", () => {
  it("allows a candidate into /dashboard but nowhere else staff-gated", () => {
    expect(canAccessPortal("candidate", "/dashboard")).toBe(true);
    expect(canAccessPortal("candidate", "/admin")).toBe(false);
    expect(canAccessPortal("candidate", "/recruiter")).toBe(false);
    expect(canAccessPortal("candidate", "/supervisor")).toBe(false);
    expect(canAccessPortal("candidate", "/management")).toBe(false);
  });

  it("allows a regional_recruiter into /recruiter only (plus admin override)", () => {
    expect(canAccessPortal("regional_recruiter", "/recruiter")).toBe(true);
    expect(canAccessPortal("regional_recruiter", "/supervisor")).toBe(false);
    expect(canAccessPortal("regional_recruiter", "/management")).toBe(false);
    expect(canAccessPortal("regional_recruiter", "/admin")).toBe(false);
    expect(canAccessPortal("regional_recruiter", "/dashboard")).toBe(false);
  });

  it("allows a country_supervisor into /supervisor only", () => {
    expect(canAccessPortal("country_supervisor", "/supervisor")).toBe(true);
    expect(canAccessPortal("country_supervisor", "/recruiter")).toBe(false);
    expect(canAccessPortal("country_supervisor", "/management")).toBe(false);
  });

  it("allows director into /management, and inhouse_supervisor into its own /inhouse portal instead", () => {
    // inhouse_supervisor got its own dedicated /inhouse portal (Phase 3) —
    // /management stays director + admin only.
    expect(canAccessPortal("director", "/management")).toBe(true);
    expect(canAccessPortal("inhouse_supervisor", "/management")).toBe(false);
    expect(canAccessPortal("inhouse_supervisor", "/inhouse")).toBe(true);
    expect(canAccessPortal("inhouse_supervisor", "/admin")).toBe(false);
  });

  it("gives admin access to every staff portal, but not the candidate's own /dashboard", () => {
    // /dashboard is a candidate's personal profile view — an admin account
    // has no Candidate record to show there, so it's deliberately excluded.
    for (const prefix of Object.keys(PORTAL_ACCESS).filter((p) => p !== "/dashboard")) {
      expect(canAccessPortal("admin", prefix)).toBe(true);
    }
    expect(canAccessPortal("admin", "/dashboard")).toBe(false);
  });

  it("allows hr into /hr only (plus admin override)", () => {
    expect(canAccessPortal("hr", "/hr")).toBe(true);
    expect(canAccessPortal("hr", "/operations")).toBe(false);
    expect(canAccessPortal("hr", "/finance")).toBe(false);
    expect(canAccessPortal("hr", "/management")).toBe(false);
  });

  it("allows operations_team and operations_director into /operations only", () => {
    expect(canAccessPortal("operations_team", "/operations")).toBe(true);
    expect(canAccessPortal("operations_director", "/operations")).toBe(true);
    expect(canAccessPortal("operations_team", "/hr")).toBe(false);
    expect(canAccessPortal("operations_team", "/finance")).toBe(false);
  });

  it("allows finance into /finance only", () => {
    expect(canAccessPortal("finance", "/finance")).toBe(true);
    expect(canAccessPortal("finance", "/hr")).toBe(false);
    expect(canAccessPortal("finance", "/operations")).toBe(false);
  });

  it("does not restrict paths that aren't portal-gated", () => {
    expect(canAccessPortal("candidate", "/jobs")).toBe(true);
    expect(canAccessPortal("regional_recruiter", "/about")).toBe(true);
  });

  it("matches by prefix, not exact path", () => {
    expect(canAccessPortal("regional_recruiter", "/recruiter/candidates/123")).toBe(true);
    expect(canAccessPortal("candidate", "/admin/settings")).toBe(false);
  });
});

describe("homeFor", () => {
  it("maps every role to a distinct, sensible home", () => {
    for (const role of ALL_ROLES) {
      const home = homeFor(role);
      expect(home).toMatch(/^\//);
      expect(canAccessPortal(role, home)).toBe(true);
    }
  });
});

describe("isStaffRole", () => {
  // marketing/partner/hr/operations_team/operations_director/finance are
  // all deliberately kept out of the 3-tier recruiter/supervisor/inhouse
  // hierarchy STAFF_ROLES represents — each has its own distinct portal
  // and API access instead (see rbac.ts's own comments).
  const NON_STAFF_ROLES: Role[] = ["candidate", "marketing", "partner", "hr", "operations_team", "operations_director", "finance"];

  it("only the 3-tier operational hierarchy plus director/admin count as staff", () => {
    for (const role of NON_STAFF_ROLES) {
      expect(isStaffRole(role)).toBe(false);
    }
    for (const role of ALL_ROLES.filter((r) => !NON_STAFF_ROLES.includes(r))) {
      expect(isStaffRole(role)).toBe(true);
    }
  });
});
