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

test.describe("Next.js -> FastAPI (knowledge articles and email templates, step 3.1)", () => {
  test("an admin manages articles and templates through the website", async ({ page }) => {
    const tag = Date.now().toString(36);
    const added = await page.request.post("/api/admin/knowledge", { data: { title: `E2E Article ${tag}`, content: "How it works." } });
    expect(added.status()).toBe(201);
    const article = await added.json();
    expect(article).toMatchObject({ title: `E2E Article ${tag}`, category: "General" });
    const listed = await (await page.request.get("/api/admin/knowledge")).json();
    expect(listed.map((a: { id: string }) => a.id)).toContain(article.id);
    expect((await page.request.post("/api/admin/knowledge", { data: { title: "No content" } })).status()).toBe(400);
    expect(await (await page.request.delete(`/api/admin/knowledge?id=${article.id}`)).json()).toEqual({ success: true });
    expect((await page.request.delete(`/api/admin/knowledge?id=${article.id}`)).status()).toBe(404);

    const event = `e2e_${tag}`;
    const saved = await page.request.put("/api/admin/emails", { data: { event, subject: "Hello", body_html: "<p>Hi</p>" } });
    expect(await saved.json()).toMatchObject({ event, subject: "Hello" });
    await page.request.put("/api/admin/emails", { data: { event, subject: "Hello again", body_html: "<p>Hi</p>" } });
    const templates = await (await page.request.get("/api/admin/emails")).json();
    expect(templates.find((t: { event: string }) => t.event === event).subject).toBe("Hello again");
  });

  test("the admin Settings page lists FastAPI's articles", async ({ page }) => {
    const title = `E2E Page Article ${Date.now().toString(36)}`;
    await page.request.post("/api/admin/knowledge", { data: { title, category: "E2E", content: "Shown on the page." } });
    await page.goto("/admin/settings");
    await expect(page.getByText(title)).toBeVisible();
  });
});

test.describe("Next.js -> FastAPI (jobs, payment stages and document types, step 3.2)", () => {
  const stages = [
    { order: 1, label: "At application", percent: 20, trigger_stage: "registration_document_submission" },
    { order: 2, label: "Permit approved", percent: 80, trigger_stage: "permit_authorization_approved" },
  ];
  const newJob = (tag: string) => ({
    title: `E2E Job ${tag}`,
    country: "Serbia",
    city: "Novi Sad",
    job_description: "Seasonal farm work on a family-run orchard, with housing provided.",
    requirements: "Two years of farm experience.",
    service_fee_gbp: 1000,
    payment_stages: stages,
  });

  test("an admin creates, edits and deletes a job through the website", async ({ page }) => {
    const tag = Date.now().toString(36);
    const created = await page.request.post("/api/jobs", { data: newJob(tag) });
    expect(created.status()).toBe(201);
    const job = await created.json();
    expect(job).toMatchObject({ title: `E2E Job ${tag}`, status: "active", service_fee_gbp: 1000 });

    // The public detail is still read by Next.js: it sees FastAPI's write.
    const detail = await (await page.request.get(`/api/jobs/${job.id}`)).json();
    const stageIds = detail.payment_stages.map((s: { id: string }) => s.id);
    expect(detail.payment_stages.map((s: { percent: number }) => s.percent)).toEqual([20, 80]);

    // Each stage has a receipt type to upload against.
    const types = (await (await page.request.get("/api/admin/document-types")).json()).data.map((t: { key: string }) => t.key);
    for (const id of stageIds) expect(types).toContain(`payment_receipt_stage_${id}`);

    // An edit keeps the stages in place.
    const edited = await page.request.put(`/api/jobs/${job.id}`, { data: { payment_stages: [{ ...stages[0], percent: 30 }, { ...stages[1], percent: 70 }] } });
    expect(edited.status()).toBe(200);
    const after = (await (await page.request.get(`/api/jobs/${job.id}`)).json()).payment_stages;
    expect(after.map((s: { id: string }) => s.id)).toEqual(stageIds);

    const bad = await page.request.put(`/api/jobs/${job.id}`, { data: { payment_stages: [{ ...stages[0], percent: 101 }] } });
    expect(bad.status()).toBe(422);
    const badBody = await bad.json();
    expect(badBody.error).toBe("Validation failed");
    expect(Object.keys(badBody.details)).toContain("payment_stages.0.percent");

    // Stripe isn't configured in the e2e environment.
    expect((await page.request.post(`/api/jobs/${job.id}/sync-stripe-pricing`)).status()).toBe(503);

    expect(await (await page.request.delete(`/api/jobs/${job.id}`)).json()).toEqual({ message: "Job deleted." });
    expect((await page.request.delete(`/api/jobs/${job.id}`)).status()).toBe(404);
  });

  test("an admin adds and removes a document type through the website", async ({ page }) => {
    const label = `E2E Doc ${Date.now().toString(36)}`;
    const created = await page.request.post("/api/admin/document-types", { data: { label } });
    expect(created.status()).toBe(201);
    const { data: docType } = await created.json();
    expect(docType.key).toBe(label.toLowerCase().replace(/[^a-z0-9]+/g, "_"));
    expect((await page.request.post("/api/admin/document-types", { data: { label } })).status()).toBe(409);
    expect((await page.request.delete(`/api/admin/document-types/${docType.id}`)).status()).toBe(200);
  });

  test("the marketing jobs page lists FastAPI's job", async ({ page }) => {
    const tag = Date.now().toString(36);
    await page.request.post("/api/jobs", { data: newJob(tag) });
    await page.goto("/marketing/jobs");
    await expect(page.getByText(`E2E Job ${tag}`)).toBeVisible();
  });
});

