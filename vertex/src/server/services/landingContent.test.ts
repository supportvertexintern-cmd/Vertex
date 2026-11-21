import { beforeEach, describe, expect, it, vi } from "vitest";

// The website's landing blocks (server/services/landingContent.ts): what
// marketing published, over the built-in text, block by block, and never
// a blank page. vertex_be's tests check the blocks themselves and that
// landing.defaults.json is its built-in text.

const callBackend = vi.fn();
vi.mock("@/lib/backend", () => ({ callBackend: (...args: unknown[]) => callBackend(...args) }));

import { BLOCK_VERSION, BUILT_IN, builtIn, getLandingPage, getLandingPreview, getMobileLanding, merge, resetLandingCache } from "./landingContent";

const ok = (blocks: unknown[], version = BLOCK_VERSION) => ({ ok: true, status: 200, body: { data: { app: "web", version, blocks } } });
const contact = { ...BUILT_IN["shared.contact"], whatsapp: "+44 7000 000001", email: "hello@example.org" };

beforeEach(() => {
  resetLandingCache();
  callBackend.mockReset();
  vi.useRealTimers();
});

describe("the built-in text", () => {
  it("is today's page, for every block the home page shows", () => {
    const { blocks, contact: details } = builtIn();
    expect(Object.keys(blocks)).toEqual([
      "web.hero", "web.partner_enquiry", "web.process", "web.audiences", "web.jobs", "web.workforce", "web.referral",
      "web.faq", "web.ending", "shared.why_vertex", "shared.contact",
    ]);
    expect(blocks["web.hero"]?.headline).toBe("Your gateway to");
    expect(details).toEqual({
      whatsapp: "+44 7438 613251",
      office: "+44 20 3026 3403",
      email: "vertex@vertexintern.com",
      other_emails: ["inquiries@vertexintern.com", "support@vertexintern.com"],
      address: "Regus House, Herons Way, Chester Business Park, Chester, Cheshire CH4 9QR, United Kingdom",
    });
  });
});

describe("marketing's blocks over the built-in text", () => {
  it("shows a published block and keeps the built-in text for the rest", () => {
    const hero = { ...BUILT_IN["web.hero"], headline: "A new headline" };
    const page = merge({ version: BLOCK_VERSION, blocks: [{ key: "web.hero", visible: true, body: hero, revision: 3 }] });
    expect(page.blocks["web.hero"]?.headline).toBe("A new headline");
    expect(page.blocks["web.faq"]).toEqual(BUILT_IN["web.faq"]);
  });

  it("drops a hidden block, but its contact details still reach the footer", () => {
    const page = merge({
      version: BLOCK_VERSION,
      blocks: [
        { key: "web.referral", visible: false, body: null, revision: 2 },
        { key: "shared.contact", visible: false, body: null, revision: 1 },
      ],
    });
    expect(page.blocks["web.referral"]).toBeNull();
    expect(page.blocks["shared.contact"]).toBeNull();
    expect(page.contact.email).toBe("vertex@vertexintern.com");
  });

  it("takes the published contact details for the footer, the WhatsApp button and the contact page", () => {
    const page = merge({ version: BLOCK_VERSION, blocks: [{ key: "shared.contact", visible: true, body: contact, revision: 1 }] });
    expect(page.contact).toMatchObject({ whatsapp: "+44 7000 000001", office: "+44 20 3026 3403", email: "hello@example.org" });
  });

  it("fills a field the published body lacks from the built-in text (one published before the field existed)", () => {
    const { other_emails: _o, address: _a, ...old } = BUILT_IN["shared.contact"];
    const page = merge({ version: BLOCK_VERSION, blocks: [{ key: "shared.contact", visible: true, body: { ...old, email: "old@example.org" }, revision: 1 }] });
    expect(page.contact.email).toBe("old@example.org");
    expect(page.contact.other_emails).toEqual(BUILT_IN["shared.contact"].other_emails);
    const emptied = merge({ version: BLOCK_VERSION, blocks: [{ key: "shared.contact", visible: true, body: { ...BUILT_IN["shared.contact"], other_emails: [], address: "" }, revision: 2 }] });
    expect([emptied.contact.other_emails, emptied.contact.address]).toEqual([[], ""]);
  });

  it("keeps the built-in text for a newer format, an unknown block, or a body that isn't one", () => {
    const hero = { ...BUILT_IN["web.hero"], headline: "From the future" };
    expect(merge({ version: BLOCK_VERSION + 1, blocks: [{ key: "web.hero", visible: true, body: hero, revision: 9 }] }).blocks["web.hero"]).toEqual(BUILT_IN["web.hero"]);
    const odd = merge({
      version: BLOCK_VERSION,
      blocks: [
        { key: "mobile.hero", visible: true, body: hero, revision: 1 },
        { key: "web.hero", visible: true, body: null, revision: 1 },
        { key: "web.faq", visible: true, body: ["not", "an", "object"] as unknown as Record<string, unknown>, revision: 1 },
      ],
    });
    expect(odd.blocks).toEqual(builtIn().blocks);
    expect("mobile.hero" in odd.blocks).toBe(false);
  });
});

