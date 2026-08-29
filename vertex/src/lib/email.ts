import nodemailer from "nodemailer";
import fs from "fs";
import path from "path";
import { signEmailToken, signCandidateInviteToken, signAccountSetupToken } from "./jwt";
import { MILESTONE_DESCRIPTIONS } from "@/server/services/stripeProvisioning";
import { CASE_STAGE_LABELS, type CaseStageKey } from "@/components/portal/caseStages";
import { prisma } from "./prisma";

import { log } from "./log";
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT) || 587,
  secure: process.env.SMTP_SECURE === "true",
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

const FROM = process.env.EMAIL_FROM || "Vertex International <noreply@vertexinternational.com>";
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

// Base64-embedded rather than referenced by URL — an <img src="{APP_URL}/...">
// is unreachable to any recipient when APP_URL is localhost (the common
// case sending test emails from local dev), and embedding removes the
// dependency on APP_URL being publicly reachable at all, in any environment.
const LOGO_DATA_URI = (() => {
  try {
    const bytes = fs.readFileSync(path.join(process.cwd(), "public/vertex-logo.png"));
    return `data:image/png;base64,${bytes.toString("base64")}`;
  } catch {
    return `${APP_URL}/vertex-logo.png`; // fallback if the file ever moves/is missing
  }
})();

// Helper to fetch dynamic DB templates and fallback to hardcoded defaults
async function getEmailConfig(event: string, defaultSubject: string, defaultHtml: string) {
  try {
    const template = await prisma.emailTemplate.findUnique({ where: { event } });
    if (template) return { subject: template.subject, html: template.body_html };
  } catch (e) {
    log.warn("email.db_not_ready_or_template_missing_using");
  }
  return { subject: defaultSubject, html: defaultHtml };
}

// --- Brand shell ------------------------------------------------------
// Every email in the app renders through this — matches the site's own
// midnight/gold/ivory palette (globals.css) rather than a generic
// slate/blue template. Table-based structural bits (section headers,
// field rows) instead of flexbox/grid, since Outlook desktop's Word
// rendering engine doesn't support either; border-radius/box-shadow are
// used freely since they degrade gracefully there (square corners, no
// shadow) rather than breaking layout.
const BRAND = {
  midnight950: "#03120d",
  midnight900: "#062119",
  midnight800: "#0a3326",
  midnight700: "#104f36",
  ivory50: "#fbf9f4",
  ivory100: "#f5f1e8",
  gold300: "#e6cd85",
  gold400: "#d4af5c",
  gold600: "#a98634",
};
const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";

function emailLayout({ eyebrow, title, subtitle, bodyHtml }: { eyebrow?: string; title: string; subtitle?: string; bodyHtml: string }) {
  return `
  <div style="background:${BRAND.ivory100};padding:32px 16px;font-family:${FONT};">
    <div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid rgba(6,33,25,0.08);">
      <div style="background:${BRAND.midnight950};padding:36px 40px 32px;">
        <table role="presentation" style="border-collapse:collapse;">
          <tr>
            <td style="vertical-align:middle;padding-right:10px;">
              <img src="${LOGO_DATA_URI}" width="26" height="26" alt="" style="display:block;border-radius:6px;" />
            </td>
            <td style="vertical-align:middle;">
              <span style="font-size:14px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:${BRAND.ivory50};">VERTEX <span style="color:${BRAND.gold400};">INTERNATIONAL</span></span>
            </td>
          </tr>
        </table>
        ${eyebrow ? `<div style="margin-top:24px;font-size:11px;font-weight:700;letter-spacing:0.25em;text-transform:uppercase;color:${BRAND.gold400};">${eyebrow}</div>` : ""}
        <div style="margin-top:${eyebrow ? "10" : "24"}px;font-size:24px;font-weight:600;letter-spacing:-0.01em;color:${BRAND.ivory50};line-height:1.25;">${title}</div>
        ${subtitle ? `<div style="margin-top:8px;font-size:14px;color:rgba(251,249,244,0.6);font-weight:300;">${subtitle}</div>` : ""}
      </div>
      <div style="padding:36px 40px;background:#ffffff;">
        ${bodyHtml}
      </div>
      <div style="padding:24px 40px;background:${BRAND.ivory100};border-top:1px solid rgba(6,33,25,0.08);">
        <div style="font-size:12px;color:rgba(6,33,25,0.55);line-height:1.6;">
          Vertex International Recruitment Ltd.<br />5 Brayford Square, London, E1 0SG, United Kingdom
        </div>
        <div style="font-size:11px;color:rgba(6,33,25,0.4);margin-top:10px;">
          © ${new Date().getFullYear()} Vertex International Recruitment. All rights reserved.
        </div>
      </div>
    </div>
  </div>`;
}

function goldButton(href: string, label: string) {
  return `<div style="text-align:center;margin:28px 0 8px;">
    <a href="${href}" style="display:inline-block;background:${BRAND.gold400};color:${BRAND.midnight950};padding:14px 32px;border-radius:999px;text-decoration:none;font-weight:600;font-size:13px;letter-spacing:0.1em;text-transform:uppercase;">${label}</a>
  </div>`;
}

function statPill(label: string, value: string, tone: "ivory" | "green" = "ivory") {
  const bg = tone === "green" ? "#eef7f1" : BRAND.ivory100;
  const valueColor = tone === "green" ? BRAND.midnight700 : BRAND.midnight950;
  return `<div style="background:${bg};border-radius:10px;padding:18px;text-align:center;margin-bottom:24px;">
    <div style="font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:${BRAND.gold600};">${label}</div>
    <div style="font-size:19px;font-weight:700;color:${valueColor};margin-top:6px;">${value}</div>
  </div>`;
}

const p = (html: string) => `<p style="font-size:15px;color:${BRAND.midnight900};line-height:1.65;margin:0 0 20px;">${html}</p>`;
const small = (html: string) => `<p style="font-size:13px;color:rgba(6,33,25,0.55);line-height:1.5;margin:0;">${html}</p>`;

