import { test, expect, type Page } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("vertex_welcome_accepted", "true");
  });
});

async function login(page: Page, email: string, password: string) {
  await page.goto("/auth/login");
  await page.fill("#login-email", email);
  await page.fill("#login-password", password);
  await page.click("#login-submit-btn");
  await page.waitForURL((url) => !url.pathname.startsWith("/auth/login"), { timeout: 25_000 });
}

async function logout(page: Page) {
  await page.getByText("Log out").click();
  await page.waitForURL((url) => url.pathname.startsWith("/auth/login") || url.pathname === "/", { timeout: 25_000 });
}

const PASSWORD = "E2ETestPassword123!";

// Phase 4's mobility lifecycle (SRS FR-4.1–4.3): a candidate being
// "Approved by In-House" (the real, framework-defined trigger — Regional
// Supervisory Operational Workflow p.5 — not the legacy Application
// status field) auto-opens a Case, staff can advance its stage and issue
// a contract, and the candidate signs it themselves — the riskiest, most
// novel piece (a real in-house e-signature, not a stub) gets the
// end-to-end check.
test.describe("Mobility case lifecycle (Phase 4)", () => {
  test("approval opens a case, staff advance it and issue a contract, candidate signs it", async ({ page }) => {
    await test.step("In-House approves the already-verified candidate, which auto-creates a case", async () => {
      await login(page, "e2e-inhouse@test.local", PASSWORD);
      await expect(page).toHaveURL(/\/inhouse$/);

      // In-House's own portal (split from /management since this session's
      // In-House Supervisor portal work) links a candidate row out to its
      // dedicated detail page rather than showing inline actions.
      await page.getByRole("link", { name: "Candidates", exact: true }).click();
      await page.waitForURL(/\/inhouse\/candidates$/);
      await page.getByRole("link", { name: "E2E Case Candidate" }).click();
      await page.waitForURL(/\/inhouse\/candidates\/.+/);

      // Approving is labelled "Create Case" now, and the approved status
      // displays as "Case Created" (CandidateStatusControls STATUS_LABELS).
      await page.getByRole("button", { name: "Create Case", exact: true }).click();
      await expect(page.getByText("Case Created", { exact: true }).first()).toBeVisible({ timeout: 25_000 });
    });

    await test.step("the case appears in Operations' case list at its opening stage", async () => {
      // Case-stage/contract ownership moved to Operations (2026-07-31, per
      // the Operational Workflow SOP's separation of duties) — In-House no
      // longer has access to this at all, and Director/Management's own
      // /management/cases keeps full override access but isn't the primary
      // path anymore either.
      await logout(page);
      await login(page, "e2e-operations@test.local", PASSWORD);
      await page.goto("/operations");
      const caseRow = page.locator("tr", { hasText: "E2E Case Candidate" });
      await expect(caseRow).toBeVisible({ timeout: 25_000 });
      await expect(caseRow.getByText(/Stage 1 of 11: Candidate Registration & Document Submission/)).toBeVisible();
      await caseRow.getByRole("link", { name: "E2E Case Candidate" }).click();
      await page.waitForURL(/\/operations\/.+/);
    });

    await test.step("Operations confirms the documentation, which a case needs before it can advance", async () => {
      // Without this the stage API refuses with 422 "Awaiting
      // Operations/Director documentation confirmation".
      await page.getByRole("button", { name: "Confirm Documentation" }).click();
      await expect(page.getByText(/Confirmed by /)).toBeVisible({ timeout: 25_000 });
    });

    await test.step("Operations advances the case to Document Preparation with a deadline", async () => {
      await page.getByRole("combobox").first().click();
      await page.getByRole("option", { name: "Document Preparation, Translation & Legalization" }).click();
      await page.getByPlaceholder("Notes (optional)").fill("Docs look complete, moving to document preparation.");
      await page.getByRole("button", { name: "Update Stage" }).click();

      await expect(page.getByText(/Stage 2 of 11: Document Preparation, Translation & Legalization/)).toBeVisible({ timeout: 25_000 });
      await expect(page.getByText("Docs look complete, moving to document preparation.")).toBeVisible();
    });

    await test.step("Operations delivers the Work Permit (2026-07-31: replaces Contract in Operations' own case view — Operations doesn't issue contracts, that's Director/Admin's lane)", async () => {
      const workPermitCard = page.locator(".card", { hasText: "Work Permit" });
      await expect(workPermitCard.getByText("Not delivered yet.")).toBeVisible();
      await workPermitCard.locator('input[type="file"]').setInputFiles({
        name: "work-permit.pdf",
        mimeType: "application/pdf",
        buffer: Buffer.from("%PDF-1.4\n%%EOF"),
      });
      await workPermitCard.getByRole("button", { name: "Upload" }).click();

      await expect(workPermitCard.getByText("Issued Work Permit")).toBeVisible({ timeout: 25_000 });
      await expect(workPermitCard.getByText(/Delivered/)).toBeVisible();
    });

    await test.step("director/admin retains full override access to the same case via /management/cases, and issues the contract themselves (Operations has no Contract card at all now)", async () => {
      await logout(page);
      await login(page, "e2e-admin@test.local", PASSWORD);
      await page.goto("/management/cases");
      const caseRow = page.locator("tr", { hasText: "E2E Case Candidate" });
      await expect(caseRow).toBeVisible({ timeout: 25_000 });
      await expect(caseRow.getByText(/Stage 2 of 11: Document Preparation, Translation & Legalization/)).toBeVisible();
      await caseRow.getByRole("link", { name: "E2E Case Candidate" }).click();
      await page.waitForURL(/\/management\/cases\/.+/);

      await page.getByPlaceholder(/Offer of employment/).fill("Offer of employment for E2E Test Job. Salary and terms as discussed. Start date to be confirmed.");
      await page.getByRole("button", { name: "Issue Contract" }).click();

      await expect(page.getByText("sent", { exact: true })).toBeVisible({ timeout: 25_000 });
    });

    await test.step("the candidate signs their own contract from their dashboard", async () => {
      await logout(page);
      await login(page, "e2e-case-candidate@test.local", PASSWORD);
      await page.goto("/dashboard/cases");

      await expect(page.getByText("My Placement Case")).toBeVisible({ timeout: 25_000 });
      await expect(page.getByText(/Offer of employment for E2E Test Job/)).toBeVisible();

      await page.getByPlaceholder("Type your full legal name to sign").fill("E2E Case Candidate");
      await page.getByRole("button", { name: "Sign Contract" }).click();

      await expect(page.getByText(/Signed by E2E Case Candidate on/)).toBeVisible({ timeout: 25_000 });
    });
  });
});
