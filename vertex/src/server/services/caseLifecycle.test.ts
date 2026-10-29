import { describe, it, expect } from "vitest";
import { CASE_STAGE_ORDER } from "./caseLifecycle";

describe("CASE_STAGE_ORDER", () => {
  it("has all 11 stages from the Operational Workflow SOP", () => {
    expect(CASE_STAGE_ORDER).toHaveLength(11);
    expect(CASE_STAGE_ORDER[0]).toBe("registration_document_submission");
    expect(CASE_STAGE_ORDER[CASE_STAGE_ORDER.length - 1]).toBe("departure_arrival_support");
  });
});
