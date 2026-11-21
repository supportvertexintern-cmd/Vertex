import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The website's AI assistant gives out the contact details marketing
// publishes (the landing CMS's shared.contact), never old hard-coded ones,
// whichever knowledge base it uses.

const generateText = vi.fn();
vi.mock("ai", () => ({ generateText: (...args: unknown[]) => generateText(...args) }));
vi.mock("@ai-sdk/google", () => ({ google: () => "model" }));
vi.mock("@/lib/rate-limit", () => ({ limitByIp: async () => null }));
const callBackend = vi.fn();
vi.mock("@/lib/backend", () => ({ callBackend: (path: string) => callBackend(path) }));
vi.mock("@/server/services/landingContent", () => ({
  getLandingPage: async () => ({
    contact: { whatsapp: "+44 7000 000001", office: "+44 20 0000 0002", email: "hello@example.org", other_emails: ["help@example.org"], address: "1 Test Street, Chester" },
  }),
}));

import { POST } from "@/app/api/chat/route";

const ask = () =>
  POST(new Request("http://localhost/api/chat", { method: "POST", body: JSON.stringify({ messages: [{ role: "user", content: "How do I reach you?" }] }) }));

beforeEach(() => {
  vi.stubEnv("GOOGLE_GENERATIVE_AI_API_KEY", "test-key");
  generateText.mockReset().mockResolvedValue({ text: "Reach us on WhatsApp." });
  callBackend.mockReset().mockImplementation(async (path: string) =>
    path === "/api/v1/assistant" ? { ok: true, status: 200, body: { data: { enabled: true } } } : { ok: false, status: 502, error: { code: "x", message: "x" } },
  );
});

afterEach(() => vi.unstubAllEnvs());

describe("the assistant's contact details", () => {
  it("come from the CMS, with the fallback knowledge base", async () => {
    expect((await ask()).status).toBe(200);
    const { system } = generateText.mock.calls[0][0];
    expect(system).toContain("WhatsApp +44 7000 000001 or email hello@example.org");
    expect(system).toContain("- Office: +44 20 0000 0002");
    expect(system).toContain("hello@example.org (general), help@example.org");
    expect(system).toContain("- Registered office: 1 Test Street, Chester");
    for (const old of ["7438", "3026 3403", "vertex@vertexintern.com", "inquiries@vertexintern.com", "Brayford", "Kingsfield"]) expect(system).not.toContain(old);
  });

  it("are added to the help centre's articles too", async () => {
    callBackend.mockImplementation(async (path: string) =>
      path === "/api/v1/assistant"
        ? { ok: true, status: 200, body: { data: { enabled: true } } }
        : { ok: true, status: 200, body: { data: [{ title: "Visas", content: "About visas." }] } },
    );
    await ask();
    const { system } = generateText.mock.calls[0][0];
    expect(system).toContain("--- Visas ---");
    expect(system).toContain("--- CONTACT DETAILS (current) ---");
  });
});
