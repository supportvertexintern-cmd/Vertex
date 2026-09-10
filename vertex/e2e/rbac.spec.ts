import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  // Site-wide welcome/consent modal, gated by localStorage — pre-accept it
  // so it doesn't block interaction with the page under test.
  await page.addInitScript(() => {
    window.localStorage.setItem("vertex_welcome_accepted", "true");
  });
});

test.describe("RBAC portal gating", () => {
  test("unauthenticated visitors are redirected to login with a return path", async ({ page }) => {
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/auth\/login\?redirect=%2Fadmin/);
  });

  test("protects every new portal path prefix, not just /admin", async ({ page }) => {
    for (const path of ["/dashboard", "/recruiter", "/supervisor", "/inhouse", "/management", "/marketing", "/partner", "/hr", "/operations", "/finance"]) {
      await page.goto(path);
      await expect(page).toHaveURL(new RegExp(`/auth/login\\?redirect=${encodeURIComponent(path)}`));
    }
  });

  test("public pages remain accessible without auth", async ({ page }) => {
    await page.goto("/jobs");
    await expect(page).not.toHaveURL(/auth\/login/);
  });
});

test.describe("Authenticated access (regression coverage for the middleware crypto bug)", () => {
  test("a logged-in admin can actually reach a protected portal, not just get redirected away from one", async ({ page }) => {
    await page.goto("/auth/login");
    await page.fill("#login-email", "e2e-admin@test.local");
    await page.fill("#login-password", "E2ETestPassword123!");
    await page.click("#login-submit-btn");

    // Wait for the login POST + client-side redirect to actually land
    // before navigating away — otherwise the next page.goto can race the
    // in-flight request and abort it before the session cookie is set.
    await page.waitForURL((url) => !url.pathname.startsWith("/auth/login"), { timeout: 25_000 });

    // This must NOT bounce back to /auth/login — that exact regression
    // (valid session, still redirected) is what shipped silently before
    // this test existed: jsonwebtoken's dependency on Node's `crypto`
    // module isn't supported in the Edge runtime middleware defaults to.
    await page.goto("/admin/regions");
    await expect(page).toHaveURL(/\/admin\/regions$/);
    await expect(page.getByRole("heading", { name: /regions/i })).toBeVisible();
  });
});

test.describe("Candidate registration is invite-only (no general sign-up)", () => {
  test("visiting /auth/register without an invite token redirects to /apply", async ({ page }) => {
    // Regression coverage: a candidate account only ever comes from a
    // screening invite now (Candidate Information Form -> screened ->
    // invite -> set password) — there's no blank sign-up form to land on
    // anymore, so the only sensible thing for a bare /auth/register visit
    // to do is send the visitor to the actual starting point.
    await page.goto("/auth/register");
    await expect(page).toHaveURL(/\/apply$/);
  });
});
