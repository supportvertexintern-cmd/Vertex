import { test, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { dbFixture } from "./db-fixture";
import { signAs } from "../src/lib/test-tokens";

// The partner-management stories (the QA, Security & Implementation Guide,
// section 10; upstream staging's tests/e2e-security/journeys.spec.ts), through
// the real UI wherever there is one. One serial story: a manager brings on a
// new VA, Vera, and hands her the unassigned partner (upstream's "Kebede",
// here E2E Other VA Agency); she works the partner; a submission from it,
// approved by HR, becomes a commission the manager approves and pays; then
// deactivating Vera hands the partner back. The manager is the e2e admin
// (upstream's Michael is a director: the same partner-manager powers).
// Each test name carries its stories (tools/traceability.py).

const PASSWORD = "E2ETestPassword123!";
const stamp = Date.now().toString(36);
const VERA = { name: `E2E Vera ${stamp}`, email: `e2e-vera-${stamp}@test.local`, password: "VeraJourney123!" };
const KEBEDE = "E2E Other VA Agency"; // unassigned until the story assigns it
const SARAH_AGENCY = "E2E VA Agency"; // the e2e VA's own
const CANDIDATE = `E2E Journey Candidate ${stamp}`;

test.describe.configure({ mode: "serial" });

let manager: BrowserContext;
let vera: BrowserContext;
let mPage: Page;
let vPage: Page;
let veraId = "";
let kebedeId = "";

async function signedIn(browser: Browser, email: string, password = PASSWORD): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  // Off-site scripts and fonts are blocked: the story depends only on Vertex.
  await context.route(/^https?:\/\/(?!localhost[:/]|127\.0\.0\.1[:/])/, (route) => route.abort());
  const page = await context.newPage();
  await page.addInitScript(() => window.localStorage.setItem("vertex_welcome_accepted", "true"));
  await page.goto("/auth/login");
  await page.fill("#login-email", email);
  await page.fill("#login-password", password);
  await page.click("#login-submit-btn");
  await page.waitForURL((url) => !url.pathname.startsWith("/auth/login"), { timeout: 25_000 });
  return { context, page };
}

test.beforeAll(async ({ browser }) => {
  ({ context: manager, page: mPage } = await signedIn(browser, "e2e-admin@test.local"));
  kebedeId = dbFixture<{ id: string }>("partner", KEBEDE).id;
});

test.afterAll(async () => {
  await manager?.close();
  await vera?.close();
});

test("FUNC-US01 the manager creates a VA account from VA Team", async () => {
  await mPage.goto("/management/va-team");
  await mPage.getByPlaceholder("Full name").fill(VERA.name);
  await mPage.getByPlaceholder("Email address").fill(VERA.email);
  await mPage.getByRole("button", { name: "Create VA account" }).click();
  const row = mPage.getByRole("row", { name: new RegExp(VERA.name) });
  await expect(row.getByText("Awaiting invite")).toBeVisible({ timeout: 25_000 });
  veraId = dbFixture<{ id: string }>("user-id", VERA.email).id;
  expect(veraId).toBeTruthy();
});

test("FUNC-US02 the new VA sets her password from the invite and lands on her empty portal", async ({ browser }) => {
  // The invite isn't emailed here (no inbox in CI); its link is signed the way FastAPI signs it.
  const setup = signAs("account_setup", { userId: veraId, type: "account_setup" }, "7d");
  const fresh = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  const page = await fresh.newPage();
  await page.goto(`/auth/register?setup=${encodeURIComponent(setup)}`);
  await page.fill("#reg-password", VERA.password);
  await page.fill("#reg-confirm-password", VERA.password);
  await page.click("#register-submit-btn");
  await expect(page.getByText("You're All Set")).toBeVisible({ timeout: 25_000 });
  await fresh.close();

  ({ context: vera, page: vPage } = await signedIn(browser, VERA.email, VERA.password));
  await expect(vPage).toHaveURL(/\/va$/);
  await vPage.goto("/va/partners");
  await expect(vPage.getByText("No partners found.")).toBeVisible({ timeout: 25_000 });
  await mPage.goto("/management/va-team");
  await expect(mPage.getByRole("row", { name: new RegExp(VERA.name) }).getByText("Active")).toBeVisible({ timeout: 25_000 });
});

test("FUNC-US03 the manager assigns the unassigned partner to the new VA", async () => {
  await mPage.goto(`/management/partners/${kebedeId}`);
  await mPage.locator("#assigned-va").click();
  await mPage.getByRole("option", { name: VERA.name }).click();
  await expect.poll(() => dbFixture<{ assigned_team_member_id: string | null }>("partner", KEBEDE).assigned_team_member_id).toBe(veraId);
  await vPage.goto("/va/partners");
  await expect(vPage.getByRole("link", { name: KEBEDE })).toBeVisible({ timeout: 25_000 });
  await expect(vPage.getByText(SARAH_AGENCY, { exact: true })).toHaveCount(0); // another VA's partner stays hidden
});

