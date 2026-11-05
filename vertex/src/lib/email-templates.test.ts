// The email templates FastAPI renders since reads handover R7b (D4 A), taken
// from this app's lib/email.ts rather than written twice: each sender below
// runs with `{{name}}` placeholders for its values and its email is captured,
// so vertex_be/app/assets/email_templates.json is exactly what lib/email.ts
// would send. FastAPI fills the same placeholders (HTML-escaped) and applies
// an admin's EmailTemplate override by the template's event, as lib/email.ts
// does. This test fails when the two drift; to regenerate:
//   UPDATE_EMAIL_TEMPLATES=1 npx vitest run src/lib/email-templates.test.ts
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => {
  process.env.NEXT_PUBLIC_APP_URL = "{{app_url}}";
  return { sent: [] as { to: string; subject: string; html: string }[], events: [] as string[] };
});

vi.mock("nodemailer", () => ({
  default: { createTransport: () => ({ sendMail: async (mail: { to: string; subject: string; html: string }) => void state.sent.push(mail) }) },
}));
// The logo falls back to its URL, which becomes the {{logo}} placeholder.
vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  const readFileSync = ((file: string, ...rest: unknown[]) => {
    if (String(file).endsWith("vertex-logo.png")) throw new Error("no logo while capturing templates");
    return (actual.readFileSync as (...args: unknown[]) => unknown)(file, ...rest);
  }) as typeof actual.readFileSync;
  return { ...actual, readFileSync, default: { ...actual, readFileSync } };
});
vi.mock("@/lib/prisma", () => ({
  prisma: { emailTemplate: { findUnique: async ({ where }: { where: { event: string } }) => (state.events.push(where.event), null) } },
}));
vi.mock("@/lib/jwt", () => ({ signCandidateInviteToken: () => "{{token}}" }));

import * as email from "./email";

const OUT = path.resolve(__dirname, "../../../vertex_be/app/assets/email_templates.json");

// Each FastAPI notice kind it sends: the sender's call, and the links it
// builds, put back as the placeholder an override uses for them.
type Case = { send: () => Promise<unknown>; links?: Record<string, string> };
const CASES: Record<string, Case> = {
  email_verification: {
    send: () => email.sendVerificationLinkEmail("{{token}}", "{{to}}", "{{fullName}}"),
    links: { verifyUrl: "{{app_url}}/auth/verify-email?token={{token}}" },
  },
  password_reset: {
    send: () => email.sendPasswordResetLinkEmail("{{token}}", "{{to}}", "{{fullName}}"),
    links: { resetUrl: "{{app_url}}/auth/reset-password?token={{token}}" },
  },
  account_setup: {
    send: () => email.sendAccountSetupLinkEmail("{{token}}", "{{to}}", "{{name}}"),
    links: { setupUrl: "{{app_url}}/auth/register?setup={{token}}" },
  },
  candidate_invite: {
    send: () => email.sendCandidateInviteEmail("{{candidateId}}", "{{to}}", "{{name}}"),
    links: { registerUrl: "{{app_url}}/auth/register?invite={{token}}" },
  },
  referral_agent_application: {
    send: () => email.sendReferralAgentApplicationLinkEmail("{{token}}", "{{to}}", "{{fullName}}"),
    links: { verifyUrl: "{{app_url}}/become-a-referral-agent/verify-email?token={{token}}" },
  },
};

type Template = { event: string | null; subject: string; html: string };

async function capture(c: Case): Promise<Template> {
  state.sent.length = 0;
  state.events.length = 0;
  await c.send();
  expect(state.sent).toHaveLength(1);
  const [mail] = state.sent;
  let html = mail.html
    .replaceAll("{{app_url}}/vertex-logo.png", "{{logo}}")
    .replace(`© ${new Date().getFullYear()} `, "© {{year}} ");
  let subject = mail.subject;
  for (const [name, link] of Object.entries(c.links ?? {})) {
    html = html.replaceAll(link, `{{${name}}}`);
    subject = subject.replaceAll(link, `{{${name}}}`);
  }
  return { event: state.events[0] ?? null, subject, html };
}

describe("email_templates.json", () => {
  it("is what lib/email.ts sends, for every kind FastAPI sends", async () => {
    const templates: Record<string, Template> = {};
    for (const [kind, c] of Object.entries(CASES)) templates[kind] = await capture(c);

    // Only placeholders FastAPI fills: nothing computed from one slipped in.
    for (const [kind, t] of Object.entries(templates)) {
      const names = new Set([...`${t.subject}${t.html}`.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]));
      expect([...names].filter((n) => n === "app_url" || n === "token"), `${kind}: a link left unnamed`).toEqual([]);
      expect(t.html, `${kind}: no logo`).toContain("{{logo}}");
      expect(t.html, `${kind}: no year`).toContain("{{year}}");
    }

    const json = `${JSON.stringify(templates, null, 2)}\n`;
    if (process.env.UPDATE_EMAIL_TEMPLATES) fs.writeFileSync(OUT, json);
    expect(JSON.parse(fs.readFileSync(OUT, "utf8")), "run with UPDATE_EMAIL_TEMPLATES=1 to regenerate").toEqual(templates);
  });
});
