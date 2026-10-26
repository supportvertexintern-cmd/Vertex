import { test, expect } from "@playwright/test";

// The website calls FastAPI for the areas FastAPI owns (backend plan step
// 2.0): cookie session -> Next.js route -> callBackend() -> FastAPI -> the
// database. The fee policy was the first area handed over (steps 1.1-1.3).
// If FastAPI isn't running, or Next.js can't reach or authenticate to it,
// these fail.

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("vertex_welcome_accepted", "true");
  });
  await page.goto("/auth/login");
  await page.fill("#login-email", "e2e-admin@test.local");
  await page.fill("#login-password", "E2ETestPassword123!");
  await page.click("#login-submit-btn");
  await page.waitForURL((url) => !url.pathname.startsWith("/auth/login"), { timeout: 25_000 });
});

test.describe("Next.js -> FastAPI (fee policy)", () => {
  test("a save and a read go through FastAPI", async ({ page }) => {
    const saved = await page.request.post("/api/fee-policy", {
      data: { country_id: null, enabled: false, documentation_amount: 125, currency: "USD" },
    });
    expect(saved.status()).toBe(200);
    const { data: policy } = await saved.json();
    expect(policy).toMatchObject({ country_id: null, enabled: false, documentation_amount: 125, currency: "USD", country: null });

    const read = await page.request.get("/api/fee-policy");
    expect(read.status()).toBe(200);
    const { data: policies } = await read.json();
    expect(policies.map((p: { id: string }) => p.id)).toContain(policy.id);
  });

  test("FastAPI's validation errors reach the website", async ({ page }) => {
    const res = await page.request.post("/api/fee-policy", { data: { enabled: true, currency: "EURO" } });
    expect(res.status()).toBe(422);
    const { error } = await res.json();
    expect(error.code).toBe("validation_error");
    expect(Object.keys(error.details)).toContain("currency");
  });

  test("the Fee Policy page shows FastAPI's data", async ({ page }) => {
    await page.request.post("/api/fee-policy", { data: { country_id: null, enabled: true, permit_amount: 250, currency: "USD" } });
    await page.goto("/management/fee-policy");
    // The table row, from FastAPI's list (the form's dropdown has the same words).
    await expect(page.getByRole("cell", { name: "Global default" })).toBeVisible();
  });
});