// Shared "what happens next" note for every case-created email (CRM
// Comments item 1, 2026-08-10) — the next real step for anyone receiving
// one of these is the initial payment, and Finance is who to contact
// about it.
const FINANCE_NEXT_STEP_HTML = small(
  `The next step is the initial payment — our Finance Department will be in touch, or you can reach them directly at <a href="mailto:finance@vertexintern.com" style="color:${BRAND.gold600};">finance@vertexintern.com</a>.`
);

// Security alerts (lib/security-monitor.ts): plain text, no template or
// branding, so an alert still goes out if the template table is the
// problem. The body is already redacted by the monitor.
export async function sendSecurityAlertEmail(to: string[], subject: string, text: string) {
  await transporter.sendMail({ from: FROM, to, subject, text });
}

export async function sendVerificationEmail(userId: string, email: string, fullName: string) {
  const token = signEmailToken({ userId, email, type: "email_verification" });
  const verifyUrl = `${APP_URL}/auth/verify-email?token=${token}`;

  const defaultHtml = emailLayout({
    eyebrow: "Account Verification",
    title: "Welcome, {{fullName}}.",
    bodyHtml: `
      ${p("Thank you for registering with Vertex International Recruitment. Please verify your email address to activate your account.")}
      ${goldButton("{{verifyUrl}}", "Verify Email Address")}
      ${small("This link expires in 24 hours. If you did not create an account, you can ignore this email.")}
    `,
  });

  const config = await getEmailConfig("welcome", "Verify your Vertex International account", defaultHtml);
  const finalHtml = config.html
    .replace(/\{\{fullName\}\}/g, fullName)
    .replace(/\{\{verifyUrl\}\}/g, verifyUrl);

  await transporter.sendMail({ from: FROM, to: email, subject: config.subject, html: finalHtml });
}

export async function sendPasswordResetEmail(userId: string, email: string, fullName: string) {
  const token = signEmailToken({ userId, email, type: "password_reset" });
  const resetUrl = `${APP_URL}/auth/reset-password?token=${token}`;

  const defaultHtml = emailLayout({
    eyebrow: "Account Security",
    title: "Reset your password",
    bodyHtml: `
      ${p("Hi {{fullName}}, click the button below to reset your password.")}
      ${goldButton("{{resetUrl}}", "Reset Password")}
      ${small("This link expires in 24 hours. If you didn't request this, you can safely ignore this email.")}
    `,
  });

  const config = await getEmailConfig("reset_password", "Reset your Vertex International password", defaultHtml);
  const finalHtml = config.html
    .replace(/\{\{fullName\}\}/g, fullName)
    .replace(/\{\{resetUrl\}\}/g, resetUrl);

  await transporter.sendMail({ from: FROM, to: email, subject: config.subject, html: finalHtml });
}

// Invites a recruiter-sourced candidate lead (SRS FR-2.1) to create their
// own account once a recruiter has screened them — linking to their
// existing Candidate record so they can browse real jobs and submit a
// genuine application themselves, rather than the recruiter's manual
// status change being the only record of "submitted."
export async function sendCandidateInviteEmail(candidateId: string, to: string, name: string) {
  const token = signCandidateInviteToken(candidateId);
  const registerUrl = `${APP_URL}/auth/register?invite=${token}`;

  const defaultHtml = emailLayout({
    eyebrow: "Next Step",
    title: "You're a step closer, {{name}}.",
    bodyHtml: `
      ${p("Your Vertex International recruiter has reviewed your details and confirmed you're ready for the next step. Create your own free account to browse available programmes and submit your application directly.")}
      ${goldButton("{{registerUrl}}", "Create My Account")}
      ${small("This link expires in 7 days. If you're not ready yet, your recruiter can still submit an application on your behalf.")}
    `,
  });

  const config = await getEmailConfig("candidate_invite", "You're ready to apply — create your Vertex account", defaultHtml);
  const finalHtml = config.html.replace(/\{\{name\}\}/g, name).replace(/\{\{registerUrl\}\}/g, registerUrl);

  await transporter.sendMail({ from: FROM, to, subject: config.subject, html: finalHtml });
}

// Replaces the old "temp password shown once" pattern for both
// system-admin-created staff and director-provisioned partner logins
// (2026-07-27) — the User row already exists (role/assignment already
// set) with password_hash null, so this only ever needs to authorize
// setting a password on it, same shape as sendCandidateInviteEmail but for
// an account instead of a not-yet-existing one.
export async function sendAccountSetupInviteEmail(userId: string, to: string, name: string) {
  const token = signAccountSetupToken(userId);
  const setupUrl = `${APP_URL}/auth/register?setup=${token}`;

  const defaultHtml = emailLayout({
    eyebrow: "Account Setup",
    title: "Set up your account, {{name}}.",
    bodyHtml: `
      ${p("An account has been created for you on Vertex International. Set your password to get started.")}
      ${goldButton("{{setupUrl}}", "Set Your Password")}
      ${small("This link expires in 7 days.")}
    `,
  });

  const config = await getEmailConfig("account_setup_invite", "Set up your Vertex International account", defaultHtml);
  const finalHtml = config.html.replace(/\{\{name\}\}/g, name).replace(/\{\{setupUrl\}\}/g, setupUrl);

  await transporter.sendMail({ from: FROM, to, subject: config.subject, html: finalHtml });
}