test("FUNC-US04..07 the VA works the partner: read-only onboarding, a report, a follow-up", async () => {
  await vPage.goto(`/va/partners/${kebedeId}`);
  await expect(vPage.getByText("Partner tracking")).toBeVisible({ timeout: 25_000 });
  // Onboarding is the manager's to change.
  await expect(vPage.getByRole("button", { name: /Mark documents submitted|Mark as not submitted/ })).toHaveCount(0);
  await expect(vPage.locator("#assigned-va")).toHaveCount(0);

  await vPage.getByPlaceholder("Report notes / content…").fill(`Journey report ${stamp}`);
  await vPage.getByRole("button", { name: "Record report" }).click();
  await expect(vPage.getByText("Report recorded.")).toBeVisible({ timeout: 25_000 });
  const report = vPage.locator("div.rounded-lg", { hasText: `Journey report ${stamp}` });
  await report.locator("select").selectOption("closed");
  await expect(vPage.getByText("Report status updated.")).toBeVisible({ timeout: 25_000 });

  await vPage.getByPlaceholder(/Action required/).fill(`Journey follow-up ${stamp}`);
  await vPage.getByLabel("Follow-up due date").fill("2027-02-01");
  await vPage.getByRole("button", { name: "Add" }).click();
  const followUp = vPage.locator("div.rounded-lg", { hasText: `Journey follow-up ${stamp}` });
  await expect(followUp.getByText(/Due /)).toBeVisible({ timeout: 25_000 });
  await followUp.getByRole("button", { name: "Complete" }).click();
  await expect(followUp.getByText("done")).toBeVisible({ timeout: 25_000 });
  // The partner's history names who did it.
  await expect(vPage.getByText("Created report").first()).toBeVisible();
});

let submissionId = "";

test("FUNC-US08 a submission from the partner shows in the VA's candidate tracking", async () => {
  submissionId = dbFixture<{ submission_id: string }>("bridged-submission", KEBEDE, CANDIDATE).submission_id;
  await vPage.goto(`/va/partners/${kebedeId}`);
  const registered = vPage.locator(".card", { hasText: "Registered" }).first();
  await expect(registered).toContainText("1", { timeout: 25_000 });
});

test("FUNC-US09..11, US27 HR approval earns a USD 10 commission and fee; the manager approves and pays it", async ({ browser }) => {
  const { context: hr } = await signedIn(browser, "e2e-hr@test.local");
  const approve = await hr.request.patch(`/api/partner-candidates/${submissionId}/create-case`, { data: {} });
  expect(approve.status(), await approve.text()).toBeLessThan(300);
  await hr.close();

  const recorded = dbFixture<{ commissions: { id: string; rule_type: string; amount: number; status: string }[]; fees: { fee_type: string; amount: number }[] }>("ledger", CANDIDATE);
  const [registration] = recorded.commissions.filter((c) => c.rule_type === "registration");
  expect([registration.amount, registration.status]).toEqual([10, "pending"]);
  expect(recorded.fees).toEqual([{ fee_type: "application", amount: 10 }]);

  await mPage.goto("/management/partner-commissions");
  const row = mPage.getByRole("row", { name: new RegExp(CANDIDATE) });
  await row.getByRole("button", { name: "Approve" }).click();
  await row.getByRole("button", { name: "Mark Paid" }).click();
  const managerId = dbFixture<{ id: string }>("user-id", "e2e-admin@test.local").id;
  await expect.poll(() => dbFixture<{ commissions: { status: string }[] }>("ledger", CANDIDATE).commissions[0].status).toBe("paid");
  const paid = dbFixture<{ commissions: { approved_by: string; paid_by: string }[] }>("ledger", CANDIDATE).commissions[0];
  expect([paid.approved_by, paid.paid_by]).toEqual([managerId, managerId]);

  // The VA sees her partner, not its money: she can't move it.
  expect((await vera.request.post(`/api/admin/partner-commissions/${registration.id}/approve`)).status()).toBe(403);
  await mPage.goto("/management/admin-fees");
  await expect(mPage.getByRole("row", { name: new RegExp(CANDIDATE) })).toBeVisible({ timeout: 25_000 });
  // US-27: the partner's statement shows the paid registration.
  await mPage.goto(`/management/partners/${kebedeId}`);
  await expect(mPage.getByText("Commission statement")).toBeVisible({ timeout: 25_000 });
  await expect(mPage.getByText(CANDIDATE).first()).toBeVisible();
});

test("FUNC-US03 deactivating the VA hands the partner back and ends her session", async () => {
  await mPage.goto("/management/va-team");
  const row = mPage.getByRole("row", { name: new RegExp(VERA.name) });
  await row.getByRole("button", { name: "Deactivate" }).click();
  await row.getByRole("button", { name: "Confirm deactivate" }).click();
  await expect(mPage.getByText(/VA deactivated/)).toBeVisible({ timeout: 25_000 });
  expect(dbFixture<{ assigned_team_member_id: string | null }>("partner", KEBEDE).assigned_team_member_id).toBeNull();
  expect((await vera.request.get("/api/va/partners")).status()).toBe(401);
});
