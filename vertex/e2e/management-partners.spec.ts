import { test, expect } from "@playwright/test";

// Management's partner view (Phase 6, upstream staging): a partner's page
// carries its commission statement and the same tracking panel a VA uses, and
// Partner Performance ranks every partner and team member. FastAPI computes
// both from the ledgers on each read (vertex_be/app/api/v1/partner_performance.py).

test("a manager sees a partner's statement and tracking, and every partner's performance", async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem("vertex_welcome_accepted", "true"));
  await page.goto("/auth/login");
  await page.fill("#login-email", "e2e-admin@test.local");
  await page.fill("#login-password", "E2ETestPassword123!");
  await page.click("#login-submit-btn");
  await page.waitForURL(/\/admin/, { timeout: 25_000 });

  await page.goto("/management/partners");
  await page.getByRole("link", { name: /E2E VA Agency/ }).first().click();
  await page.waitForURL(/\/management\/partners\/[^/]+$/);
  await expect(page.getByText("Commission statement")).toBeVisible({ timeout: 25_000 });
  await expect(page.getByText("Partner tracking")).toBeVisible({ timeout: 25_000 });
  // A manager edits onboarding from here: the VA only reads it.
  await expect(page.getByRole("button", { name: /Mark documents submitted|Mark as not submitted/ })).toBeVisible();

  await page.getByRole("link", { name: "Partner Performance" }).click();
  await page.waitForURL(/\/management\/partner-performance$/);
  await expect(page.getByRole("heading", { name: "Partner & Commission Performance" })).toBeVisible({ timeout: 25_000 });
  await expect(page.getByText("Partner performance rankings")).toBeVisible();
  await expect(page.getByText("Team member performance")).toBeVisible();
  await expect(page.getByText("E2E VA Agency").first()).toBeVisible();

  // Commission money is the managers': a VA's session can't read it.
  const asVa = await page.context().browser()!.newContext({ baseURL: test.info().project.use.baseURL });
  const vaPage = await asVa.newPage();
  await vaPage.goto("/auth/login");
  await vaPage.fill("#login-email", "e2e-va@test.local");
  await vaPage.fill("#login-password", "E2ETestPassword123!");
  await vaPage.click("#login-submit-btn");
  await vaPage.waitForURL(/\/va$/, { timeout: 25_000 });
  expect((await vaPage.request.get("/api/management/partner-performance")).status()).toBe(403);
  await asVa.close();
});
