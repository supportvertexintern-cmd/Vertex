import { test, expect, type Page } from "@playwright/test";

// Role management (2026-11-21): the admin gives a role a permission on the
// Roles & Permissions page, and it applies to that role's users at once,
// without them signing in again. Through the real FastAPI
// (vertex_be/app/api/v1/roles.py).

const PASSWORD = "E2ETestPassword123!"; // vertex_be/scripts/seed/e2e.py (a throwaway test database)

async function signIn(page: Page, email: string) {
  await page.addInitScript(() => window.localStorage.setItem("vertex_welcome_accepted", "true"));
  await page.goto("/auth/login");
  await page.fill("#login-email", email);
  await page.fill("#login-password", PASSWORD);
  await page.click("#login-submit-btn");
  await page.waitForURL((url) => !url.pathname.startsWith("/auth/login"), { timeout: 25_000 });
}

const permissionsOf = async (page: Page): Promise<string[]> => (await (await page.request.get("/api/auth/me")).json()).data.permissions;

test("the admin gives HR a permission, and HR has it at once", async ({ page, browser }) => {
  const hrContext = await browser.newContext();
  const hr = await hrContext.newPage();
  await signIn(hr, "e2e-hr@test.local");
  expect(await permissionsOf(hr)).toEqual([]);

  await signIn(page, "e2e-admin@test.local");
  try {
    await page.goto("/admin/roles");
    await expect(page.getByRole("heading", { name: "Roles & Permissions" })).toBeVisible();

    // Admin holds everything and can't be changed; external roles aren't listed.
    const adminEdit = page.getByRole("checkbox", { name: "System Administrator: Landing pages: Edit drafts" });
    await expect(adminEdit).toBeChecked();
    await expect(adminEdit).toBeDisabled();
    await expect(page.getByRole("checkbox", { name: /^Partner:/ })).toHaveCount(0);
    // Marketing has both, as before role management.
    await expect(page.getByRole("checkbox", { name: "Marketing: Landing pages: Publish" })).toBeChecked();

    const hrEdit = page.getByRole("checkbox", { name: "HR: Landing pages: Edit drafts" });
    await expect(hrEdit).not.toBeChecked();
    await hrEdit.check();
    await page.getByRole("button", { name: "Save HR" }).click();
    await expect(page.getByRole("alertdialog")).toContainText("Give: Landing pages: Edit drafts");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByRole("status")).toHaveText("Saved: HR.");

    // The same HR session, no new sign-in.
    expect(await permissionsOf(hr)).toEqual(["landing.edit"]);
    await page.reload();
    await expect(page.getByRole("checkbox", { name: "HR: Landing pages: Edit drafts" })).toBeChecked();
  } finally {
    // Back as it was, for the other journeys.
    const reset = await page.request.put("/api/admin/roles/hr/permissions", { data: { permissions: [] } });
    expect(reset.status()).toBe(200);
    expect(await permissionsOf(hr)).toEqual([]);
    await hrContext.close();
  }
});

test("only the admin reaches the page and its API", async ({ page }) => {
  await signIn(page, "e2e-marketing@test.local");
  expect((await page.request.get("/api/admin/roles")).status()).toBe(403);
  expect((await page.request.put("/api/admin/roles/marketing/permissions", { data: { permissions: [] } })).status()).toBe(403);
  await page.goto("/admin/roles");
  await expect(page).not.toHaveURL(/\/admin\/roles/);
});

test("a role given jobs.manage posts jobs from its own portal", async ({ page, browser }) => {
  const hrContext = await browser.newContext();
  const hr = await hrContext.newPage();
  await signIn(page, "e2e-admin@test.local");
  try {
    const granted = await page.request.put("/api/admin/roles/hr/permissions", { data: { permissions: ["jobs.manage"] } });
    expect(granted.status()).toBe(200);

    await signIn(hr, "e2e-hr@test.local");
    await hr.getByRole("link", { name: "Jobs", exact: true }).first().click();
    await expect(hr).toHaveURL(/\/marketing\/jobs$/);
    await expect(hr.getByRole("link", { name: /new job/i }).first()).toBeVisible();
    // Sectors & Requirements stays shut: HR holds jobs.manage only.
    await hr.goto("/marketing/sectors");
    await expect(hr.getByText("Your role doesn't have permission for this page.")).toBeVisible();
  } finally {
    expect((await page.request.put("/api/admin/roles/hr/permissions", { data: { permissions: [] } })).status()).toBe(200);
    await hrContext.close();
  }
});
