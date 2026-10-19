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

// The Czech Republic — 2-Year Resident Card programme's first seeded position.
async function pickCzechPosition(page: Page) {
  await pickOption(page, page.locator("#selected_country"), "Czech Republic");
  await pickOption(page, page.locator("#sector"), "General / Unskilled");
  await pickOption(page, page.locator("#job_position_id"), /^General Unskilled Worker — Prague$/);
}

const PASSWORD = "E2ETestPassword123!";
const PDF_BUFFER = Buffer.from("%PDF-1.4\n%%EOF");

// Full agent-network pre-application lifecycle (SRS FR-2.1 through FR-2.7),
// re-sequenced around the Candidate Information Form (CIF): the CIF is the
// first thing anyone fills in (here, a recruiter on a walk-in lead's
// behalf) — screening is evaluated against the CIF itself, not documents or
// an account, since neither exists yet. Only after screening passes does
// the candidate get invited to create an account and upload documents
// themselves, which is what actually advances them to "submitted".
test.describe("Candidate pre-application lifecycle (Phase 2)", () => {
  test("CIF submission through screening, account creation, document upload, to supervisor verification", async ({ page }) => {
    const candidateName = `E2E Lead ${Date.now()}`;
    const candidateEmail = `e2e-lead-${Date.now()}@test.local`;

    await test.step("recruiter submits the Candidate Information Form for a walk-in lead", async () => {
      await login(page, "e2e-recruiter@test.local", PASSWORD);
      await expect(page).toHaveURL(/\/recruiter$/);

      await page.getByRole("button", { name: "Register Candidate" }).click();
      await page.getByLabel("Full Name (as per passport)").fill(candidateName);
      await page.getByLabel("Date of Birth").fill("1995-06-15");
      // Plain "Nationality" would also substring-match "Second Nationality
      // (if any)" — target the input by id instead. Nationality is a
      // SearchableSelect (full world-country list) now, not a free-text
      // input, so pick the option rather than filling text.
      await pickOption(page, page.locator("#gender"), /^Male$/);
      await pickOption(page, page.locator("#nationality"), "Kenya");
      await page.getByLabel("Passport Number").fill("P" + Date.now());
      await page.getByLabel(/Passport Expiry Date/).fill("2030-01-01");
      await page.getByLabel(/Phone Number/).fill("+254700111222");
      await page.getByLabel("Email Address").fill(candidateEmail);

      // Section 1 is cascading Country → Sector → Position pickers. Jobs
      // and their positions are seeded reference data (prisma/seed.ts);
      // most seeded destination countries (Belarus, Poland, etc.) carry
      // extra CountryDocumentRequirement rows beyond the universal
      // cv/passport/passport_photo set — Czech Republic is one of the
      // seeded destinations with none, so document-completeness (and the
      // auto-advance to "submitted" it drives) only depends on the 3
      // universal uploads this test actually performs.
      await pickCzechPosition(page);
      await page.getByLabel("Earliest Possible Travel Date").fill("2026-12-01");
      // "E2E Country" (global-setup fixture) is also e2e-recruiter/
      // e2e-supervisor's assigned territory, so the candidate lands in the
      // supervisor's scope. Current Location now offers the full
      // world-country list (lib/worldCountries.ts) plus any of Vertex's own
      // admin-managed countries not already on it — "E2E Country" falls
      // into that second group, so pick it by name, not position.
      await pickOption(page, page.getByLabel("Current Location (country)"), "E2E Country");
      await page.getByLabel("I understand the payment plan above.").check();
      // Preferred contact channel is mandatory now.
      await pickOption(page, page.getByLabel(/Preferred contact channel/), "Email");
      // Passport and passport-size photo must be attached in the form itself
      // before Submit unlocks (ApplicationForm REQUIRED_UPLOAD_TYPES).
      for (const [label, key] of [["Passport Copy — first page", "passport"], ["Passport-Size Photos", "passport_photo"]] as const) {
        await page.getByLabel(label).check();
        await page.getByTestId(`cif-doc-${key}-input`).setInputFiles({ name: `${key}.pdf`, mimeType: "application/pdf", buffer: PDF_BUFFER });
      }
      await page.getByLabel("I confirm the above.").check();
      await page.getByRole("button", { name: "Submit Application" }).click();

      await expect(page.getByText(candidateName)).toBeVisible({ timeout: 25_000 });
      await expect(page.getByText(/^identified$/i).first()).toBeVisible();
    });

    await test.step("recruiter advances to screened; the gate passes since the CIF was complete", async () => {
      await page.getByRole("link", { name: candidateName }).click();
      await page.waitForURL(/\/recruiter\/candidates\/.+/);
      await page.getByRole("button", { name: /Advance to Screened/ }).click();
      await expect(page.getByText(/^screened$/i).first()).toBeVisible({ timeout: 25_000 });

      // guided_to_apply is system-only now — fired when the candidate
      // claims their invite, not a manual recruiter action.
      await expect(page.getByRole("button", { name: /Advance to Guided to Apply/ })).toHaveCount(0);
      await expect(page.getByText("Awaiting candidate to create an account")).toBeVisible();
    });

    await test.step("candidate claims their invite and creates an account (simulated — no SMTP in dev, same pattern as global-setup's other fixtures)", async () => {
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

      // Document upload lives on its own tab now (candidate dashboard
      // rebuilt on PortalShell, 2026-07-13), not the Overview landing page.
      await page.goto("/dashboard/documents");

      await page.getByTestId("upload-cv-input").setInputFiles({ name: "cv.pdf", mimeType: "application/pdf", buffer: PDF_BUFFER });
      await expect(page.getByText("Uploaded CV / Resume")).toBeVisible({ timeout: 25_000 });

      await page.getByTestId("upload-passport-input").setInputFiles({ name: "passport.pdf", mimeType: "application/pdf", buffer: PDF_BUFFER });
      await expect(page.getByText(/Uploaded Passport Copy/)).toBeVisible({ timeout: 25_000 });

      await page.getByTestId("upload-passport_photo-input").setInputFiles({ name: "photo.pdf", mimeType: "application/pdf", buffer: PDF_BUFFER });
      await expect(page.getByText(/Uploaded Passport-Size Photos/)).toBeVisible({ timeout: 25_000 });
    });

    await test.step("recruiter sees the candidate is submitted and reports them to their supervisor", async () => {
      await logout(page);
      await login(page, "e2e-recruiter@test.local", PASSWORD);
      await expect(page).toHaveURL(/\/recruiter$/);

      await expect(page.getByText(/^submitted$/i).first()).toBeVisible({ timeout: 25_000 });
      await page.getByRole("link", { name: candidateName }).click();
      await page.waitForURL(/\/recruiter\/candidates\/.+/);
      await page.getByRole("button", { name: /Advance to Reported/ }).click();
      await expect(page.getByText(/^reported$/i).first()).toBeVisible();
      await expect(page.getByText("Awaiting supervisor action")).toBeVisible();
    });

    await test.step("supervisor returns the candidate with a reason (without undoing the real submission already on file)", async () => {
      await logout(page);
      await login(page, "e2e-supervisor@test.local", PASSWORD);
      await expect(page).toHaveURL(/\/supervisor$/);

      await page.getByRole("link", { name: "Candidates", exact: true }).click();
      await page.waitForURL(/\/supervisor\/candidates$/);
      await page.getByRole("link", { name: candidateName }).click();
      await page.waitForURL(/\/supervisor\/candidates\/.+/);

      await page.getByRole("button", { name: "Return" }).click();
      await pickOption(page, page.getByRole("combobox"), "Return to Submitted");
      await page.getByPlaceholder("Reason for return (required)…").fill("Please double-check the passport number.");
      await page.getByRole("button", { name: "Confirm Return" }).click();

      await expect(page.getByText(/^submitted$/i).first()).toBeVisible({ timeout: 25_000 });
      await expect(page.getByText(/Please double-check the passport number/)).toBeVisible();
    });

    await test.step("recruiter re-reports; supervisor verifies", async () => {
      await logout(page);
      await login(page, "e2e-recruiter@test.local", PASSWORD);

      await page.getByRole("link", { name: candidateName }).click();
      await page.waitForURL(/\/recruiter\/candidates\/.+/);
      await page.getByRole("button", { name: /Advance to Reported/ }).click();
      await expect(page.getByText(/^reported$/i).first()).toBeVisible();

      await logout(page);
      await login(page, "e2e-supervisor@test.local", PASSWORD);

      await page.getByRole("link", { name: "Candidates", exact: true }).click();
      await page.waitForURL(/\/supervisor\/candidates$/);
      await page.getByRole("link", { name: candidateName }).click();
      await page.waitForURL(/\/supervisor\/candidates\/.+/);

      // Scoped to the Lifecycle status card specifically — CandidateDetail
      // also renders a per-document "Verify" button (DocumentVerifyControls,
      // for the supervisor's document pre-approval step) for each pending
      // document, which an unscoped locator would collide with.
      const lifecycleStatusCard = page.locator(".card", { hasText: "Lifecycle status" });
      await lifecycleStatusCard.getByRole("button", { name: "Verify", exact: true }).click();
      await expect(page.getByText(/^verified$/i).first()).toBeVisible({ timeout: 25_000 });

      // Country Supervisor's ceiling is "Verified" — "Approved" is a
      // distinct, higher tier (Regional Supervisory Operational Workflow
      // p.5: "Approved by In-House"), so no approve action is offered here.
      await expect(page.getByRole("button", { name: "Approve", exact: true })).toHaveCount(0);
      await expect(page.getByText("Awaiting In-House approval")).toBeVisible();
    });

    await test.step("only In-House can approve", async () => {
      await logout(page);
      await login(page, "e2e-inhouse@test.local", PASSWORD);
      await expect(page).toHaveURL(/\/inhouse$/);

      // In-House's candidate list links out to the dedicated detail page
      // (basePath set on CandidateList) rather than rendering inline
      // status controls in the table row.
      await page.getByRole("link", { name: "Candidates", exact: true }).click();
      await page.waitForURL(/\/inhouse\/candidates$/);
      await page.getByRole("link", { name: candidateName }).click();
      await page.waitForURL(/\/inhouse\/candidates\/.+/);

      await page.getByRole("button", { name: "Create Case", exact: true }).click();
      await expect(page.getByText("Case Created", { exact: true }).first()).toBeVisible({ timeout: 25_000 });
    });
  });
});
