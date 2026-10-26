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

test.describe("Next.js -> FastAPI (regions and countries, step 2.1)", () => {
  test("an admin creates, renames, moves and deletes through the website", async ({ page }) => {
    const tag = Date.now().toString(36);
    const created = await page.request.post("/api/admin/regions", { data: { name: `E2E Region ${tag}` } });
    expect(created.status()).toBe(201);
    const { data: region } = await created.json();

    const other = (await (await page.request.post("/api/admin/regions", { data: { name: `E2E Other ${tag}` } })).json()).data;
    const added = await page.request.post("/api/admin/countries", { data: { name: `E2E Land ${tag}`, region_id: region.id } });
    expect(added.status()).toBe(201);
    const { data: country } = await added.json();

    expect((await page.request.patch(`/api/admin/regions/${region.id}`, { data: { name: `E2E Renamed ${tag}` } })).status()).toBe(200);
    const moved = await page.request.patch(`/api/admin/countries/${country.id}`, { data: { region_id: other.id } });
    expect((await moved.json()).data.region_id).toBe(other.id);

    const listed = (await (await page.request.get("/api/admin/countries")).json()).data;
    expect(listed.find((c: { id: string }) => c.id === country.id).region).toEqual({ id: other.id, name: `E2E Other ${tag}` });
    const regions = (await (await page.request.get("/api/admin/regions")).json()).data;
    expect(regions.find((r: { id: string }) => r.id === region.id).name).toBe(`E2E Renamed ${tag}`);

    const dup = await page.request.post("/api/admin/countries", { data: { name: `E2E Land ${tag}`, region_id: region.id } });
    expect(dup.status()).toBe(409);
    expect((await dup.json()).error.code).toBe("duplicate");

    expect((await page.request.delete(`/api/admin/countries/${country.id}`)).status()).toBe(200);
    expect((await page.request.delete(`/api/admin/countries/${country.id}`)).status()).toBe(404);
  });

  test("the admin Regions page lists FastAPI's regions", async ({ page }) => {
    const name = `E2E Page Region ${Date.now().toString(36)}`;
    await page.request.post("/api/admin/regions", { data: { name } });
    await page.goto("/admin/regions");
    await expect(page.getByText(name)).toBeVisible();
  });
});

test.describe("Next.js -> FastAPI (sectors and document requirements, step 2.2)", () => {
  test("an admin manages sectors and a country's required documents through the website", async ({ page }) => {
    const tag = Date.now().toString(36);
    const created = await page.request.post("/api/admin/sectors", { data: { name: `E2E Sector ${tag}` } });
    expect(created.status()).toBe(201);
    const { data: sector } = await created.json();
    const sectors = (await (await page.request.get("/api/admin/sectors")).json()).data;
    expect(sectors.map((s: { id: string }) => s.id)).toContain(sector.id);
    expect((await page.request.delete(`/api/admin/sectors/${sector.id}`)).status()).toBe(200);

    // Document types stay with the website until jobs move (step 3).
    const types = (await (await page.request.get("/api/admin/document-types")).json()).data.slice(0, 2).map((t: { key: string }) => t.key);
    const region = (await (await page.request.post("/api/admin/regions", { data: { name: `E2E Docs Region ${tag}` } })).json()).data;
    const country = (await (await page.request.post("/api/admin/countries", { data: { name: `E2E Docs Land ${tag}`, region_id: region.id } })).json()).data;

    const put = await page.request.put(`/api/admin/countries/${country.id}/document-requirements`, { data: { document_types: types } });
    expect(put.status()).toBe(200);
    const listed = (await (await page.request.get(`/api/admin/countries/${country.id}/document-requirements`)).json()).data;
    expect(listed.map((r: { document_type: string }) => r.document_type).sort()).toEqual([...types].sort());

    const bad = await page.request.put(`/api/admin/countries/${country.id}/document-requirements`, { data: { document_types: ["no_such_type"] } });
    expect(bad.status()).toBe(422);
    expect((await bad.json()).error.code).toBe("unknown_type");
  });

  test("the admin Sectors page shows FastAPI's sectors", async ({ page }) => {
    const name = `E2E Page Sector ${Date.now().toString(36)}`;
    await page.request.post("/api/admin/sectors", { data: { name } });
    await page.goto("/admin/sectors");
    await expect(page.getByText(name)).toBeVisible();
  });
});

test.describe("Next.js -> FastAPI (system settings, step 2.3)", () => {
  // intake_mode stays "crm" (global-setup.ts sets it; self-application.spec.ts
  // relies on it), so these tests only ever write that value.
  test("an admin saves settings through the website and the readers see them", async ({ page }) => {
    const number = `+251${Date.now().toString().slice(-9)}`;
    const saved = await page.request.put("/api/admin/settings", { data: { whatsapp_number: number, intake_mode: "crm" } });
    expect(saved.status()).toBe(200);
    expect(await saved.json()).toEqual({ success: true });

    const read = await (await page.request.get("/api/admin/settings")).json();
    expect(read).toMatchObject({ whatsapp_number: number, intake_mode: "crm" });
    expect((await (await page.request.get("/api/apply/options")).json()).intakeMode).toBe("crm");

    const bad = await page.request.put("/api/admin/settings", { data: { intake_mode: "fax" } });
    expect(bad.status()).toBe(400);
    expect((await (await page.request.get("/api/admin/settings")).json()).intake_mode).toBe("crm");
  });

  test("the admin Settings page shows FastAPI's settings", async ({ page }) => {
    const number = `+251${Date.now().toString().slice(-9)}`;
    await page.request.put("/api/admin/settings", { data: { whatsapp_number: number } });
    await page.goto("/admin/settings");
    await expect(page.getByPlaceholder("+1234567890")).toHaveValue(number);
  });
});
