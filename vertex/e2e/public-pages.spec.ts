import { test, expect } from "@playwright/test";
import { LANDING_VIDEO, PARTNER_REEL } from "../src/lib/media";

// The public pages from the upstream sync (2026-11-03 to 11-06): the landing
// video and its chapter buttons, the Contact page's partner reel, and the
// landing page's partner enquiry form, under the enforced CSP.

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem("vertex_welcome_accepted", "true"));
});

test("the landing page plays its video from the media bucket, with chapter buttons", async ({ page }) => {
  await page.goto("/");
  const video = page.locator(`video[src="${LANDING_VIDEO}"]`);
  await expect(video).toHaveCount(1);
  await expect(page.getByRole("button", { name: /For partners/ }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: /For individual applicants/ }).first()).toBeVisible();
});

test("the Contact page shows the partner reel", async ({ page }) => {
  await page.goto("/contact");
  await expect(page.locator(`video[src="${PARTNER_REEL}"]`)).toHaveCount(1);
});

test("a partner enquiry from the landing page reaches the team", async ({ page }) => {
  await page.goto("/#partner-form");
  const form = page.locator("#partner-form form");
  await form.locator('[name="organisation"]').fill("E2E Addis Recruitment PLC");
  await form.locator('[name="organisation_type"]').selectOption("agency");
  await form.locator('[name="country"]').fill("Ethiopia");
  await form.locator('[name="name"]').fill("E2E Samuel");
  await form.locator('[name="job_title"]').fill("Director");
  await form.locator('[name="email"]').fill("e2e-samuel@test.local");
  await form.locator('[name="cooperation_requirements"]').fill("We place around forty carers a year and would like to work with Vertex.");
  await form.locator('[name="acknowledgement"]').check();
  await form.getByRole("button", { name: "Submit partnership enquiry" }).click();
  await expect(page.getByText("Thank you for your enquiry")).toBeVisible({ timeout: 25_000 });
});

// The mobile app's home screen (the landing CMS, part 4): its published
// blocks, through the real FastAPI, without a session.
test("the mobile app's home screen text is public, and only the app's", async ({ request }) => {
  const res = await request.get("/api/public/landing?app=mobile");
  expect(res.status()).toBe(200);
  const { data } = await res.json();
  expect(data.app).toBe("mobile");
  const keys = data.blocks.map((b: { key: string }) => b.key);
  expect(keys).toContain("mobile.hero");
  expect(keys).toContain("shared.contact");
  expect(keys.some((k: string) => k.startsWith("web."))).toBe(false);
  expect((await request.get("/api/public/landing?app=web")).status()).toBe(400);
});
