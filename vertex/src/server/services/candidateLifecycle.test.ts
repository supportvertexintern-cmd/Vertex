import { describe, it, expect } from "vitest";
import { canSetLifecycleStatus } from "./candidateLifecycle";

describe("canSetLifecycleStatus", () => {
  describe("regional_recruiter", () => {
    it("can advance forward up to reported, except the two system-only stages", () => {
      expect(canSetLifecycleStatus("regional_recruiter", "identified", "screened").allowed).toBe(true);
      expect(canSetLifecycleStatus("regional_recruiter", "submitted", "reported").allowed).toBe(true);
    });

    it("cannot verify or approve", () => {
      const result = canSetLifecycleStatus("regional_recruiter", "reported", "verified");
      expect(result.allowed).toBe(false);
      expect(result.reason).toMatch(/only a supervisor/i);
    });

    it("cannot move a candidate backward", () => {
      const result = canSetLifecycleStatus("regional_recruiter", "guided_to_apply", "screened");
      expect(result.allowed).toBe(false);
      expect(result.isReturn).toBe(true);
    });

    it("cannot manually mark a candidate guided_to_apply — that only happens once the candidate claims their invite and creates an account", () => {
      const result = canSetLifecycleStatus("regional_recruiter", "screened", "guided_to_apply");
      expect(result.allowed).toBe(false);
      expect(result.reason).toMatch(/claims their emailed invite/i);
    });

    it("cannot manually mark a candidate submitted — that only happens once required documents are uploaded", () => {
      const result = canSetLifecycleStatus("regional_recruiter", "guided_to_apply", "submitted");
      expect(result.allowed).toBe(false);
      expect(result.reason).toMatch(/documents are uploaded/i);
    });
  });

  describe("country_supervisor", () => {
    it("cannot act before a candidate has been reported", () => {
      const result = canSetLifecycleStatus("country_supervisor", "screened", "guided_to_apply");
      expect(result.allowed).toBe(false);
      expect(result.reason).toMatch(/must be reported/i);
    });

    it("can verify once reported", () => {
      expect(canSetLifecycleStatus("country_supervisor", "reported", "verified").allowed).toBe(true);
    });

    it("cannot approve — that's In-House's controlling position (Regional Supervisory Operational Workflow, Candidate Status Lifecycle stage 7)", () => {
      const result = canSetLifecycleStatus("country_supervisor", "verified", "approved");
      expect(result.allowed).toBe(false);
      expect(result.reason).toMatch(/only in-house/i);
    });

    it("cannot touch a candidate that's already approved, including reversing the approval", () => {
      const result = canSetLifecycleStatus("country_supervisor", "approved", "verified");
      expect(result.allowed).toBe(false);
      expect(result.reason).toMatch(/only in-house/i);
    });

    it("can return a candidate to an earlier stage (marked isReturn)", () => {
      const result = canSetLifecycleStatus("country_supervisor", "reported", "screened");
      expect(result.allowed).toBe(true);
      expect(result.isReturn).toBe(true);
    });
  });

  describe("inhouse_supervisor and director", () => {
    it("can verify, same as country_supervisor", () => {
      expect(canSetLifecycleStatus("inhouse_supervisor", "reported", "verified").allowed).toBe(true);
      expect(canSetLifecycleStatus("director", "reported", "verified").allowed).toBe(true);
    });

    it("can also approve, unlike country_supervisor", () => {
      expect(canSetLifecycleStatus("inhouse_supervisor", "verified", "approved").allowed).toBe(true);
      expect(canSetLifecycleStatus("director", "verified", "approved").allowed).toBe(true);
    });

    it("can reverse an approval", () => {
      const result = canSetLifecycleStatus("inhouse_supervisor", "approved", "verified");
      expect(result.allowed).toBe(true);
      expect(result.isReturn).toBe(true);
    });
  });

  describe("admin", () => {
    it("is unrestricted in either direction", () => {
      expect(canSetLifecycleStatus("admin", "identified", "approved").allowed).toBe(true);
      expect(canSetLifecycleStatus("admin", "approved", "identified").allowed).toBe(true);
    });
  });

  describe("candidate", () => {
    it("cannot update their own lifecycle status", () => {
      expect(canSetLifecycleStatus("candidate", "identified", "screened").allowed).toBe(false);
    });
  });

  describe("hr (2026-07-31, HR-owned self-submission routing)", () => {
    it("can approve a self-registered candidate for account creation", () => {
      expect(canSetLifecycleStatus("hr", "identified", "screened", "self_registered").allowed).toBe(true);
    });

    it("can approve a self-registered candidate once submitted, skipping reported/verified", () => {
      expect(canSetLifecycleStatus("hr", "submitted", "approved", "self_registered").allowed).toBe(true);
    });

    it("cannot touch a recruiter-sourced or partner-sourced candidate", () => {
      expect(canSetLifecycleStatus("hr", "identified", "screened", "recruiter_sourced").allowed).toBe(false);
      expect(canSetLifecycleStatus("hr", "identified", "screened", "partner_sourced").allowed).toBe(false);
    });

    it("cannot touch a self-registered candidate with no source provided at all", () => {
      expect(canSetLifecycleStatus("hr", "identified", "screened").allowed).toBe(false);
    });

    it("cannot make any other transition, even forward-only ones", () => {
      expect(canSetLifecycleStatus("hr", "screened", "guided_to_apply", "self_registered").allowed).toBe(false);
      expect(canSetLifecycleStatus("hr", "reported", "verified", "self_registered").allowed).toBe(false);
      expect(canSetLifecycleStatus("hr", "identified", "approved", "self_registered").allowed).toBe(false);
    });

    it("cannot return a candidate backward", () => {
      expect(canSetLifecycleStatus("hr", "screened", "identified", "self_registered").allowed).toBe(false);
    });
  });

  it("rejects a no-op transition to the same status", () => {
    const result = canSetLifecycleStatus("admin", "screened", "screened");
    expect(result.allowed).toBe(false);
  });
});
