import { test, expect } from "@playwright/test";

// The virtual assistants' portal (Phase 6): a VA signs in to its own portal
// and sees the partners it looks after, and no others.

test("a virtual assistant sees its own partners and its dashboard", async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem("vertex_welcome_accepted", "true"));
  await page.goto("/auth/login");
  await page.fill("#login-email", "e2e-va@test.local");
  await page.fill("#login-password", "E2ETestPassword123!");
  await page.click("#login-submit-btn");
  await page.waitForURL(/\/va$/, { timeout: 25_000 });

  await expect(page.getByRole("heading", { name: "Partner Overview" })).toBeVisible({ timeout: 25_000 });
  // Its agency has nothing signed yet, so it needs attention.
  await expect(page.getByText("E2E VA Agency").first()).toBeVisible();
  await expect(page.getByText("MOU not signed").first()).toBeVisible();

  await page.getByRole("link", { name: "Partners" }).click();
  await page.waitForURL(/\/va\/partners/);
  await expect(page.getByRole("cell", { name: "E2E VA Agency", exact: true })).toBeVisible({ timeout: 25_000 });
  await expect(page.getByText("E2E Other VA Agency")).toHaveCount(0);

  // Other portals stay closed to it.
  const admin = await page.request.get("/api/admin/sectors");
  expect(admin.status()).toBe(403);
});
