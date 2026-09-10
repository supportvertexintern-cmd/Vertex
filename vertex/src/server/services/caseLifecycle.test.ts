import { describe, it, expect } from "vitest";
import { canSetCaseStage, CASE_STAGE_ORDER } from "./caseLifecycle";

describe("CASE_STAGE_ORDER", () => {
  it("has all 11 stages from the Operational Workflow SOP", () => {
    expect(CASE_STAGE_ORDER).toHaveLength(11);
    expect(CASE_STAGE_ORDER[0]).toBe("registration_document_submission");
    expect(CASE_STAGE_ORDER[CASE_STAGE_ORDER.length - 1]).toBe("departure_arrival_support");
  });
});

describe("canSetCaseStage", () => {
  // Case-stage ownership belongs to Operations (2026-07-31, per the SOP's
  // separation of duties) — recruiter and both supervisor tiers keep
  // read-only visibility only; Director/Admin retain full override.
  it("a recruiter cannot move a case at all", () => {
    expect(canSetCaseStage("regional_recruiter", "registration_document_submission", "document_preparation_legalization").allowed).toBe(false);
    expect(canSetCaseStage("regional_recruiter", "permit_application_submission", "document_preparation_legalization").allowed).toBe(false);
  });

  it("a country_supervisor cannot move a case at all", () => {
    expect(canSetCaseStage("country_supervisor", "permit_processing_followup", "document_preparation_legalization").allowed).toBe(false);
  });

  it("an inhouse_supervisor cannot move a case at all", () => {
    expect(canSetCaseStage("inhouse_supervisor", "partner_receives_permit", "visa_interview_preparation").allowed).toBe(false);
  });

  it("an hr or finance role cannot move a case", () => {
    expect(canSetCaseStage("hr", "registration_document_submission", "document_preparation_legalization").allowed).toBe(false);
    expect(canSetCaseStage("finance", "registration_document_submission", "document_preparation_legalization").allowed).toBe(false);
  });

  it("operations_team can move a case in either direction", () => {
    expect(canSetCaseStage("operations_team", "document_preparation_legalization", "permit_application_submission").allowed).toBe(true);
    expect(canSetCaseStage("operations_team", "permit_application_submission", "document_preparation_legalization").allowed).toBe(true);
  });

  it("operations_director can move a case in either direction", () => {
    expect(canSetCaseStage("operations_director", "document_preparation_legalization", "permit_application_submission").allowed).toBe(true);
    expect(canSetCaseStage("operations_director", "permit_application_submission", "document_preparation_legalization").allowed).toBe(true);
  });

  it("director can move a case in either direction", () => {
    expect(canSetCaseStage("director", "document_preparation_legalization", "permit_application_submission").allowed).toBe(true);
    expect(canSetCaseStage("director", "permit_application_submission", "document_preparation_legalization").allowed).toBe(true);
  });

  it("admin can move a case in either direction", () => {
    expect(canSetCaseStage("admin", "document_preparation_legalization", "permit_application_submission").allowed).toBe(true);
    expect(canSetCaseStage("admin", "permit_application_submission", "document_preparation_legalization").allowed).toBe(true);
  });

  it("rejects setting a case to its current stage", () => {
    const check = canSetCaseStage("admin", "document_preparation_legalization", "document_preparation_legalization");
    expect(check.allowed).toBe(false);
  });

  it("a candidate cannot move their own case", () => {
    const check = canSetCaseStage("candidate", "registration_document_submission", "document_preparation_legalization");
    expect(check.allowed).toBe(false);
  });
});
