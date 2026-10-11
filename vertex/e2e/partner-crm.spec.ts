import { config } from "dotenv";
import path from "path";
config({ path: path.resolve(__dirname, "../.env") });

import { test, expect, type Page, type Locator } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { signAccountSetupToken } from "../src/lib/jwt";

const prisma = new PrismaClient();

test.afterAll(async () => {
  await prisma.$disconnect();
});

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("vertex_welcome_accepted", "true");
  });
});

async function login(page: Page, email: string, password: string) {
  await page.goto("/auth/login");
  await page.fill("#login-email", email);
  await page.fill("#login-password", password);
  await page.click("#login-submit-btn");
  await page.waitForURL((url) => !url.pathname.startsWith("/auth/login"), { timeout: 25_000 });
}

async function logout(page: Page) {
  await page.getByText("Log out").click();
  await page.waitForURL((url) => url.pathname.startsWith("/auth/login") || url.pathname === "/", { timeout: 25_000 });
}

// SearchableSelect renders as a button+listbox combobox, not a native
// <select> — open it, then click the matching option.
async function pickOption(page: Page, trigger: Locator, name: string | RegExp) {
  await trigger.click();
  await page.getByRole("option", { name }).click();
}

const PASSWORD = "E2ETestPassword123!";
const PARTNER_CONTACT_EMAIL = "e2e-partner-contact@test.local";