describe("the preview (/?preview=1)", () => {
  it("asks for the drafts with the viewer's own session, never cached", async () => {
    const hero = { ...BUILT_IN["web.hero"], headline: "A draft headline" };
    callBackend.mockResolvedValue(ok([{ key: "web.hero", visible: true, body: hero, revision: 1 }]));
    const page = await getLandingPreview();
    expect(page.previewing).toBe(true);
    expect(page.blocks["web.hero"]?.headline).toBe("A draft headline");
    expect(callBackend).toHaveBeenCalledWith("/api/v1/content/landing", {
      query: { app: "web", preview: true },
      asUser: "if-signed-in",
      timeoutMs: 3_000,
    });
    await getLandingPreview();
    expect(callBackend).toHaveBeenCalledTimes(2);
  });

  it("shows the published page to a viewer FastAPI refuses", async () => {
    callBackend
      .mockResolvedValueOnce({ ok: false, status: 403, error: { code: "forbidden", message: "x" } })
      .mockResolvedValueOnce(ok([]));
    const page = await getLandingPreview();
    expect(page.previewing).toBe(false);
    expect(page.blocks).toEqual(builtIn().blocks);
    expect(callBackend).toHaveBeenLastCalledWith("/api/v1/content/landing", { query: { app: "web" }, asUser: false, timeoutMs: 3_000 });
  });
});

describe("the mobile app's read (/api/public/landing)", () => {
  it("passes FastAPI's answer on as the website itself, kept like the website's", async () => {
    vi.useFakeTimers();
    const answer = { app: "mobile", version: BLOCK_VERSION, blocks: [] };
    callBackend.mockResolvedValue({ ok: true, status: 200, body: { data: answer } });
    expect(await getMobileLanding()).toEqual(answer);
    await getMobileLanding();
    expect(callBackend).toHaveBeenCalledTimes(1);
    expect(callBackend).toHaveBeenCalledWith("/api/v1/content/landing", { query: { app: "mobile" }, asUser: false, timeoutMs: 3_000 });
    resetLandingCache(); // a publish
    await getMobileLanding();
    expect(callBackend).toHaveBeenCalledTimes(2);
  });

  it("is null when FastAPI can't answer", async () => {
    callBackend.mockResolvedValue({ ok: false, status: 502, error: { code: "backend_unavailable", message: "x" } });
    expect(await getMobileLanding()).toBeNull();
  });
});

describe("the read from FastAPI", () => {
  it("asks for the website's blocks as the website itself, with a short timeout", async () => {
    callBackend.mockResolvedValue(ok([]));
    await getLandingPage();
    expect(callBackend).toHaveBeenCalledWith("/api/v1/content/landing", { query: { app: "web" }, asUser: false, timeoutMs: 3_000 });
  });

  it("shows the built-in text when FastAPI can't answer", async () => {
    callBackend.mockResolvedValue({ ok: false, status: 503, error: { code: "backend_unavailable", message: "x" } });
    expect(await getLandingPage()).toEqual(builtIn());
  });

  it("keeps an answer for 30 seconds and a failure for 10", async () => {
    vi.useFakeTimers();
    callBackend.mockResolvedValue(ok([{ key: "shared.contact", visible: true, body: contact, revision: 1 }]));
    expect((await getLandingPage()).contact.email).toBe("hello@example.org");
    await getLandingPage();
    expect(callBackend).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(30_001);
    callBackend.mockResolvedValue({ ok: false, status: 502, error: { code: "backend_unavailable", message: "x" } });
    expect((await getLandingPage()).contact.email).toBe("vertex@vertexintern.com");
    vi.advanceTimersByTime(9_000);
    await getLandingPage();
    expect(callBackend).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(1_001);
    await getLandingPage();
    expect(callBackend).toHaveBeenCalledTimes(3);
  });
});
