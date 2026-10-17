import { describe, it, expect } from "vitest";
import { describeApiError } from "./apiError";
import { updatePartnerCandidateDetailsSchema } from "./validations";

describe("partner submission edit validation", () => {
  // Regression: partner submissions since 2026-08-15 have no email at all;
  // the edit page echoes that back as null, and every "Save Changes" on
  // such a submission failed with a bare "Validation failed".
  it("accepts a missing (null or empty) email and leaves it unchanged", () => {
    for (const email of [null, "", undefined]) {
      const parsed = updatePartnerCandidateDetailsSchema.safeParse({ email, available_for_embassy_appointment: true });
      expect(parsed.success).toBe(true);
      expect(parsed.data?.email).toBeUndefined();
    }
  });

  it("still rejects a malformed email", () => {
    expect(updatePartnerCandidateDetailsSchema.safeParse({ email: "not-an-email" }).success).toBe(false);
  });
});

describe("describeApiError", () => {
  it("names each invalid field in plain words", () => {
    const body = {
      error: {
        message: "Validation failed",
        details: { email: ["Invalid email address"], passport_number: ["Too small: expected string to have >=3 characters"] },
      },
    };
    expect(describeApiError(body, "Failed")).toBe(
      "Couldn't save — please check: Email (not a valid email address), Passport Number (too short)."
    );
  });

  it("falls back to the message, then the fallback", () => {
    expect(describeApiError({ error: { message: "Submission not found." } }, "Failed")).toBe("Submission not found.");
    expect(describeApiError({}, "Failed")).toBe("Failed");
    expect(describeApiError(null, "Failed")).toBe("Failed");
  });
});
