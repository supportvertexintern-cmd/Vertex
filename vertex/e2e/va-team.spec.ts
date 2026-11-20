import { test, expect } from "@playwright/test";

// Management's VA team (Phase 6): a partner manager adds a Virtual Assistant
// (its setup email lets it set a password), re-sends that invite, deactivates
// it and reactivates it. FastAPI does each (vertex_be/app/api/v1/partner_tracking.py).

test("a manager adds, resets, deactivates and reactivates a virtual assistant", async ({ page }) => {
  const stamp = Date.now().toString(36);
  const name = `E2E New VA ${stamp}`;
  await page.addInitScript(() => window.localStorage.setItem("vertex_welcome_accepted", "true"));
  await page.goto("/auth/login");
  await page.fill("#login-email", "e2e-admin@test.local");
  await page.fill("#login-password", "E2ETestPassword123!");
  await page.click("#login-submit-btn");
  await page.waitForURL(/\/admin/, { timeout: 25_000 });

  await page.goto("/management");
  await page.getByRole("link", { name: "VA Team" }).click();
  await page.waitForURL(/\/management\/va-team$/);
  await expect(page.getByRole("heading", { name: "VA Team" })).toBeVisible({ timeout: 25_000 });

  // An address in capitals is stored as one account, lowercased (DEF-001).
  await page.getByPlaceholder("Full name").fill(name);
  await page.getByPlaceholder("Email address").fill(`E2E-NewVA-${stamp}@Test.Local`);
  await page.getByRole("button", { name: "Create VA account" }).click();
  await expect(page.getByText(/VA account created/)).toBeVisible({ timeout: 25_000 });
  const row = page.getByRole("row", { name: new RegExp(name) });
  await expect(row.getByText(`e2e-newva-${stamp}@test.local`)).toBeVisible();
  await expect(row.getByText("Awaiting invite")).toBeVisible();

  await row.getByRole("button", { name: "Send reset invite" }).click();
  await expect(page.getByText(/Password reset/)).toBeVisible({ timeout: 25_000 });

  await row.getByRole("button", { name: "Deactivate" }).click();
  await row.getByRole("button", { name: "Confirm deactivate" }).click();
  await expect(page.getByText("VA deactivated.")).toBeVisible({ timeout: 25_000 });
  await expect(row.getByText("Deactivated")).toBeVisible();

  await row.getByRole("button", { name: "Reactivate" }).click();
  await expect(page.getByText("VA reactivated.")).toBeVisible({ timeout: 25_000 });
  await expect(row.getByText("Awaiting invite")).toBeVisible();

  // The same address in another case is the same account.
  await page.getByPlaceholder("Full name").fill(`${name} twin`);
  await page.getByPlaceholder("Email address").fill(`e2e-newva-${stamp}@test.local`.toUpperCase());
  await page.getByRole("button", { name: "Create VA account" }).click();
  await expect(page.getByText("A user with this email already exists.")).toBeVisible({ timeout: 25_000 });
});
