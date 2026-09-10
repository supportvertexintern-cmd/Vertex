import { describe, it, expect } from "vitest";
import { evaluateScreeningGate } from "./screening";

function farFuturePassportExpiry() {
  const d = new Date();
  d.setFullYear(d.getFullYear() + 2);
  return d;
}

function baseCandidate() {
  return {
    full_name: "Jane Doe",
    nationality: "Kenyan",
    date_of_birth: new Date("1995-01-01"),
    passport_number: "P12345678",
    passport_expiry: farFuturePassportExpiry(),
    phone: "+254700000000",
    email: "jane@example.com",
    consent_given: true,
    user: null,
    applications: [
      { job_id: null, preferred_country_1_id: "country-1", preferred_sector_id: "sector-1", earliest_travel_date: new Date() },
    ],
  };
}

describe("evaluateScreeningGate", () => {
  it("passes a fully complete candidate", () => {
    const result = evaluateScreeningGate(baseCandidate());
    expect(result.passed).toBe(true);
    expect(result.failures).toHaveLength(0);
  });

  it("prefers the linked User's identity over the candidate's own fields", () => {
    const candidate = {
      ...baseCandidate(),
      full_name: null,
      phone: null,
      email: null,
      user: { full_name: "Linked User", email: "linked@example.com", phone: "+254711111111" },
    };
    const result = evaluateScreeningGate(candidate);
    expect(result.passed).toBe(true);
  });

  it("fails when nationality is missing", () => {
    const result = evaluateScreeningGate({ ...baseCandidate(), nationality: null });
    expect(result.passed).toBe(false);
    expect(result.failures).toContain("Nationality is missing.");
  });

  it("fails when phone is missing, even with an email on file", () => {
    const result = evaluateScreeningGate({ ...baseCandidate(), phone: null });
    expect(result.passed).toBe(false);
    expect(result.failures).toContain("Phone number is missing.");
  });

  it("fails when email is missing, even with a phone on file — an invite link can't be sent without one", () => {
    const result = evaluateScreeningGate({ ...baseCandidate(), email: null });
    expect(result.passed).toBe(false);
    expect(result.failures).toContain("Email address is missing.");
  });

  it("fails a candidate under the minimum age", () => {
    const tenYearsAgo = new Date();
    tenYearsAgo.setFullYear(tenYearsAgo.getFullYear() - 10);
    const result = evaluateScreeningGate({ ...baseCandidate(), date_of_birth: tenYearsAgo });
    expect(result.passed).toBe(false);
    expect(result.failures.some((f) => f.includes("minimum eligible age"))).toBe(true);
  });

  it("fails when passport expiry is missing", () => {
    const result = evaluateScreeningGate({ ...baseCandidate(), passport_expiry: null });
    expect(result.passed).toBe(false);
    expect(result.failures).toContain("Passport expiry date is missing.");
  });

  it("fails when passport has less than 6 months' validity", () => {
    const soon = new Date();
    soon.setMonth(soon.getMonth() + 2);
    const result = evaluateScreeningGate({ ...baseCandidate(), passport_expiry: soon });
    expect(result.passed).toBe(false);
    expect(result.failures.some((f) => f.includes("6 months"))).toBe(true);
  });

  it("fails when no Candidate Information Form submission is on file", () => {
    const result = evaluateScreeningGate({ ...baseCandidate(), applications: [] });
    expect(result.passed).toBe(false);
    expect(result.failures).toContain("No Candidate Information Form submission on file.");
  });

  it("fails when the submission is missing a preferred country", () => {
    const result = evaluateScreeningGate({
      ...baseCandidate(),
      applications: [{ job_id: null, preferred_country_1_id: null, preferred_sector_id: "sector-1", earliest_travel_date: new Date() }],
    });
    expect(result.passed).toBe(false);
    expect(result.failures).toContain("Preferred programme country is missing.");
  });

  it("passes on a job-linked application (2026-07-31 Section 1 job picker) even with no preferred_country_1_id/preferred_sector_id at all", () => {
    const result = evaluateScreeningGate({
      ...baseCandidate(),
      applications: [{ job_id: "job-1", preferred_country_1_id: null, preferred_sector_id: null, earliest_travel_date: new Date() }],
    });
    expect(result.passed).toBe(true);
  });

  it("still requires an earliest travel date even on a job-linked application", () => {
    const result = evaluateScreeningGate({
      ...baseCandidate(),
      applications: [{ job_id: "job-1", preferred_country_1_id: null, preferred_sector_id: null, earliest_travel_date: null }],
    });
    expect(result.passed).toBe(false);
    expect(result.failures).toContain("Earliest possible travel date is missing.");
  });

  it("fails when consent has not been given", () => {
    const result = evaluateScreeningGate({ ...baseCandidate(), consent_given: false });
    expect(result.passed).toBe(false);
    expect(result.failures).toContain("Candidate consent has not been recorded.");
  });

  it("accumulates multiple failures at once, not just the first", () => {
    const result = evaluateScreeningGate({
      ...baseCandidate(),
      nationality: null,
      consent_given: false,
      applications: [],
    });
    expect(result.failures.length).toBeGreaterThanOrEqual(3);
  });
});
