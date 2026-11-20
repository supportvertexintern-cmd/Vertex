import { test, expect, type Page } from "@playwright/test";

// The browser-facing security controls (the QA, Security & Implementation
// Guide; upstream staging's tests/e2e-security), against the production
// build: another site can't act or read as a signed-in user, one user's
// answers are never cached for another, and the build publishes no source
// maps. Each test name carries the guide's IDs (tools/traceability.py).

const PASSWORD = "E2ETestPassword123!";
const ATTACKER = "http://attacker.test";

async function signIn(page: Page, email: string) {
  await page.addInitScript(() => window.localStorage.setItem("vertex_welcome_accepted", "true"));
  await page.goto("/auth/login");
  await page.fill("#login-email", email);
  await page.fill("#login-password", PASSWORD);
  await page.click("#login-submit-btn");
  await page.waitForURL((url) => !url.pathname.startsWith("/auth/login"), { timeout: 25_000 });
}

test("SEC-WEB-001 a hidden auto-submitting form on another site arrives without the session", async ({ page, baseURL }) => {
  await signIn(page, "e2e-va@test.local");
  expect((await page.request.get("/api/auth/me")).status()).toBe(200); // signed in, here
  // The attacker's page, on another site, posts to the API as soon as it loads.
  await page.route(`${ATTACKER}/**`, (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<form id="f" method="POST" action="${baseURL}/api/partner-follow-ups" enctype="text/plain">
               <input name='{"partner_id":"x","action":"planted","pad":"' value='"}'></form>
             <script>document.getElementById("f").submit()</script>`,
    })
  );
  const answered = page.waitForResponse((res) => res.url().endsWith("/api/partner-follow-ups"));
  await page.goto(`${ATTACKER}/`);
  // SameSite=Strict: a cross-site request carries no session cookie, so it's refused as anonymous.
  expect((await answered).status()).toBe(401);
});

test("SEC-WEB-004 SEC-WEB-005 SEC-WEB-002 SEC-WEB-010 another site, or Origin: null, can't read the API", async ({ page }) => {
  await signIn(page, "e2e-va@test.local");
  for (const origin of [ATTACKER, "null"]) {
    const read = await page.request.get("/api/auth/me", { headers: { Origin: origin } });
    expect(read.headers()["access-control-allow-origin"]).toBeUndefined();
    expect(read.headers()["access-control-allow-credentials"]).toBeUndefined();
    const preflight = await page.request.fetch("/api/partner-follow-ups", {
      method: "OPTIONS",
      headers: { Origin: origin, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type" },
    });
    expect(preflight.headers()["access-control-allow-origin"]).toBeUndefined();
  }
});

test("SEC-NEXT-007 SEC-NEXT-008 one user's answers are never cached for another", async ({ browser, baseURL }) => {
  const people = ["e2e-va@test.local", "e2e-hr@test.local"];
  const seen: string[] = [];
  for (const email of people) {
    const context = await browser.newContext({ baseURL });
    const page = await context.newPage();
    await signIn(page, email);
    const me = await page.request.get("/api/auth/me");
    seen.push((await me.json()).data.email);
    // The browser and any shared cache in between are told not to keep it.
    expect(me.headers()["cache-control"] ?? "").toMatch(/no-store|private/);
    const portal = await page.request.get(email.startsWith("e2e-va") ? "/va" : "/hr");
    expect(portal.headers()["cache-control"] ?? "").toMatch(/no-store|private/);
    await context.close();
  }
  expect(seen).toEqual(people);
});

test("SEC-INF-006 the production build publishes no source maps", async ({ request }) => {
  const html = await (await request.get("/")).text();
  const scripts = [...html.matchAll(/src="(\/_next\/static\/[^"]+\.js)"/g)].map((m) => m[1]);
  expect(scripts.length).toBeGreaterThan(0);
  for (const src of scripts.slice(0, 5)) {
    expect((await request.get(src)).status()).toBe(200);
    expect((await request.get(`${src}.map`)).status()).toBe(404);
  }
});
