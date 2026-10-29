import { after, NextResponse, type NextRequest } from "next/server";
import { callBackend, type BackendResult, type CallBackendOptions } from "@/lib/backend";
import * as email from "@/lib/email";
import { log } from "@/lib/log";

/**
 * The candidate pipeline is written by FastAPI since the switch
 * (docs/architecture/pipeline-handover.md, step 6.7): every pipeline route
 * here checks what it can early (role, JSON) and passes the request on.
 *
 * The website still sends the pipeline's emails (owner's decision D1): a
 * FastAPI response lists the emails its write left due in `notify`, each
 * with what its sender in lib/email.ts takes. They're sent after the
 * response (after()), and a failure is logged, never the request's. The
 * kinds here and in vertex_be/app/api/notices.py must match: a test on
 * each side reads the other.
 */

const APP_URL = () => process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

// One sender per kind, named as FastAPI names them.
export const NOTICE_SENDERS = {
  candidate_invite: (n) => email.sendCandidateInviteEmail(n.candidate_id, n.email, n.full_name),
  referral_commission_earned: (n) =>
    email.sendReferralCommissionEarnedEmail(n.agent_email, n.agent_name, n.candidate_name, n.milestone, n.amount, n.currency),
  referral_commission_approved: (n) => email.sendReferralCommissionApprovedEmail(n.email, n.agent_name, n.candidate_name, n.amount, n.currency),
  referral_commission_paid: (n) => email.sendReferralCommissionPaidEmail(n.email, n.agent_name, n.candidate_name, n.amount, n.currency),
  candidate_message: (n) => email.sendCandidateMessageNotificationEmail(n.email, n.full_name, `${APP_URL()}${n.view_path}`),
  application_confirmation: (n) => email.sendApplicationConfirmationEmail(n.email, n.full_name, n.job_title, n.has_account),
  application_status: (n) => email.sendStatusUpdateEmail(n.email, n.full_name, n.job_title, n.status),
  candidate_approved: (n) => email.sendCandidateApprovedEmail(n.email, n.full_name),
  case_stage: (n) => email.sendCaseStageUpdateEmail(n.email, n.full_name, n.job_title, n.stage),
  partner_case_stage: (n) => email.sendPartnerCaseStageUpdateEmail(n.email, n.partner_name, n.candidate_name, n.job_title, n.stage),
  case_rejected: (n) => email.sendCaseRejectedEmail(n.email, n.full_name, n.candidate_name, n.job_title, n.reason),
  partner_case_rejected: (n) => email.sendPartnerCaseRejectedEmail(n.email, n.partner_name, n.candidate_name, n.job_title, n.reason),
  case_reminder: (n) =>
    email.sendCaseReminderEmail(n.email, n.recipient_name, n.candidate_name, n.programme_title, n.channel, n.message ?? undefined),
  partner_candidate_submitted: (n) => email.sendPartnerCandidateSubmittedEmail(n.partner_name, n.candidate_name),
  partner_case_created: (n) => email.sendPartnerCaseCreatedEmail(n.email, n.partner_name, n.candidate_name),
  partner_candidate_rejected: (n) => email.sendPartnerCandidateRejectedEmail(n.email, n.partner_name, n.candidate_name, n.reason),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- FastAPI's shapes, checked by vertex_be/tests/test_notices.py
} satisfies Record<string, (notice: any) => Promise<unknown>>;

export type Notice = { kind: keyof typeof NOTICE_SENDERS } & Record<string, unknown>;

/** Sends each email after the response; an unknown kind or a failed send is logged. */
export async function sendNotices(notices: unknown): Promise<void> {
  if (!Array.isArray(notices)) return;
  for (const notice of notices as Notice[]) {
    const send = NOTICE_SENDERS[notice.kind] as ((n: Notice) => Promise<unknown>) | undefined;
    if (!send) {
      log.error("email.unknown_notice", { kind: notice.kind });
      continue;
    }
    try {
      await send(notice);
    } catch (err) {
      log.error("email.send_failed", { kind: notice.kind, err });
    }
  }
}

export interface PassOnOptions {
  /** Answer with `data` itself, as an older route did (default: {data}). */
  unwrap?: boolean;
  /** Errors as { error: message, details? }, for pages written against that shape. */
  legacyErrors?: boolean;
  /** Reshape a success before it's sent (e.g. add the form's upload token). */
  reshape?: (data: unknown, body: Record<string, unknown>) => unknown;
}

/** The route's answer from FastAPI's, sending the emails it lists. */
export function pipelineResponse(result: BackendResult<unknown>, options: PassOnOptions = {}): NextResponse {
  if (!result.ok) {
    const { message, details } = result.error;
    const error = options.legacyErrors ? (details !== undefined ? { error: message, details } : { error: message }) : { error: result.error };
    return NextResponse.json(error, { status: result.status });
  }
  const { data, notify } = result.body as { data: unknown; notify?: unknown };
  if (Array.isArray(notify) && notify.length > 0) after(() => sendNotices(notify));
  const shaped = options.reshape ? options.reshape(data, result.body) : data;
  return NextResponse.json(options.unwrap ? shaped : { data: shaped }, { status: result.status });
}

/** Calls FastAPI and answers with pipelineResponse(). */
export async function passOn(path: string, call: CallBackendOptions, options: PassOnOptions = {}): Promise<NextResponse> {
  return pipelineResponse(await callBackend(path, call), options);
}

/** A path segment from a route parameter, encoded. */
export const seg = (value: string) => encodeURIComponent(value);

/** The request's JSON body, or the 400 an unreadable one gets. */
export async function readJson(req: NextRequest, legacyErrors = false): Promise<{ body: unknown; invalid?: undefined } | { invalid: NextResponse }> {
  try {
    return { body: await req.json() };
  } catch {
    const error = legacyErrors ? { error: "Invalid JSON" } : { error: { code: "invalid_json", message: "Invalid JSON" } };
    return { invalid: NextResponse.json(error, { status: 400 }) };
  }
}