// hasAccount distinguishes a brand-new Candidate Information Form
// submission (no account exists yet — accounts are only created later,
// via the screening invite) from a re-submission by a candidate who
// already registered. Only the latter has anywhere to sign in to, so
// only it gets a dashboard link.
export async function sendApplicationConfirmationEmail(to: string, name: string, jobTitle: string, hasAccount: boolean) {
  const defaultHtml = emailLayout({
    eyebrow: "Candidate Information Form",
    title: "Application received",
    bodyHtml: hasAccount
      ? `
      ${p(`Hello {{name}}, thank you for applying for <strong>{{jobTitle}}</strong> through Vertex International Recruitment.`)}
      ${p("We've successfully received your application and documentation. Our team is reviewing it now — you can track its status at any time from your candidate dashboard.")}
      ${goldButton(`${APP_URL}/dashboard`, "View Dashboard")}
    `
      : `
      ${p(`Hello {{name}}, thank you for applying for <strong>{{jobTitle}}</strong> through Vertex International Recruitment.`)}
      ${p("We've successfully received your application. Your submission is now under review — there's nothing further for you to do at this stage. Once our team has reviewed your details, we'll be in touch by email with next steps.")}
    `,
  });

  const config = await getEmailConfig("application_received", `Application Received: ${jobTitle}`, defaultHtml);
  const finalHtml = config.html
    .replace(/\{\{name\}\}/g, name)
    .replace(/\{\{jobTitle\}\}/g, jobTitle);

  try {
    await transporter.sendMail({ from: FROM, to, subject: config.subject, html: finalHtml });
  } catch (error) {
    log.error("email.error_sending_application_confirmation", { err: error });
  }
}

