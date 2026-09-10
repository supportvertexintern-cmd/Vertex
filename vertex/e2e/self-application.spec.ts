import { test, expect, type Page, type Locator } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

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
const PDF_BUFFER = Buffer.from("%PDF-1.4\n%%EOF");

// Self-submission routing (2026-07-31): a public website submission at
// /apply, with no recruiter/partner involved, now goes straight to HR
// instead of being farmed out to whichever recruiter covers the
// candidate's country. HR owns the whole pipeline end-to-end — no
// country_supervisor/inhouse_supervisor step at all — approving twice:
// once for account creation (screening gate, identified→screened), and
// again once the candidate has completed their own documentation
// (submitted→approved), which is what actually opens the Case.
test.describe("Self-submission routing to HR (2026-07-31)", () => {
  test("anonymous CIF submission through HR screening, account creation, document upload, to HR approval and Case creation", async ({ page }) => {
    const candidateName = `E2E Self App ${Date.now()}`;
    const candidateEmail = `e2e-self-app-${Date.now()}@test.local`;

    await test.step("anonymous visitor submits the Candidate Information Form at /apply", async () => {
      await page.goto("/apply");
      await page.getByLabel("Full Name (as per passport)").fill(candidateName);
      await page.getByLabel("Date of Birth").fill("1995-06-15");
      await pickOption(page, page.locator("#nationality"), "Kenya");
      await page.getByLabel("Passport Number").fill("P" + Date.now());
      await page.getByLabel(/Passport Expiry Date/).fill("2030-01-01");
      await page.getByLabel(/Phone Number/).fill("+254700111222");
      await page.getByLabel("Email Address").fill(candidateEmail);

      // Czech Republic carries no extra CountryDocumentRequirement rows
      // beyond the universal cv/passport/passport_photo set — same
      // opportunity used in candidate-lifecycle.spec.ts and
      // partner-crm.spec.ts, so document-completeness only depends on the
      // 3 universal uploads this test performs. "2-Year Resident Card" is
      // the one surviving Czech Republic programme in the 2026 pricing
      // revision (2026-07-31) — the old seasonal permits it used to be
      // (3/6/9-month) were retired.
      await pickOption(page, page.getByLabel("Opportunity"), /Czech Republic — 2-Year Resident Card/);
      await page.getByLabel("Earliest Possible Travel Date").fill("2026-12-01");
      await pickOption(page, page.getByLabel("Current Location (country)"), "Kenya");
      await page.getByLabel("I understand the payment plan above.").check();
      await pickOption(page, page.getByLabel(/Preferred contact channel/), "Email");
      await page.getByLabel("I confirm the above.").check();
      await page.getByRole("button", { name: "Submit Application" }).click();

      await expect(page.getByText("Submitted!")).toBeVisible({ timeout: 25_000 });
    });

    await test.step("the candidate lands in HR's Self Applications queue — not any recruiter's — with no recruiter assigned", async () => {
      const candidate = await prisma.candidate.findFirstOrThrow({ where: { full_name: candidateName } });
      expect(candidate.source).toBe("self_registered");
      expect(candidate.recruiter_id).toBeNull();
      expect(candidate.lifecycle_status).toBe("identified");
    });

    await test.step("HR approves the candidate for account creation; the screening gate passes since the CIF was complete", async () => {
      await login(page, "e2e-hr@test.local", PASSWORD);
      await expect(page).toHaveURL(/\/hr$/);

      await page.getByRole("link", { name: "Self Applications", exact: true }).click();
      await page.waitForURL(/\/hr\/self-applications$/);
      await page.getByRole("link", { name: candidateName }).click();
      await page.waitForURL(/\/hr\/self-applications\/.+/);

      await page.getByRole("button", { name: "Approve for Account Creation" }).click();
      await expect(page.getByText("screened", { exact: true })).toBeVisible({ timeout: 25_000 });
      await expect(page.getByText("Awaiting candidate to create an account")).toBeVisible();

      // HR's skip-ahead widget offers no further action until the
      // candidate has actually submitted their documents.
      await expect(page.getByRole("button", { name: "Approve", exact: true })).toHaveCount(0);
    });

    await test.step("candidate claims their invite and creates an account (simulated — no SMTP in dev, same pattern as candidate-lifecycle.spec.ts)", async () => {
      const candidate = await prisma.candidate.findFirstOrThrow({ where: { full_name: candidateName } });
      const password_hash = await bcrypt.hash(PASSWORD, 12);
      const user = await prisma.user.create({
        data: { full_name: candidateName, email: candidateEmail, password_hash, role: "candidate", email_verified: true },
      });
      await prisma.candidate.update({
        where: { id: candidate.id },
        data: { user_id: user.id, lifecycle_status: "guided_to_apply" },
      });
    });

    await test.step("candidate logs in, uploads required documents, and auto-advances to submitted", async () => {
      await logout(page);
      await login(page, candidateEmail, PASSWORD);
      await expect(page).toHaveURL(/\/dashboard$/);

      await page.goto("/dashboard/documents");

      await page.getByTestId("upload-cv-input").setInputFiles({ name: "cv.pdf", mimeType: "application/pdf", buffer: PDF_BUFFER });
      await expect(page.getByText("Uploaded CV / Resume")).toBeVisible({ timeout: 25_000 });

      await page.getByTestId("upload-passport-input").setInputFiles({ name: "passport.pdf", mimeType: "application/pdf", buffer: PDF_BUFFER });
      await expect(page.getByText(/Uploaded Passport Copy/)).toBeVisible({ timeout: 25_000 });

      await page.getByTestId("upload-passport_photo-input").setInputFiles({ name: "photo.pdf", mimeType: "application/pdf", buffer: PDF_BUFFER });
      await expect(page.getByText(/Uploaded Passport-Size Photos/)).toBeVisible({ timeout: 25_000 });
    });

    await test.step("the Self Applications dashboard now shows the candidate as ready for HR's approval (2026-07-31: previously HR had no way to tell a candidate had come back from screening)", async () => {
      await logout(page);
      await login(page, "e2e-hr@test.local", PASSWORD);
      await expect(page).toHaveURL(/\/hr$/);

      await page.getByRole("link", { name: "Self Applications", exact: true }).click();
      await page.waitForURL(/\/hr\/self-applications$/);

      await expect(page.getByText(/submitted their documents — ready for your approval/)).toBeVisible({ timeout: 25_000 });
      const candidateRow = page.locator("tr", { hasText: candidateName });
      await expect(candidateRow.getByText("Ready for your approval")).toBeVisible();
    });

    await test.step("HR approves again once submitted, opening a Case — no country_supervisor/inhouse_supervisor step involved anywhere in this pipeline", async () => {
      await page.getByRole("link", { name: candidateName }).click();
      await page.waitForURL(/\/hr\/self-applications\/.+/);

      await expect(page.getByText("submitted", { exact: true })).toBeVisible({ timeout: 25_000 });
      await page.getByRole("button", { name: "Approve", exact: true }).click();
      await expect(page.getByText("approved", { exact: true })).toBeVisible({ timeout: 25_000 });
      await expect(page.getByRole("link", { name: "View Case" })).toBeVisible({ timeout: 25_000 });

      const candidate = await prisma.candidate.findFirstOrThrow({ where: { full_name: candidateName } });
      const caseRow = await prisma.case.findFirst({ where: { application: { candidate_id: candidate.id } } });
      expect(caseRow).not.toBeNull();
    });
  });
});
