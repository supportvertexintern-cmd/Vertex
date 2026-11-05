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
  // The staff notifications go to a configured address; FastAPI has its own setting.
  process.env.PARTNER_SUBMISSION_NOTIFY_EMAIL = "staff@test.invalid";
  process.env.REFERRAL_AGENT_NOTIFY_EMAIL = "staff@test.invalid";
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

// Each template FastAPI renders, keyed by its notice kind (a kind with
// variants adds ".variant"): the sender's call. Each value it reads from `v`
// is passed as a neutral token that survives what the sender does with it
// (a label lookup, upper-casing, toLocaleString) and comes back as `{{name}}`;
// FastAPI computes the same value (app/services/emails.py). `links` puts the
// links a sender builds back as the placeholder an override uses for them.
type Values = Record<string, string>;
type Case = { send: (v: Values) => Promise<unknown>; links?: Record<string, string> };
const num = (value: string) => value as unknown as number; // toLocaleString() on the token returns it unchanged
const CASES: Record<string, Case> = {
  email_verification: {
    send: (v) => email.sendVerificationLinkEmail(v.token, v.to, v.fullName),
    links: { verifyUrl: "{{app_url}}/auth/verify-email?token={{token}}" },
  },
  password_reset: {
    send: (v) => email.sendPasswordResetLinkEmail(v.token, v.to, v.fullName),
    links: { resetUrl: "{{app_url}}/auth/reset-password?token={{token}}" },
  },
  account_setup: {
    send: (v) => email.sendAccountSetupLinkEmail(v.token, v.to, v.name),
    links: { setupUrl: "{{app_url}}/auth/register?setup={{token}}" },
  },
  candidate_invite: {
    send: (v) => email.sendCandidateInviteEmail(v.candidateId, v.to, v.name),
    links: { registerUrl: "{{app_url}}/auth/register?invite={{token}}" },
  },
  referral_agent_application: {
    send: (v) => email.sendReferralAgentApplicationLinkEmail(v.token, v.to, v.fullName),
    links: { verifyUrl: "{{app_url}}/become-a-referral-agent/verify-email?token={{token}}" },
  },
  // Batch 2: values only.
  "application_confirmation.account": { send: (v) => email.sendApplicationConfirmationEmail(v.to, v.name, v.jobTitle, true) },
  "application_confirmation.no_account": { send: (v) => email.sendApplicationConfirmationEmail(v.to, v.name, v.jobTitle, false) },
  application_status: { send: (v) => email.sendStatusUpdateEmail(v.to, v.name, v.jobTitle, v.friendlyStatus) },
  candidate_approved: { send: (v) => email.sendCandidateApprovedEmail(v.to, v.name) },
  candidate_message: { send: (v) => email.sendCandidateMessageNotificationEmail(v.to, v.name, v.viewUrl) },
  case_stage: { send: (v) => email.sendCaseStageUpdateEmail(v.to, v.name, v.jobTitle, v.friendlyStage) },
  partner_case_stage: { send: (v) => email.sendPartnerCaseStageUpdateEmail(v.to, v.partnerName, v.candidateName, v.jobTitle, v.friendlyStage) },
  case_rejected: { send: (v) => email.sendCaseRejectedEmail(v.to, v.recipientName, v.candidateName, v.jobTitle, v.reason) },
  partner_case_rejected: { send: (v) => email.sendPartnerCaseRejectedEmail(v.to, v.partnerName, v.candidateName, v.jobTitle, v.reason) },
  partner_candidate_submitted: { send: (v) => email.sendPartnerCandidateSubmittedEmail(v.partnerName, v.candidateName) },
  partner_case_created: { send: (v) => email.sendPartnerCaseCreatedEmail(v.to, v.partnerName, v.candidateName) },
  partner_candidate_rejected: { send: (v) => email.sendPartnerCandidateRejectedEmail(v.to, v.partnerName, v.candidateName, v.reason) },
  referral_agent_admin_notification: { send: (v) => email.sendReferralAgentAdminNotificationEmail(v.fullName, v.country) },
  referral_agent_approved: { send: (v) => email.sendReferralAgentApprovedEmail(v.to, v.fullName, v.referralCode, v.referralLink) },
  referral_agent_rejected: { send: (v) => email.sendReferralAgentRejectedEmail(v.to, v.fullName, v.reason) },
  referral_agent_suspended: { send: (v) => email.sendReferralAgentSuspendedEmail(v.to, v.fullName, v.reason) },
  referral_commission_earned: {
    send: (v) => email.sendReferralCommissionEarnedEmail(v.to, v.agentName, v.candidateName, v.milestone, num(v.amount), v.currency),
  },
  referral_commission_approved: { send: (v) => email.sendReferralCommissionApprovedEmail(v.to, v.agentName, v.candidateName, num(v.amount), v.currency) },
  referral_commission_paid: { send: (v) => email.sendReferralCommissionPaidEmail(v.to, v.agentName, v.candidateName, num(v.amount), v.currency) },
};

type Template = { event: string | null; subject: string; html: string };

async function capture(c: Case): Promise<Template> {
  state.sent.length = 0;
  state.events.length = 0;
  const names: string[] = [];
  const values = new Proxy({} as Values, {
    get: (_, name: string) => `§${names.includes(name) ? names.indexOf(name) : names.push(name) - 1}§`,
  });
  await c.send(values);
  expect(state.sent).toHaveLength(1);
  const [mail] = state.sent;
  const named = (text: string) => names.reduce((out, name, i) => out.replaceAll(`§${i}§`, `{{${name}}}`), text);
  let html = named(mail.html)
    .replaceAll("{{app_url}}/vertex-logo.png", "{{logo}}")
    .replace(`© ${new Date().getFullYear()} `, "© {{year}} ");
  let subject = named(mail.subject);
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

    for (const [kind, t] of Object.entries(templates)) {
      const names = new Set([...`${t.subject}${t.html}`.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]));
      expect(names.has("token"), `${kind}: a link left unnamed`).toBe(false);
      expect(`${t.subject}${t.html}`, `${kind}: a value lost its name`).not.toContain("§");
      expect(t.html, `${kind}: no logo`).toContain("{{logo}}");
      expect(t.html, `${kind}: no year`).toContain("{{year}}");
    }

    const json = `${JSON.stringify(templates, null, 2)}\n`;
    if (process.env.UPDATE_EMAIL_TEMPLATES) fs.writeFileSync(OUT, json);
    expect(JSON.parse(fs.readFileSync(OUT, "utf8")), "run with UPDATE_EMAIL_TEMPLATES=1 to regenerate").toEqual(templates);
  });
});