export async function sendStatusUpdateEmail(to: string, name: string, jobTitle: string, newStatus: string) {
  const friendlyStatus = newStatus.replace("_", " ").toUpperCase();
  const defaultHtml = emailLayout({
    eyebrow: "Application Update",
    title: "Your application has moved",
    bodyHtml: `
      ${p(`Hello {{name}}, there's an update on your application for <strong>{{jobTitle}}</strong>.`)}
      ${statPill("New Status", "{{friendlyStatus}}")}
      ${goldButton(`${APP_URL}/dashboard`, "View Dashboard")}
    `,
  });

  const config = await getEmailConfig("application_status", `Update on your application: ${jobTitle}`, defaultHtml);
  const finalHtml = config.html
    .replace(/\{\{name\}\}/g, name)
    .replace(/\{\{jobTitle\}\}/g, jobTitle)
    .replace(/\{\{friendlyStatus\}\}/g, friendlyStatus);

  try {
    await transporter.sendMail({ from: FROM, to, subject: config.subject, html: finalHtml });
  } catch (error) {
    log.error("email.error_sending_status_update", { err: error });
  }
}

export async function sendInterviewInvitationEmail(to: string, name: string, jobTitle: string, interviewDate: Date) {
  const formattedDate = new Date(interviewDate).toLocaleString("en-US", { dateStyle: "full", timeStyle: "short" });
  const defaultHtml = emailLayout({
    eyebrow: "Interview Invitation",
    title: "You're invited to interview",
    bodyHtml: `
      ${p(`Hello {{name}}, we're pleased to invite you to an interview for <strong>{{jobTitle}}</strong>.`)}
      ${statPill("Scheduled For", "{{formattedDate}}", "green")}
      ${p("Please log in to your dashboard for more details, or reply to this email if you need to reschedule.")}
      ${goldButton(`${APP_URL}/dashboard`, "View Dashboard")}
    `,
  });

  const config = await getEmailConfig("interview_invitation", `Interview Invitation: ${jobTitle}`, defaultHtml);
  const finalHtml = config.html
    .replace(/\{\{name\}\}/g, name)
    .replace(/\{\{jobTitle\}\}/g, jobTitle)
    .replace(/\{\{formattedDate\}\}/g, formattedDate);

  try {
    await transporter.sendMail({ from: FROM, to, subject: config.subject, html: finalHtml });
  } catch (error) {
    log.error("email.error_sending_interview_invitation", { err: error });
  }
}

// SRS FR-4.8 — automated stage-based notification to the candidate on a
// mobility-case stage change. Self-submitted-with-a-login only — a
// partner-sourced candidate is never emailed directly (2026-08-15
// correction), so every caller here always has a real dashboard to link to.
export async function sendCaseStageUpdateEmail(to: string, name: string, jobTitle: string, newStage: string) {
  const friendlyStage = CASE_STAGE_LABELS[newStage as CaseStageKey] ?? newStage.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const defaultHtml = emailLayout({
    eyebrow: "Case Update",
    title: "Your case has moved forward",
    bodyHtml: `
      ${p(`Hello {{name}}, your placement case for <strong>{{jobTitle}}</strong> has moved to a new stage.`)}
      ${statPill("Current Stage", "{{friendlyStage}}", "green")}
      ${goldButton(`${APP_URL}/dashboard`, "View Your Case")}
    `,
  });

  const config = await getEmailConfig("case_stage_update", `Update on your placement: ${jobTitle}`, defaultHtml);
  const finalHtml = config.html
    .replace(/\{\{name\}\}/g, name)
    .replace(/\{\{jobTitle\}\}/g, jobTitle)
    .replace(/\{\{friendlyStage\}\}/g, friendlyStage);

  try {
    await transporter.sendMail({ from: FROM, to, subject: config.subject, html: finalHtml });
  } catch (error) {
    log.error("email.error_sending_case_stage_update", { err: error });
  }
}

// Companion to sendCaseStageUpdateEmail (CRM Comments item 2, 2026-08-10)
// — the sourcing partner previously never learned about a stage change on
// a candidate they submitted, even though Operations now owns stage
// progression for every pipeline, not just self-submitted candidates.
export async function sendPartnerCaseStageUpdateEmail(to: string, partnerName: string, candidateName: string, jobTitle: string, newStage: string) {
  const friendlyStage = CASE_STAGE_LABELS[newStage as CaseStageKey] ?? newStage.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const html = emailLayout({
    eyebrow: "Partner Portal",
    title: "Case update",
    bodyHtml: `
      ${p(`Hi ${partnerName}, <strong>${candidateName}</strong>'s placement case for <strong>${jobTitle}</strong> has moved to a new stage.`)}
      ${statPill("Current Stage", friendlyStage, "green")}
      ${goldButton(`${APP_URL}/partner`, "View in Partner Portal")}
    `,
  });

  try {
    await transporter.sendMail({ from: FROM, to, subject: `Case update for ${candidateName} — Vertex International`, html });
  } catch (error) {
    log.error("email.error_sending_partner_case_stage_update", { err: error });
  }
}

// A real case-level rejection (2026-08-16) — distinct from the ops-review
// documentation flag, which never actually closed anything. Fires when
// Operations/Director rejects a case that HR already created, notifying
// HR (the whole team, not one tracked individual — no single "case
// creator" is reliably recorded on either pipeline) so it doesn't happen
// silently.
export async function sendCaseRejectedEmail(to: string, recipientName: string, candidateName: string, jobTitle: string, reason: string) {
  const html = emailLayout({
    eyebrow: "Case Update",
    title: "A case has been rejected",
    bodyHtml: `
      ${p(`Hi ${recipientName}, <strong>${candidateName}</strong>'s placement case for <strong>${jobTitle}</strong> has been rejected and is now closed.`)}
      ${p(`<strong>Reason:</strong> ${reason}`)}
    `,
  });

  try {
    await transporter.sendMail({ from: FROM, to, subject: `Case rejected for ${candidateName} — Vertex International`, html });
  } catch (error) {
    log.error("email.error_sending_case_rejected_notification", { err: error });
  }
}

// Companion to sendCaseRejectedEmail — the sourcing partner needs to know
// their candidate's case was closed at least as much as HR does, same
// reasoning as sendPartnerCaseStageUpdateEmail existing alongside the
// candidate-facing stage-update email.
export async function sendPartnerCaseRejectedEmail(to: string, partnerName: string, candidateName: string, jobTitle: string, reason: string) {
  const html = emailLayout({
    eyebrow: "Partner Portal",
    title: "Case rejected",
    bodyHtml: `
      ${p(`Hi ${partnerName}, <strong>${candidateName}</strong>'s placement case for <strong>${jobTitle}</strong> has been rejected and is now closed.`)}
      ${p(`<strong>Reason:</strong> ${reason}`)}
      ${goldButton(`${APP_URL}/partner`, "View in Partner Portal")}
    `,
  });

  try {
    await transporter.sendMail({ from: FROM, to, subject: `Case rejected for ${candidateName} — Vertex International`, html });
  } catch (error) {
    log.error("email.error_sending_partner_case_rejected_notification", { err: error });
  }
}

// Fires once on the candidate lifecycle's "approved" transition
// (candidates/[id]/status/route.ts) — the point a Case actually opens
// (Regional Supervisory Operational Workflow p.5). Distinct from
// sendStatusUpdateEmail/sendCaseStageUpdateEmail above, which track the
// legacy Application.application_status field and case-stage changes
// respectively, not this candidate-lifecycle milestone.
export async function sendCandidateApprovedEmail(to: string, name: string) {
  const defaultHtml = emailLayout({
    eyebrow: "Application Approved",
    title: "You've been approved, {{name}}.",
    bodyHtml: `
      ${p("Congratulations — your application has been approved by our In-House team. Your mobility case is now open, and your recruiter will be in touch with next steps.")}
      ${goldButton(`${APP_URL}/dashboard`, "View My Case")}
      ${FINANCE_NEXT_STEP_HTML}
    `,
  });

  const config = await getEmailConfig("candidate_approved", "You've been approved — Vertex International", defaultHtml);
  const finalHtml = config.html.replace(/\{\{name\}\}/g, name);

  try {
    await transporter.sendMail({ from: FROM, to, subject: config.subject, html: finalHtml });
  } catch (error) {
    log.error("email.error_sending_candidate_approved_email", { err: error });
  }
}

// Fires whenever either side of the candidate<->recruiter message thread
// posts a new message, notifying whoever didn't send it — a light nudge
// to check the thread rather than reproducing the message content itself
// (no need to put message contents in an email a third party could see).
export async function sendCandidateMessageNotificationEmail(to: string, name: string, viewUrl: string) {
  const defaultHtml = emailLayout({
    eyebrow: "New Message",
    title: "You have a new message, {{name}}.",
    bodyHtml: `
      ${p("You've received a new message on Vertex International. Log in to read and reply.")}
      ${goldButton(viewUrl, "View Message")}
    `,
  });

  const config = await getEmailConfig("candidate_message", "New message — Vertex International", defaultHtml);
  const finalHtml = config.html.replace(/\{\{name\}\}/g, name);

  try {
    await transporter.sendMail({ from: FROM, to, subject: config.subject, html: finalHtml });
  } catch (error) {
    log.error("email.error_sending_message_notification", { err: error });
  }
}

// Staff-facing notification (SRS FR-5.1) — a partner submitted a candidate
// through its own portal. This candidate never enters Vertex's internal
// recruiter/screening funnel, so this email (plus the record itself) is
// currently the only signal staff have that one exists. Recipient is a
// business-provided address, not yet supplied — no-ops with a console note
// until PARTNER_SUBMISSION_NOTIFY_EMAIL is set, rather than throwing.
export async function sendPartnerCandidateSubmittedEmail(partnerName: string, candidateName: string) {
  const to = process.env.PARTNER_SUBMISSION_NOTIFY_EMAIL;
  if (!to) {
    log.info("email.submitted_no_partner_submission_notify_email_configured", { message: `[partner-candidate] ${partnerName} submitted ${candidateName} — no PARTNER_SUBMISSION_NOTIFY_EMAIL configured, skipping notification email.` });
    return;
  }

  const html = emailLayout({
    eyebrow: "Partner Portal",
    title: "New partner candidate submission",
    bodyHtml: `
      ${p(`<strong>${partnerName}</strong> submitted a new candidate: <strong>${candidateName}</strong>.`)}
      ${small("Sign in to your Vertex portal to review it.")}
    `,
  });

  try {
    await transporter.sendMail({ from: FROM, to, subject: `New partner candidate: ${candidateName}`, html });
  } catch (error) {
    log.error("email.error_sending_partner_candidate_submission_notification", { err: error });
  }
}

// Fires when operations creates a Case for a partner-sourced candidate
// (PATCH /api/partner-candidates/:id/create-case). Notifies the partner's
// own contact, not the candidate — a partner-sourced candidate never gets
// a Vertex login (confirmed decision), so sendCandidateApprovedEmail's
// "View My Case" dashboard link would be dead on arrival for them; the
// partner is the one who actually has a portal to check the case in.
export async function sendPartnerCaseCreatedEmail(to: string, partnerName: string, candidateName: string) {
  const html = emailLayout({
    eyebrow: "Partner Portal",
    title: "Case opened",
    bodyHtml: `
      ${p(`Hi ${partnerName}, Vertex has reviewed and approved <strong>${candidateName}</strong> — a mobility case is now open.`)}
      ${goldButton(`${APP_URL}/partner`, "View in Partner Portal")}
      ${FINANCE_NEXT_STEP_HTML}
    `,
  });

  try {
    await transporter.sendMail({ from: FROM, to, subject: `Case opened for ${candidateName} — Vertex International`, html });
  } catch (error) {
    log.error("email.error_sending_partner_case_created_notification", { err: error });
  }
}

// Fires when HR rejects a partner submission (PATCH /api/partner-
// candidates/:id/reject, 2026-07-31 per the Operational Workflow SOP) —
// rejection isn't a dead end, so this points the partner at the message
// thread on the submission rather than just delivering bad news.
export async function sendPartnerCandidateRejectedEmail(to: string, partnerName: string, candidateName: string, reason: string) {
  const html = emailLayout({
    eyebrow: "Partner Portal",
    title: "Submission needs attention",
    bodyHtml: `
      ${p(`Hi ${partnerName}, Vertex's HR team reviewed <strong>${candidateName}</strong>'s submission and needs some changes before it can proceed.`)}
      ${p(`<strong>Reason:</strong> ${reason}`)}
      ${goldButton(`${APP_URL}/partner`, "View in Partner Portal")}
      ${small("You can message our HR team directly from the candidate's page once you're signed in.")}
    `,
  });

  try {
    await transporter.sendMail({ from: FROM, to, subject: `Action needed on ${candidateName}'s submission — Vertex International`, html });
  } catch (error) {
    log.error("email.error_sending_partner_candidate_rejection_notification", { err: error });
  }
}

// One-off ops notification (2026-08-07) — a technical issue on our end
// (a String/Boolean schema mismatch, since fixed) caused some partner
// submissions on 2026-08-06 to fail partway through and never actually
// save, with no record on our side to recover from. Asks the partner to
// resubmit the specific candidate.
export async function sendPartnerResubmissionRequestEmail(to: string, contactName: string, candidateName: string) {
  const html = emailLayout({
    eyebrow: "Partner Portal",
    title: "Action needed — please resubmit a candidate",
    bodyHtml: `
      ${p(`Hi ${contactName}, we identified a technical issue on our end that affected some candidate submissions on 6 August, including your submission for <strong>${candidateName}</strong>.`)}
      ${p(`The issue has now been fixed, but unfortunately that submission did not save correctly and needs to be resubmitted.`)}
      ${goldButton(`${APP_URL}/partner`, "Resubmit in Partner Portal")}
      ${small("We apologise for the inconvenience.")}
    `,
  });

  try {
    await transporter.sendMail({ from: FROM, to, subject: `Action needed — please resubmit ${candidateName}`, html });
  } catch (error) {
    log.error("email.error_sending_partner_resubmission_request", { err: error });
  }
}

// Operations sending a manual reminder for a delayed document or payment
// (POST /api/cases/:id/remind, 2026-07-31 per the Operational Workflow
// SOP) — deliberately not an automated scheduler, matching this
// codebase's standing deferral of scheduler-dependent features; Operations
// decides when a delay actually warrants a nudge.
export async function sendCaseReminderEmail(
  to: string,
  recipientName: string,
  candidateName: string,
  programmeTitle: string,
  channel: "document" | "payment",
  customMessage?: string
) {
  const subjectLine = channel === "document" ? "Documents needed to keep your case moving" : "A payment is due on your case";
  const bodyLine =
    channel === "document"
      ? `We're still waiting on one or more documents for <strong>${candidateName}</strong>'s case (${programmeTitle}) — please upload them as soon as you can so we can keep things moving.`
      : `A milestone payment is due on <strong>${candidateName}</strong>'s case (${programmeTitle}). Please arrange payment as soon as you can.`;

  const html = emailLayout({
    eyebrow: "Case Reminder",
    title: subjectLine,
    bodyHtml: `
      ${p(`Hi ${recipientName}, ${bodyLine}`)}
      ${customMessage ? p(customMessage) : ""}
      ${goldButton(`${APP_URL}/dashboard`, "View Case")}
    `,
  });

  try {
    await transporter.sendMail({ from: FROM, to, subject: `${subjectLine} — Vertex International`, html });
  } catch (error) {
    log.error("email.error_sending_case_reminder_email", { err: error });
  }
}

// Sent to whichever party is financially responsible (the candidate or
// their sourcing partner) when a director/admin generates a Stripe Payment
// Link for one of a case's 3 milestones (POST /api/cases/:id/payments/link).
// Best-effort — the CasePayment row and the link URL itself already exist
// regardless of whether this send succeeds, so staff can always share the
// URL manually from CaseDetail's own copy button.
// Stage position/percentage/plain-English timing, matching the wording
// already used in CaseDetail.tsx's own milestone-type dropdown, so a
// recipient sees the exact same framing staff do.
// Exclusively used by the Stripe Payment Link flow below, which is
// restricted to self-registered candidates (2026-07-31) — a self-
// registered candidate can never be assigned a partner_only Job, so
// "upfront" (Credit Service Programme, 2026-08-29) never reaches this
// path. Narrowed to the 3-stage type rather than the full
// MilestonePaymentType enum for exactly that reason.
type StripeMilestoneType = "documentation" | "permit" | "visa";

const MILESTONE_STAGE_INFO: Record<StripeMilestoneType, { position: string; percent: string; timing: string }> = {
  documentation: { position: "Stage 1 of 3", percent: "25%", timing: "On engagement, before documentation begins" },
  permit: { position: "Stage 2 of 3", percent: "25%", timing: "After the work permit is issued" },
  visa: { position: "Stage 3 of 3", percent: "50%", timing: "After the visa is granted" },
};

function milestonePlanRow(type: StripeMilestoneType, amount: number, isCurrent: boolean) {
  const info = MILESTONE_STAGE_INFO[type];
  const label = MILESTONE_DESCRIPTIONS[type];
  return `
    <tr>
      <td style="padding:10px 0;border-bottom:1px solid ${BRAND.ivory100};vertical-align:top;">
        <div style="font-size:13px;font-weight:700;color:${isCurrent ? BRAND.gold600 : BRAND.midnight900};">${label} <span style="font-weight:500;color:rgba(6,33,25,0.4);">· ${info.position} · ${info.percent}</span></div>
        <div style="font-size:12px;color:rgba(6,33,25,0.5);margin-top:2px;">${info.timing}</div>
      </td>
      <td style="padding:10px 0;border-bottom:1px solid ${BRAND.ivory100};vertical-align:top;text-align:right;white-space:nowrap;">
        <div style="font-size:14px;font-weight:700;color:${BRAND.midnight900};">${amount.toLocaleString()} GBP</div>
        ${isCurrent ? `<div style="font-size:11px;font-weight:700;color:${BRAND.gold600};text-transform:uppercase;letter-spacing:0.05em;">Due now</div>` : `<div style="font-size:11px;color:rgba(6,33,25,0.35);">Upcoming</div>`}
      </td>
    </tr>
  `;
}

// candidateName is passed separately from the recipient's own name (to)
// since the recipient isn't always the candidate — a partner-sourced
// case sends this to the partner's contact, who needs to know *which* of
// their candidates it's for, not just their own name back at them.
export async function sendMilestonePaymentLinkEmail(
  to: string,
  recipientName: string,
  candidateName: string,
  programmeTitle: string,
  paymentUrl: string,
  type: StripeMilestoneType,
  fullPlan: { documentation: number; permit: number; visa: number }
) {
  const milestoneLabel = MILESTONE_DESCRIPTIONS[type];
  const amountGbp = fullPlan[type];
  const planRows = (["documentation", "permit", "visa"] as const)
    .map((t) => milestonePlanRow(t, fullPlan[t], t === type))
    .join("");

  const html = emailLayout({
    eyebrow: "Payment Due",
    title: `${milestoneLabel} — ${amountGbp.toLocaleString()} GBP`,
    subtitle: programmeTitle,
    bodyHtml: `
      ${p(`Hi ${recipientName}, a payment is now due for <strong>${candidateName}</strong>'s placement${programmeTitle ? ` — <strong>${programmeTitle}</strong>` : ""}.`)}
      ${goldButton(paymentUrl, "Pay Now")}
      <div style="margin:28px 0 8px;">
        <div style="font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:${BRAND.gold600};margin-bottom:6px;">Full Payment Plan</div>
        <table role="presentation" style="width:100%;border-collapse:collapse;">${planRows}</table>
      </div>
      ${small("This is a secure Stripe payment link. Air tickets and embassy fees are not included in any programme price and are payable separately.")}
    `,
  });

  try {
    await transporter.sendMail({ from: FROM, to, subject: `${milestoneLabel} due for ${candidateName} — Vertex International`, html });
  } catch (error) {
    log.error("email.error_sending_milestone_payment_link_email", { err: error });
  }
}

// Sends an emailed invoice for a case payment that isn't going through
// Stripe — partner/recruiter-sourced cases always pay this way, and this
// is also the fallback for a self-applicant when Stripe itself isn't
// available (2026-08-04). The attached file is a real invoice Finance
// already generated elsewhere (their bank/Wise, Stripe Invoicing, etc.)
// and uploaded — this app never generates the invoice itself, only sends
// it. Unlike sendMilestonePaymentLinkEmail, this throws on failure
// instead of swallowing it: the attachment is the entire point of the
// email, so the caller (and Finance, via the API response) needs to know
// if it didn't actually go out, same reasoning as
// sendPublicIntakeEmail/sendContactEmail.
export async function sendCasePaymentInvoiceEmail(
  to: string,
  recipientName: string,
  candidateName: string,
  passportNumber: string | null,
  programmeTitle: string,
  sectorName: string | null,
  invoiceFile: { buffer: Buffer; filename: string; contentType: string }
) {
  const passportLine = passportNumber ? ` (Passport Number: ${passportNumber})` : "";
  const programmeLine = programmeTitle
    ? `who has applied for the <strong>${programmeTitle}</strong>${sectorName ? ` under the <strong>${sectorName}</strong> sector` : ""}.`
    : "";

  const html = emailLayout({
    eyebrow: "Invoice",
    title: `Invoice for ${candidateName}`,
    subtitle: programmeTitle,
    bodyHtml: `
      ${p(`Dear ${recipientName},`)}
      ${p(`Please find attached our invoice for <strong>${candidateName}</strong>${passportLine}, ${programmeLine}`)}
      ${p(`Kindly ensure the candidate's full name and passport number are included in the payment reference. Once payment has been completed, please share the payment receipt with us for verification.`)}
      ${p(`Upon confirmation of payment, we will proceed with the next stage of processing.`)}
      ${p(`Should you require any clarification or additional information, please do not hesitate to contact us. Our team will be pleased to assist you.`)}
      ${p(`Thank you for your continued cooperation and valued partnership.`)}
      ${p(`Best regards,<br />Rachel Aderson<br />Finance Director`)}
    `,
  });

  await transporter.sendMail({
    from: FROM,
    to,
    subject: `Invoice for ${candidateName}${programmeTitle ? ` — ${programmeTitle}` : ""}`,
    html,
    attachments: [
      {
        filename: invoiceFile.filename,
        content: invoiceFile.buffer,
        contentType: invoiceFile.contentType,
      },
    ],
  });
}

// --- Public-forms email bridge ---
// The site is being deployed to the main domain ahead of the CRM's staff
// workflows being fully signed off. Until an admin flips SystemSetting
// "intake_mode" to "crm" (src/app/api/public-intake/application/route.ts,
// src/app/api/contact/route.ts), the public Candidate Information Form and
// Contact form don't touch the CRM at all — they email a human directly.
// Unlike sendPartnerCandidateSubmittedEmail, a failure here throws instead
// of being swallowed: for these two routes the email *is* the entire
// submission, so the caller must know if it didn't go out.

export interface PublicIntakeEmailData {
  fullName: string;
  email: string;
  phone?: string;
  nationality?: string;
  passportNumber?: string;
  // Section 1 is a single required Job pick (2026-07-31, replacing the
  // old 3-country-alternates + sector cluster) — always present.
  jobTitle: string;
  jobCountry: string;
  jobCity: string;
  earliestTravelDate: string;
  priorEuVisaApplied?: boolean;
  priorEuVisaAppliedDetails?: string;
  documentsAvailable: string[];
  currentLocationCountry: string;
  holdsSchengenVisa?: boolean;
  holdsSchengenVisaDetails?: string;
  priorVisaRefusals?: boolean;
  priorVisaRefusalsDetails?: string;
  availableForEmbassyAppointment: boolean;
  willingToStartWithin30Days: boolean;
  preferredContactChannel?: string;
  coverLetter?: string;
}

// Renders the CIF submission as an actual formatted document (numbered
// sections matching the real form's own 1-5 structure) rather than a flat
// notification table — this email *is* the record staff work from while
// intake_mode is "email", so it should read like the document itself,
// populated, not like an alert that one was filled in.
function docSectionHeader(num: string, title: string) {
  return `
    <table role="presentation" style="border-collapse:collapse;margin-bottom:2px;">
      <tr>
        <td style="width:24px;vertical-align:middle;">
          <div style="width:20px;height:20px;line-height:20px;text-align:center;font-size:11px;font-weight:700;color:${BRAND.ivory50};background:${BRAND.midnight950};border-radius:10px;">${num}</div>
        </td>
        <td style="vertical-align:middle;padding-left:8px;">
          <span style="font-size:12px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:${BRAND.midnight900};">${title}</span>
        </td>
      </tr>
    </table>
    <div style="border-bottom:2px solid ${BRAND.gold400};margin:8px 0 14px;"></div>
  `;
}

function docField(label: string, value?: string | null) {
  if (!value) return "";
  return `
    <tr>
      <td style="padding:7px 0;border-bottom:1px solid ${BRAND.ivory100};vertical-align:top;width:46%;">
        <span style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:${BRAND.gold600};">${label}</span>
      </td>
      <td style="padding:7px 0;border-bottom:1px solid ${BRAND.ivory100};vertical-align:top;font-size:14px;color:${BRAND.midnight900};font-weight:500;">${value}</td>
    </tr>
  `;
}

function docSection(num: string, title: string, rowsHtml: string) {
  if (!rowsHtml.trim()) return "";
  return `
    <div style="margin-bottom:26px;">
      ${docSectionHeader(num, title)}
      <table role="presentation" style="width:100%;border-collapse:collapse;">${rowsHtml}</table>
    </div>
  `;
}

export async function sendPublicIntakeEmail(data: PublicIntakeEmailData) {
  const to = process.env.PUBLIC_FORMS_NOTIFY_EMAIL;
  if (!to) {
    // Unlike sendPartnerCandidateSubmittedEmail (a secondary notification
    // for a record that already exists in the DB either way), there is no
    // fallback record here at all — an unconfigured inbox means the
    // submission is gone with no trace. Throw so the caller returns a real
    // error instead of a false "success".
    throw new Error("PUBLIC_FORMS_NOTIFY_EMAIL is not configured.");
  }

  const documentsHtml = data.documentsAvailable.length
    ? data.documentsAvailable.map((d) => `<div style="font-size:14px;color:${BRAND.midnight900};padding:3px 0;">✓ ${d}</div>`).join("")
    : `<div style="font-size:13px;color:rgba(6,33,25,0.45);font-style:italic;">None selected</div>`;

  const bodyHtml = `
    <div style="background:${BRAND.ivory100};border-radius:10px;padding:14px 18px;margin-bottom:28px;">
      <span style="font-size:12px;color:${BRAND.midnight900};">Emailed directly — the CRM intake pipeline isn't live yet
      (Admin Settings → Public Form Intake Mode).</span>
    </div>

    ${docSection("1", "Programme Selection", `
      ${docField("Applying for", data.jobTitle)}
      ${docField("Destination", `${data.jobCity}, ${data.jobCountry}`)}
      ${docField("Earliest possible travel date", data.earliestTravelDate)}
      ${docField(
        "Previously applied for an EU visa?",
        data.priorEuVisaApplied === undefined
          ? undefined
          : `${data.priorEuVisaApplied ? "Yes" : "No"}${data.priorEuVisaAppliedDetails ? ` — ${data.priorEuVisaAppliedDetails}` : ""}`
      )}
    `)}

    ${docSection("2", "Candidate Personal Information", `
      ${docField("Full name", data.fullName)}
      ${docField("Email address", data.email)}
      ${docField("Phone number", data.phone)}
      ${docField("Nationality", data.nationality)}
      ${docField("Passport number", data.passportNumber)}
    `)}

    <div style="margin-bottom:26px;">
      ${docSectionHeader("3", "Document Checklist")}
      ${documentsHtml}
    </div>

    <div style="margin-bottom:26px;">
      ${docSectionHeader("4", "Payment Plan Acknowledgement")}
      <div style="display:inline-block;background:${BRAND.midnight800};color:${BRAND.gold300};font-size:12px;font-weight:600;padding:9px 18px;border-radius:999px;">
        ✓ Payment plan acknowledged (25% documentation / 25% permit / 50% visa)
      </div>
    </div>

    ${docSection("5", "Visa &amp; Travel Readiness", `
      ${docField("Current location", data.currentLocationCountry)}
      ${docField(
        "Holds Schengen / EU visa?",
        data.holdsSchengenVisa === undefined
          ? undefined
          : `${data.holdsSchengenVisa ? "Yes" : "No"}${data.holdsSchengenVisaDetails ? ` — ${data.holdsSchengenVisaDetails}` : ""}`
      )}
      ${docField(
        "Prior visa refusals",
        data.priorVisaRefusals === undefined
          ? undefined
          : `${data.priorVisaRefusals ? "Yes" : "No"}${data.priorVisaRefusalsDetails ? ` — ${data.priorVisaRefusalsDetails}` : ""}`
      )}
      ${docField("Available for embassy appointment?", data.availableForEmbassyAppointment ? "Yes" : "No")}
      ${docField("Willing to start within 30 days?", data.willingToStartWithin30Days ? "Yes" : "No")}
      ${docField("Preferred contact channel", data.preferredContactChannel)}
    `)}

    ${data.coverLetter ? `<div style="margin-bottom:4px;">
      ${docSectionHeader("—", "Additional Notes")}
      <p style="font-size:14px;color:${BRAND.midnight900};line-height:1.6;white-space:pre-wrap;margin:0;">${data.coverLetter}</p>
    </div>` : ""}
  `;

  const html = emailLayout({
    eyebrow: "Candidate Information Form",
    title: data.fullName,
    subtitle: "European Work Permit &amp; Visa Application" + (data.jobTitle ? ` · ${data.jobTitle}` : ""),
    bodyHtml,
  });

  await transporter.sendMail({ from: FROM, to, subject: `New CIF submission: ${data.fullName}${data.jobTitle ? ` — ${data.jobTitle}` : ""}`, html });
}

export async function sendPublicIntakeConfirmationEmail(to: string, fullName: string) {
  const html = emailLayout({
    eyebrow: "Candidate Information Form",
    title: `Thank you, ${fullName}.`,
    bodyHtml: p("We've received your Candidate Information Form. A member of our team will review it and get in touch within 1–2 business days to confirm your programme and next steps."),
  });
  await transporter.sendMail({ from: FROM, to, subject: "We've received your application — Vertex International", html });
}

export interface ContactMessageData {
  name: string;
  email: string;
  subject: string;
  message: string;
  registration_number?: string;
}

export async function sendContactMessageEmail(data: ContactMessageData) {
  const to = process.env.PUBLIC_FORMS_NOTIFY_EMAIL;
  if (!to) {
    // Same reasoning as sendPublicIntakeEmail: no DB fallback record
    // exists for a contact message, so an unconfigured inbox must fail
    // loudly rather than silently discard the message.
    throw new Error("PUBLIC_FORMS_NOTIFY_EMAIL is not configured.");
  }

  const html = emailLayout({
    eyebrow: "Contact Form",
    title: data.subject,
    subtitle: `From ${data.name} · ${data.email}`,
    bodyHtml: `
      ${data.registration_number ? `<p style="font-size:13px;color:rgba(6,33,25,0.5);margin:0 0 20px;">Registration/Licence Number: <strong>${data.registration_number}</strong></p>` : ""}
      <p style="font-size:13px;color:rgba(6,33,25,0.5);margin:0 0 6px;text-transform:uppercase;letter-spacing:0.06em;font-weight:600;">Message</p>
      <p style="font-size:15px;color:${BRAND.midnight900};white-space:pre-wrap;line-height:1.65;margin:0;">${data.message}</p>
    `,
  });

  await transporter.sendMail({ from: FROM, to, replyTo: data.email, subject: `[Contact] ${data.subject}`, html });
}

export interface ConsultationBookingNotificationData {
  fullName?: string | null;
  email: string;
  phone?: string | null;
  amount: number;
  currency: string;
}

// Fired from the Stripe webhook's "consultation" branch once a
// /consultation payment is confirmed — deliberately non-throwing (unlike
// sendContactMessageEmail/sendPublicIntakeEmail above): the
// ConsultationBooking row is already the durable record by the time this
// runs, so a failed notification email is a secondary problem the caller
// logs and moves on from, not a reason to fail the whole webhook (Stripe
// retries aggressively on a non-200 response).
export async function sendConsultationBookingNotification(data: ConsultationBookingNotificationData) {
  const to = process.env.CONSULTATION_NOTIFY_EMAIL;
  if (!to) {
    log.error("email.consultation_notify_email_is_not_configured_skipping");
    return;
  }

  const html = emailLayout({
    eyebrow: "Consultation Booked",
    title: `${data.amount.toLocaleString()} ${data.currency} — Pathway Consultation`,
    subtitle: data.fullName ?? data.email,
    bodyHtml: `
      ${docField("Name", data.fullName)}
      ${docField("Email", data.email)}
      ${docField("Phone", data.phone)}
      ${docField("Amount paid", `${data.amount.toLocaleString()} ${data.currency}`)}
    `,
  });

  try {
    await transporter.sendMail({ from: FROM, to, subject: `New consultation booking — ${data.fullName ?? data.email}`, html });
  } catch (error) {
    log.error("email.error_sending_consultation_booking_notification_email", { err: error });
  }
}
