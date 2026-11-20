import { test, expect } from "@playwright/test";

// Management's partner ledgers (Phase 6, upstream staging): the commissions
// the engine records, Vertex's own admin fees, and the rules grid. FastAPI
// records, lists, approves and pays them (vertex_be/app/api/v1/partner_ledgers.py).

test("a manager reaches the commissions, the admin fees and the rules", async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem("vertex_welcome_accepted", "true"));
  await page.goto("/auth/login");
  await page.fill("#login-email", "e2e-admin@test.local");
  await page.fill("#login-password", "E2ETestPassword123!");
  await page.click("#login-submit-btn");
  await page.waitForURL(/\/admin/, { timeout: 25_000 });

  await page.goto("/management");
  await page.getByRole("link", { name: "Partner Commissions" }).click();
  await expect(page.getByRole("heading", { name: "Partner Commissions" })).toBeVisible({ timeout: 25_000 });

  await page.getByRole("link", { name: "Admin Fees" }).click();
  await expect(page.getByRole("heading", { name: "Admin Fees" })).toBeVisible({ timeout: 25_000 });

  await page.getByRole("link", { name: "Commission Rules" }).click();
  await expect(page.getByRole("heading", { name: "Partner Commission Rules" })).toBeVisible({ timeout: 25_000 });
  // The two global rules, migration 0023's defaults or what's been set since.
  await expect(page.getByRole("button", { name: "Save" })).toHaveCount(2);

  const rules = await (await page.request.get("/api/admin/partner-commission-rules")).json();
  expect(rules.data.map((r: { rule_type: string }) => r.rule_type).sort()).toEqual(["monthly_deployment", "registration"]);
  const listed = await page.request.get("/api/admin/partner-commissions?status=pending");
  expect(listed.status()).toBe(200);
  expect(Array.isArray((await listed.json()).data)).toBe(true);
  // A month that isn't on the ledger can't be approved.
  expect((await page.request.post("/api/admin/partner-commissions/no-such-commission/approve")).status()).toBe(404);
});
