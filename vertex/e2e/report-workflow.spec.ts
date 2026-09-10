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
  test("recruiter submits, supervisor verifies and consolidates, management verifies", async ({ page }) => {
    const note = `E2E report note ${Date.now()}`;

    await test.step("recruiter submits a daily report", async () => {
      await login(page, "e2e-recruiter@test.local", PASSWORD);
      await page.goto("/recruiter/reports");

      await page.getByRole("button", { name: "Submit Report" }).click();
      await page.locator('input[type="date"]').first().fill("2026-07-01");
      await page.locator('input[type="date"]').nth(1).fill("2026-07-02");
      await page.getByPlaceholder("Notes for your supervisor").fill(note);
      await page.locator("form").getByRole("button", { name: "Submit Report" }).click();

      await expect(page.getByText("submitted", { exact: true })).toBeVisible({ timeout: 25_000 });
      await expect(page.getByText(note)).toBeVisible();
    });

    await test.step("supervisor verifies the recruiter report and consolidates it into a country report", async () => {
      await logout(page);
      await login(page, "e2e-supervisor@test.local", PASSWORD);
      await page.goto("/supervisor/reports");

      await expect(page.getByText(note)).toBeVisible({ timeout: 25_000 });
      await page.getByRole("button", { name: "Verify" }).click();
      await expect(page.getByText("Nothing awaiting review.")).toBeVisible({ timeout: 25_000 });

      await page.getByRole("button", { name: "Consolidate manually" }).click();
      await page.locator('input[type="date"]').first().fill("2026-07-01");
      await page.locator('input[type="date"]').nth(1).fill("2026-07-08");
      await page.getByText(/E2E Recruiter/).click(); // checks the checkbox via its label
      await page.getByPlaceholder("Notes for In-House").fill("E2E country summary");
      await page.getByRole("button", { name: "Submit Country Report" }).click();

      await expect(page.getByText("weekly report", { exact: true })).toBeVisible({ timeout: 25_000 });
      await expect(page.getByText("submitted", { exact: true })).toBeVisible();
    });

    await test.step("management sees the full escalation trail and verifies the country report", async () => {
      await logout(page);
      await login(page, "e2e-admin@test.local", PASSWORD);
      await page.goto("/management/reports");

      const reportCard = page.locator(".card", { hasText: "E2E Country" });
      await expect(reportCard).toBeVisible({ timeout: 25_000 });
      await reportCard.getByText(/Escalation trail/).click();
      await expect(reportCard.getByText("E2E Recruiter").first()).toBeVisible();
      await expect(reportCard.getByText("E2E Supervisor").first()).toBeVisible();

      await reportCard.getByRole("button", { name: "Verify" }).click();
      await expect(reportCard.getByText("verified", { exact: true })).toBeVisible({ timeout: 25_000 });
    });
  });
});
