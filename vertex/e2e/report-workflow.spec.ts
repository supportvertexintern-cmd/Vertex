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

// Full reporting-cycle escalation path (SRS FR-3.4, FR-3.5, FR-3.7): a
// recruiter submits a report, their supervisor verifies it and
// consolidates it into a country report, and management verifies that —
// closing the loop with the escalation trail visible end to end.
test.describe("Reporting cycle escalation (Phase 3)", () => {
  test("recruiter submits, supervisor verifies and consolidates, In-House verifies", async ({ page }) => {
    const note = `E2E report note ${Date.now()}`;

    await test.step("recruiter submits a daily report", async () => {
      await login(page, "e2e-recruiter@test.local", PASSWORD);
      await page.goto("/recruiter/reports");

      await page.getByRole("button", { name: "Submit Report" }).click();
      // A daily report has one date (its end date is the same day), the
      // notes box is the framework's Executive Summary now, and the
      // submitter must certify the report (ReportContentForm).
      await page.locator('input[type="date"]').first().fill("2026-07-01");
      await page.getByPlaceholder(/Progress, achievements, shortfalls/).fill(note);
      await page.getByLabel("I confirm that the information above is complete and accurate.").check();
      await page.locator("form").getByRole("button", { name: "Certify & Submit" }).click();

      await expect(page.getByText("submitted", { exact: true })).toBeVisible({ timeout: 25_000 });
    });

    // The chain is recruiter -> country supervisor -> In-House supervisor ->
    // management. Each level verifies the one below on that report's own
    // page; management only sees In-House portfolio reports.
    await test.step("supervisor verifies the recruiter report", async () => {
      await logout(page);
      await login(page, "e2e-supervisor@test.local", PASSWORD);
      await page.goto("/supervisor/reports");

      const row = page.locator("tr", { hasText: "E2E Recruiter" }).first();
      await expect(row).toBeVisible({ timeout: 25_000 });
      await row.getByRole("link", { name: /View/ }).click();
      await page.waitForURL(/\/supervisor\/reports\/.+/);
      await page.getByRole("button", { name: "Verify" }).click();
      await expect(page.getByText("verified", { exact: true })).toBeVisible({ timeout: 25_000 });
    });

    await test.step("supervisor consolidates the week into a country report for In-House", async () => {
      await page.goto("/supervisor/reports/new");
      await page.getByRole("combobox").first().click();
      await page.getByRole("option", { name: "Weekly Consolidated Report" }).click();
      // Any date in the week picks the whole week containing it.
      await page.locator('input[type="date"]').first().fill("2026-07-01");
      await page.getByPlaceholder(/Progress, achievements, shortfalls/).fill("E2E country summary");
      await page.getByLabel("I confirm that the information above is complete and accurate.").check();
      await page.getByRole("button", { name: "Certify & Submit Country Report" }).click();

      await page.waitForURL(/\/supervisor\/reports$/, { timeout: 25_000 });
      // Each report table opens on its Daily tab; the second table on this
      // page is the supervisor's own country reports.
      await page.getByRole("button", { name: /^weekly$/i }).nth(1).click();
      // The supervisor's own table has no submitter column; the recruiter
      // report is "verified" by now, so the only "submitted" row is ours.
      const countryRow = page.locator("tr", { hasText: "submitted" }).first();
      await expect(countryRow).toBeVisible({ timeout: 25_000 });
    });

    await test.step("In-House verifies the country report", async () => {
      await logout(page);
      await login(page, "e2e-inhouse@test.local", PASSWORD);
      await page.goto("/inhouse/reports");
      // Country reports is the first report table on this page.
      await page.getByRole("button", { name: /^weekly$/i }).first().click();

      const row = page.locator("tr", { hasText: "E2E Supervisor" }).first();
      await expect(row).toBeVisible({ timeout: 25_000 });
      await row.getByRole("link", { name: /View/ }).click();
      await page.waitForURL(/\/inhouse\/reports\/.+/);
      await page.getByRole("button", { name: "Verify" }).click();
      await expect(page.getByText("verified", { exact: true })).toBeVisible({ timeout: 25_000 });
    });
  });
});
