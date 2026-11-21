import { test, expect, type Page } from "@playwright/test";

// The landing editor (the landing CMS, part 3), through the real FastAPI:
// marketing saves a draft visitors don't see, previews it, publishes it,
// and visitors see it at once. A role without the permission gets no link
// and no editor (role management decides; vertex_be/app/api/v1/roles.py).

const PASSWORD = "E2ETestPassword123!"; // vertex_be/scripts/seed/e2e.py (a throwaway test database)

async function signIn(page: Page, email: string) {
  await page.goto("/auth/login");
  await page.fill("#login-email", email);
  await page.fill("#login-password", PASSWORD);
  await page.click("#login-submit-btn");
  await page.waitForURL((url) => !url.pathname.startsWith("/auth/login"), { timeout: 25_000 });
}

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => window.localStorage.setItem("vertex_welcome_accepted", "true"));
});

test("marketing drafts, previews and publishes; visitors see only what's published", async ({ page, browser }) => {
  const title = `E2E opportunities ${Date.now().toString(36)}`;
  const visitorContext = await browser.newContext();
  const visitor = await visitorContext.newPage();

  await signIn(page, "e2e-marketing@test.local");
  try {
    // Marketing's portal links to the editor (its role holds the permission).
    await page.getByRole("link", { name: "Landing pages" }).first().click();
    await expect(page).toHaveURL(/\/content\/landing$/);
    await page.getByRole("navigation", { name: "Blocks" }).getByRole("button", { name: /^Featured jobs/ }).click();
    const editor = page.getByRole("region", { name: "Featured jobs" });
    await expect(editor.getByText("Showing the built-in text: never published.")).toBeVisible();

    // FastAPI's check, shown on the field.
    await editor.getByLabel("Title", { exact: true }).fill("   ");
    await editor.getByRole("button", { name: "Save draft" }).click();
    await expect(page.getByRole("alert").first()).toContainText("The block's content isn't valid.");
    await expect(editor.getByText("String should have at least 1 character")).toBeVisible();

    await editor.getByLabel("Title", { exact: true }).fill(title);
    await editor.getByRole("button", { name: "Save draft" }).click();
    await expect(page.getByRole("status")).toContainText("Draft saved");

    // A visitor still sees the published text; the preview shows the draft.
    await visitor.goto("/");
    await expect(visitor.getByText(title)).toHaveCount(0);
    await page.goto("/?preview=1");
    await expect(page.getByText("Preview: this page shows the saved drafts.")).toBeVisible();
    await expect(page.getByRole("heading", { name: title })).toBeVisible();

    // Publish: the visitor sees it at once.
    await page.goto("/content/landing");
    await page.getByRole("navigation", { name: "Blocks" }).getByRole("button", { name: /^Featured jobs/ }).click();
    await page.getByRole("region", { name: "Featured jobs" }).getByRole("button", { name: "Publish" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Publish" }).click();
    await expect(page.getByRole("status")).toHaveText("Published.");
    await visitor.goto("/");
    await expect(visitor.getByRole("heading", { name: title })).toBeVisible();
  } finally {
    // The built-in text back, for the other journeys.
    const block = (await (await page.request.get("/api/content/blocks/web.jobs")).json()).data;
    expect((await page.request.put("/api/content/blocks/web.jobs/draft", { data: { body: block.default, visible: true } })).status()).toBe(200);
    expect((await page.request.post("/api/content/blocks/web.jobs/publish")).status()).toBe(200);
    await visitorContext.close();
  }
});

test("a role without the permission gets no link and no editor", async ({ page }) => {
  await signIn(page, "e2e-hr@test.local");
  await expect(page.getByRole("link", { name: "Landing pages" })).toHaveCount(0);
  await page.goto("/content/landing");
  await expect(page.getByText("Your role can't edit or publish the landing pages.")).toBeVisible();
  expect((await page.request.put("/api/content/blocks/web.jobs/draft", { data: { body: {}, visible: true } })).status()).toBe(403);
});
