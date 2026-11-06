// The email templates FastAPI renders since reads handover R7b (D4 A), taken
// from this app's lib/email.ts rather than written twice: each sender below
// runs with `{{name}}` placeholders for its values and its email is captured,
// so vertex_be/app/assets/email_templates.json is exactly what lib/email.ts
// would send. FastAPI fills the same placeholders (HTML-escaped) and applies
// an admin's EmailTemplate override by the template's event, as lib/email.ts
// does. The receipt comes from lib/invoice.ts the same way (FastAPI draws its
// PDF itself). This test fails when the two drift; to regenerate:
//   UPDATE_EMAIL_TEMPLATES=1 npx vitest run src/lib/email-templates.test.ts
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => {
  process.env.NEXT_PUBLIC_APP_URL = "{{app_url}}";
  // The staff notifications go to a configured address; FastAPI has its own setting.
  process.env.PARTNER_SUBMISSION_NOTIFY_EMAIL = "staff@test.invalid";
  process.env.REFERRAL_AGENT_NOTIFY_EMAIL = "staff@test.invalid";
  process.env.CONSULTATION_NOTIFY_EMAIL = "staff@test.invalid";
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
import { createReceiptPdf } from "./invoice";

const OUT = path.resolve(__dirname, "../../../vertex_be/app/assets/email_templates.json");

// Each template FastAPI renders, keyed by its notice kind (a kind with
// variants adds ".variant"): the sender's call. Each value it reads from `v`
// is passed as a neutral token that survives what the sender does with it
// (a label lookup, upper-casing, toLocaleString) and comes back as `{{name}}`;
// FastAPI computes the same value (app/services/emails.py). `links` puts the
// links a sender builds back as the placeholder an override uses for them.
// `cut` takes HTML a sender repeats (the plan's rows) out as a placeholder,
// and `parts` keeps the pieces FastAPI repeats in its place. `plain` is an
// email outside emailLayout (no logo, no year).
type Values = Record<string, string>;
type Case = {
  send: (v: Values) => Promise<unknown>;
  links?: Record<string, string>;
  cut?: (v: Values) => Record<string, string>;
  parts?: (v: Values) => Record<string, string>;
  plain?: boolean;
};
const num = (value: string) => value as unknown as number; // toLocaleString() on the token returns it unchanged
const fixed = (value: string) => ({ toFixed: () => value }) as unknown as number; // as toFixed(2)
// Math.round() can't keep a token: this number stands for {{percent}}.
const PERCENT = 987654;
const planStage = (v: Values): email.MilestonePlanStage => ({
  id: "current", label: v.label, percent: PERCENT, amount: num(v.amount), triggerStageLabel: v.triggerStageLabel,
});
const consultation = (v: Values, name: boolean, phone: boolean) =>
  email.sendConsultationBookingNotification({
    fullName: name ? v.fullName : null, email: v.email, phone: phone ? v.phone : null, amount: num(v.amount), currency: v.currency,
  });
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
  // Batch 3: a template per variant, the plan's rows as parts, the receipt.
  "case_reminder.document": { send: (v) => email.sendCaseReminderEmail(v.to, v.recipientName, v.candidateName, v.programmeTitle, "document") },
  "case_reminder.document_message": {
    send: (v) => email.sendCaseReminderEmail(v.to, v.recipientName, v.candidateName, v.programmeTitle, "document", v.message),
  },
  "case_reminder.payment": { send: (v) => email.sendCaseReminderEmail(v.to, v.recipientName, v.candidateName, v.programmeTitle, "payment") },
  "case_reminder.payment_message": {
    send: (v) => email.sendCaseReminderEmail(v.to, v.recipientName, v.candidateName, v.programmeTitle, "payment", v.message),
  },
  milestone_payment_link: {
    send: (v) => email.sendMilestonePaymentLinkEmail(v.to, v.recipientName, v.candidateName, v.programmeTitle, v.paymentUrl, "current", [planStage(v)]),
    cut: (v) => ({ planRows: email.milestonePlanRow(planStage(v), "Stage 1 of 1", true) }),
    parts: (v) => ({
      row_current: email.milestonePlanRow(planStage(v), v.position, true),
      row_upcoming: email.milestonePlanRow(planStage(v), v.position, false),
    }),
  },
  "consultation_booked.name_phone": { send: (v) => consultation(v, true, true) },
  "consultation_booked.name_no_phone": { send: (v) => consultation(v, true, false) },
  "consultation_booked.no_name_phone": { send: (v) => consultation(v, false, true) },
  "consultation_booked.no_name_no_phone": { send: (v) => consultation(v, false, false) },
  payment_receipt: {
    send: (v) => createReceiptPdf("p", v.candidateName, v.to, v.jobTitle, fixed(v.amount), "t", new Date(0)),
    plain: true,
  },
};

type Template = { event: string | null; subject: string; html: string; parts?: Record<string, string> };

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
  let raw = mail.html;
  for (const [name, piece] of Object.entries(c.cut?.(values) ?? {})) {
    expect(raw, `${name} isn't in the email`).toContain(piece);
    raw = raw.replaceAll(piece, `{{${name}}}`);
  }
  const named = (text: string) =>
    names.reduce((out, name, i) => out.replaceAll(`§${i}§`, `{{${name}}}`), text).replaceAll(String(PERCENT), "{{percent}}");
  const parts = c.parts && Object.fromEntries(Object.entries(c.parts(values)).map(([name, piece]) => [name, named(piece)]));
  let html = named(raw)
    .replaceAll("{{app_url}}/vertex-logo.png", "{{logo}}")
    .replace(`© ${new Date().getFullYear()} `, "© {{year}} ");
  let subject = named(mail.subject);
  for (const [name, link] of Object.entries(c.links ?? {})) {
    html = html.replaceAll(link, `{{${name}}}`);
    subject = subject.replaceAll(link, `{{${name}}}`);
  }
  return { event: state.events[0] ?? null, subject, html, ...(parts && { parts }) };
}

describe("email_templates.json", () => {
  it("is what lib/email.ts sends, for every kind FastAPI sends", async () => {
    const templates: Record<string, Template> = {};
    for (const [kind, c] of Object.entries(CASES)) templates[kind] = await capture(c);

    for (const [kind, t] of Object.entries(templates)) {
      const all = `${t.subject}${t.html}${Object.values(t.parts ?? {}).join("")}`;
      const names = new Set([...all.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]));
      expect(names.has("token"), `${kind}: a link left unnamed`).toBe(false);
      expect(all, `${kind}: a value lost its name`).not.toContain("§");
      if (CASES[kind].plain) continue;
      expect(t.html, `${kind}: no logo`).toContain("{{logo}}");
      expect(t.html, `${kind}: no year`).toContain("{{year}}");
    }

    const json = `${JSON.stringify(templates, null, 2)}\n`;
    if (process.env.UPDATE_EMAIL_TEMPLATES) fs.writeFileSync(OUT, json);
    expect(JSON.parse(fs.readFileSync(OUT, "utf8")), "run with UPDATE_EMAIL_TEMPLATES=1 to regenerate").toEqual(templates);
  });
});