// Phase 5 Partner CRM (SRS FR-5.1), corrected: partners get their own
// admin-provisioned login and submit candidates themselves — these never
// enter Vertex's internal recruiter/screening/verification funnel (the
// partner has already done that). Staff-side job assignment is out of
// scope for now, so this test stops at "the partner sees its own
// submission" rather than any bridging/assignment step.
test.describe("Partner CRM (Phase 5, self-service intake)", () => {
  test("management adds a partner, provisions its login, and the partner submits a candidate", async ({ page }) => {
    const candidateName = `E2E Partner Candidate ${Date.now()}`;
    const partnerPassword = "E2EPartnerPassword123!";

    // Partner management lives under /management, which is now
    // director/admin-only (the In-House Supervisor got its own dedicated
    // /inhouse portal in a later review phase and lost direct /management
    // access) — the Partner API itself still accepts the wider
    // inhouse_supervisor/director/admin manager tier, but there's no UI
    // path there for inhouse_supervisor anymore, so use admin here instead.
    await test.step("admin adds a partner", async () => {
      await login(page, "e2e-admin@test.local", PASSWORD);
      await expect(page).toHaveURL(/\/admin$/);
      await page.goto("/management");
      await expect(page).toHaveURL(/\/management(\?.*)?$/);

      await page.goto("/management/partners");
      await page.getByRole("button", { name: "Add Partner" }).click();
      await page.getByLabel("Agency Name").fill("E2E Test Partner");
      await page.getByLabel("Country of Operation").fill("Kenya");
      await page.getByLabel("Contact Name").fill("E2E Partner Contact");
      await page.getByLabel("Contact Phone").fill("+254700000000");
      await page.getByLabel("Contact Email").fill(PARTNER_CONTACT_EMAIL);
      await page.locator("form").getByRole("button", { name: "Add Partner" }).click();

      await expect(page.getByText("E2E Test Partner")).toBeVisible({ timeout: 25_000 });
    });

    await test.step("provision the partner's own login", async () => {
      await page.getByRole("link", { name: "E2E Test Partner" }).first().click();
      await expect(page).toHaveURL(/\/management\/partners\/.+/);

      await page.getByRole("button", { name: "Create Partner Login" }).click();
      // Invite-based account creation (2026-07-27) replaced the old
      // "temp password shown once" pattern — no password appears in the
      // UI at all anymore, just a confirmation that an invite email went
      // out. The actual password-setting step is completed below via a
      // directly-minted setup token, the same way global-setup.ts already
      // bypasses email-dependent steps elsewhere in this suite.
      await expect(page.getByText("Partner login created")).toBeVisible({ timeout: 25_000 });
    });

    await test.step("the partner claims its invite and sets a password", async () => {
      const partner = await prisma.partner.findFirst({ where: { contact_email: PARTNER_CONTACT_EMAIL } });
      if (!partner?.user_id) throw new Error("Partner login was not provisioned.");
      const setupToken = signAccountSetupToken(partner.user_id);

      // Log out of the admin session first — still active from the
      // previous step, and /auth/register (a public page) has no "Log
      // out" control of its own to do this from afterward.
      await logout(page);
      await page.goto(`/auth/register?setup=${setupToken}`);
      await page.fill("#reg-password", partnerPassword);
      await page.fill("#reg-confirm-password", partnerPassword);
      await page.click("#register-submit-btn");
      await expect(page.getByText("You're All Set")).toBeVisible({ timeout: 25_000 });
    });

    await test.step("the partner logs in and submits a candidate", async () => {
      await login(page, PARTNER_CONTACT_EMAIL, partnerPassword);
      await expect(page).toHaveURL(/\/partner$/);

      await page.getByRole("button", { name: "Submit Candidate" }).click();

      await page.getByLabel("Full Name (as per passport)").fill(candidateName);
      await page.getByLabel("Date of Birth").fill("1995-06-15");
      // Nationality is a SearchableSelect (full world-country list) now,
      // not a free-text input, so pick the option rather than filling text.
      await pickOption(page, page.locator("#gender"), /^Male$/);
      await pickOption(page, page.locator("#nationality"), "Kenya");
      await page.getByLabel("Passport Number").fill("P" + Date.now());
      await page.getByLabel(/Passport Expiry Date/).fill("2030-01-01");
      // The partner form no longer collects the candidate's phone or email:
      // the partner is the point of contact until the candidate is invited.

      // Section 2 is a single Opportunity picker now (2026-07-31), not a
      // 3-country + sector cluster — Czech Republic's programmes have no
      // extra CountryDocumentRequirement rows, so only the two universal
      // checklist items (passport, passport_photo) need a real file
      // attached before Submit unlocks, keeping this test simple.
      await pickOption(page, page.getByLabel("Opportunity"), /Czech Republic — 2-Year Resident Card/);
      await page.getByLabel(/Earliest Possible Travel Date/).fill("2026-12-01");

      await page.getByLabel("We understand the payment plan above.").check();

      // The partner form has no contact-channel field (the partner is the
      // candidate's point of contact).

      // Current location is the full world-country list now (2026-07-31),
      // not Vertex's admin-managed source-market Country rows — "E2E
      // Country" (a fixture-only row from global-setup.ts) no longer
      // appears here, so pick a real country instead.
      await pickOption(page, page.getByLabel(/Current Location \(country\)/), "Kenya");

      const PDF_BUFFER = Buffer.from("%PDF-1.4 test file content");
      await page.getByTestId("partner-doc-checkbox-passport").check();
      await page.getByTestId("upload-passport-input").setInputFiles({ name: "passport.pdf", mimeType: "application/pdf", buffer: PDF_BUFFER });
      await page.getByTestId("partner-doc-checkbox-passport_photo").check();
      await page.getByTestId("upload-passport_photo-input").setInputFiles({ name: "passport-photo.pdf", mimeType: "application/pdf", buffer: PDF_BUFFER });

      await page.locator("form").getByRole("button", { name: "Submit Candidate" }).click();

      // The modal closes as soon as the submission succeeds (onSubmitted
      // fires synchronously), so the form's own "Submitted!" success state
      // never stays visible long enough to assert on — the real signal is
      // the new row appearing in the underlying list below.
      await expect(page.getByText(candidateName)).toBeVisible({ timeout: 25_000 });
    });

    await test.step("the candidate shows up on the partner's own list", async () => {
      const row = page.locator("tr", { hasText: candidateName });
      await expect(row).toBeVisible({ timeout: 25_000 });
      await expect(row.getByText(/^submitted$/i)).toBeVisible();
    });
  });
});
