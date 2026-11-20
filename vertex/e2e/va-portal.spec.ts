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

test("a virtual assistant tracks its partner: reports, follow-ups and the activity feed", async ({ page }) => {
  const stamp = Date.now().toString(36);
  await page.addInitScript(() => window.localStorage.setItem("vertex_welcome_accepted", "true"));
  await page.goto("/auth/login");
  await page.fill("#login-email", "e2e-va@test.local");
  await page.fill("#login-password", "E2ETestPassword123!");
  await page.click("#login-submit-btn");
  await page.waitForURL(/\/va$/, { timeout: 25_000 });

  await page.goto("/va/partners");
  await page.getByRole("link", { name: "E2E VA Agency", exact: true }).click();
  await page.waitForURL(/\/va\/partners\/[^/]+$/);
  await expect(page.getByRole("heading", { name: "E2E VA Agency" })).toBeVisible({ timeout: 25_000 });
  await expect(page.getByText("Partner tracking")).toBeVisible();
  // Onboarding is the managers' to change: a VA reads it.
  await expect(page.getByRole("button", { name: /Mark documents submitted|Mark as not submitted/ })).toHaveCount(0);
  await expect(page.getByText("E2E Virtual Assistant").first()).toBeVisible();

  // A report needs notes before it can be recorded.
  const record = page.getByRole("button", { name: "Record report" });
  await expect(record).toBeDisabled();
  await page.getByPlaceholder("Report notes / content…").fill(`Weekly update ${stamp}`);
  await record.click();
  await expect(page.getByText("Report recorded.")).toBeVisible({ timeout: 25_000 });
  await expect(page.getByText(`Weekly update ${stamp}`)).toBeVisible();

  // A follow-up keeps its due date.
  await page.getByPlaceholder(/Action required/).fill(`Chase the signed MOU ${stamp}`);
  await page.getByLabel("Follow-up due date").fill("2027-01-15");
  await page.getByRole("button", { name: "Add" }).click();
  await expect(page.getByText("Follow-up added.")).toBeVisible({ timeout: 25_000 });
  const followUp = page.locator("div.rounded-lg", { hasText: `Chase the signed MOU ${stamp}` });
  await expect(followUp.getByText(/Due /)).toBeVisible();

  // Both are in the partner's history, by name.
  await expect(page.getByText("Created report").first()).toBeVisible();
  await expect(page.getByText("Created follow-up").first()).toBeVisible();

  await followUp.getByRole("button", { name: "Complete" }).click();
  await expect(page.getByText("Follow-up completed.")).toBeVisible({ timeout: 25_000 });
  await expect(followUp.getByText("done")).toBeVisible();

  // A partner that isn't there is reported, not shown.
  const missing = await page.request.get("/api/management/partners/no-such-partner/tracking");
  expect(missing.status()).toBe(404);
});