test.describe("Next.js -> FastAPI (a programme's sectors and positions, step 3.3)", () => {
  test("an admin attaches a sector and manages its positions through the website", async ({ page }) => {
    const tag = Date.now().toString(36);
    const job = await (
      await page.request.post("/api/jobs", {
        data: {
          title: `E2E Sector Job ${tag}`,
          country: "Italy",
          city: "Verona",
          job_description: "Seasonal grape harvest on a family vineyard, with housing provided.",
          requirements: "Able to work outdoors all day.",
        },
      })
    ).json();

    const attached = await page.request.post(`/api/jobs/${job.id}/sectors`, { data: { sector: "Agriculture" } });
    expect(attached.status()).toBe(201);
    const { data: sector } = await attached.json();
    expect(sector).toMatchObject({ job_id: job.id, sector: "Agriculture", positions: [] });
    expect((await page.request.post(`/api/jobs/${job.id}/sectors`, { data: { sector: "Agriculture" } })).status()).toBe(409);
    expect((await page.request.post(`/api/jobs/${job.id}/sectors`, { data: { sector: "Mining" } })).status()).toBe(422);

    const positions = `/api/jobs/${job.id}/sectors/${sector.id}/positions`;
    const { data: position } = await (await page.request.post(positions, { data: { title: "Grape Picker", city: "Verona" } })).json();
    const edited = await page.request.patch(`${positions}/${position.id}`, { data: { title: "Fruit Picker" } });
    expect((await edited.json()).data).toMatchObject({ title: "Fruit Picker", city: "Verona" });

    // The programme's detail, still read by Next.js, sees FastAPI's writes.
    const detail = await (await page.request.get(`/api/jobs/${job.id}`)).json();
    expect(JSON.stringify(detail)).toContain("Fruit Picker");

    expect((await page.request.delete(`/api/jobs/${job.id}/sectors/${sector.id}`)).status()).toBe(200);
    expect((await page.request.patch(`${positions}/${position.id}`, { data: { title: "Gone" } })).status()).toBe(404);
    await page.request.delete(`/api/jobs/${job.id}`);
  });
});

test.describe("Next.js -> FastAPI (employer clients, step 4.1)", () => {
  test("an admin adds and edits an employer client through the website", async ({ page }) => {
    const name = `E2E Employer ${Date.now().toString(36)}`;
    const client = { name, country: "Poland", contact_name: "Anna Nowak", contact_email: "anna@agro.test", contact_phone: "+48 600 000 000" };
    const created = await page.request.post("/api/admin/employer-clients", { data: client });
    expect(created.status()).toBe(201);
    const { data } = await created.json();
    expect(data).toMatchObject({ name, status: "active" });

    const bad = await page.request.post("/api/admin/employer-clients", { data: { ...client, contact_email: "nope" } });
    expect(bad.status()).toBe(422);
    expect(Object.keys((await bad.json()).error.details)).toEqual(["contact_email"]);

    const edited = await page.request.patch(`/api/admin/employer-clients/${data.id}`, { data: { status: "inactive" } });
    expect((await edited.json()).data.status).toBe("inactive");

    const listed = (await (await page.request.get("/api/admin/employer-clients")).json()).data;
    expect(listed.find((c: { id: string }) => c.id === data.id)._count).toEqual({ jobs: 0 });
    const detail = (await (await page.request.get(`/api/admin/employer-clients/${data.id}`)).json()).data;
    expect(detail.jobs).toEqual([]);

    await page.goto("/management/employer-clients");
    await expect(page.getByText(name)).toBeVisible();
  });
});

test.describe("Next.js -> FastAPI (campaigns and their targets, step 5.1)", () => {
  test("an admin runs a campaign through the website", async ({ page }) => {
    const name = `E2E Campaign ${Date.now().toString(36)}`;
    const created = await page.request.post("/api/campaigns", { data: { name, start_date: "2026-11-01", end_date: "2026-12-31" } });
    expect(created.status()).toBe(201);
    const { data: campaign } = await created.json();
    expect(campaign).toMatchObject({ name, status: "draft", start_date: "2026-11-01T00:00:00.000Z" });

    const backwards = await page.request.post("/api/campaigns", { data: { name, start_date: "2026-12-31", end_date: "2026-11-01" } });
    expect(backwards.status()).toBe(422);

    const target = await page.request.post(`/api/campaigns/${campaign.id}/targets`, { data: { metric: "verified_candidates", target_value: 25 } });
    expect(target.status()).toBe(201);
    const { data: t } = await target.json();

    expect((await page.request.patch(`/api/campaigns/${campaign.id}`, { data: { status: "active" } })).status()).toBe(200);
    const active = (await (await page.request.get("/api/campaigns?status=active")).json()).data;
    const listed = active.find((c: { id: string }) => c.id === campaign.id);
    expect(listed.targets.map((x: { id: string }) => x.id)).toEqual([t.id]);

    await page.goto("/management/campaigns");
    await expect(page.getByText(name)).toBeVisible();

    expect((await page.request.delete(`/api/campaigns/${campaign.id}/targets/${t.id}`)).status()).toBe(200);
    expect((await page.request.delete(`/api/campaigns/${campaign.id}`)).status()).toBe(200);
    expect((await page.request.get(`/api/campaigns/${campaign.id}`)).status()).toBe(404);
  });
});

test.describe("Next.js -> FastAPI (recruiter targets, staff KPI targets and notes, step 5.2)", () => {
  test("an admin sets targets and leaves a note, and the website's KPI read sees them", async ({ page }) => {
    const users = (await (await page.request.get("/api/admin/users?q=e2e-recruiter@test.local")).json()).data;
    const recruiter = users.find((u: { email: string }) => u.email === "e2e-recruiter@test.local");
    expect(recruiter).toBeTruthy();

    // A campaign target to allocate from (step 5.1's routes).
    const { data: campaign } = await (
      await page.request.post("/api/campaigns", { data: { name: `E2E Targets ${Date.now().toString(36)}`, start_date: "2026-11-01", end_date: "2026-12-31" } })
    ).json();
    const { data: campaignTarget } = await (
      await page.request.post(`/api/campaigns/${campaign.id}/targets`, { data: { metric: "verified_candidates", target_value: 100 } })
    ).json();

    const allocated = await page.request.post("/api/recruiter-targets", { data: { campaign_target_id: campaignTarget.id, recruiter_id: recruiter.id, target_value: 30 } });
    expect(allocated.status()).toBe(201);
    expect((await allocated.json()).data).toMatchObject({ target_value: 30, recruiter: { id: recruiter.id } });
    const listed = (await (await page.request.get(`/api/recruiter-targets?campaign_target_id=${campaignTarget.id}`)).json()).data;
    expect(listed.map((t: { recruiter: { id: string } }) => t.recruiter.id)).toEqual([recruiter.id]);

    const label = "Candidate identification"; // on a recruiter's weekly report
    const kpi = await page.request.post("/api/staff-kpi-targets", { data: { staff_id: recruiter.id, cycle: "weekly", kpi_label: label, target_value: 12 } });
    expect(kpi.status()).toBe(201);
    const badLabel = await page.request.post("/api/staff-kpi-targets", { data: { staff_id: recruiter.id, cycle: "weekly", kpi_label: "Made-up KPI", target_value: 12 } });
    expect((await badLabel.json()).error.code).toBe("invalid_label");
    // Targets vs actuals is still computed by Next.js from the pipeline.
    const vsActuals = await (await page.request.get(`/api/staff-kpi-targets?staff_id=${recruiter.id}&cycle=weekly`)).json();
    expect(JSON.stringify(vsActuals.data)).toContain(label);

    const note = await page.request.post("/api/recruiter-notes", { data: { recruiter_id: recruiter.id, message: "Strong week, keep it up." } });
    expect(note.status()).toBe(201);
    const notes = (await (await page.request.get(`/api/recruiter-notes?recruiter_id=${recruiter.id}`)).json()).data;
    expect(notes[0]).toMatchObject({ message: "Strong week, keep it up.", author: { full_name: "E2E Admin" } });

    await page.request.delete(`/api/campaigns/${campaign.id}`);
  });
});

