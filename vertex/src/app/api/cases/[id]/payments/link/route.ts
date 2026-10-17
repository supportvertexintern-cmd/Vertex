import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auditedPrisma } from "@/lib/audit";
import { stripe } from "@/lib/stripe";
import { generateCasePaymentLinkSchema } from "@/lib/validations";
import { getAuthUser, requireRole, forbidden } from "@/lib/api-auth";
import { canAccessCase } from "@/server/scope";
import { FINANCE_ROLES } from "@/lib/rbac";
import { sendMilestonePaymentLinkEmail } from "@/lib/email";
import { computePaymentStageAmounts } from "@/lib/fees";
import { CASE_STAGE_LABELS, type CaseStageKey } from "@/components/portal/caseStages";

import { log } from "@/lib/log";
// POST /api/cases/:id/payments/link — Finance generates a real Stripe
// Payment Link for one of a case's 3 milestones (Director/Admin retain
// override, 2026-07-31), referencing the opportunity's pre-provisioned
// Price (stripeProvisioning.ts) rather than computing one inline. Sent to
// whichever party is financially responsible — the candidate, or the
// sourcing partner for a partner-bridged case. Same FeePolicy gate as the
// manual "Record" form, since this is still recording a milestone payment,
// just via a real charge instead of a staff-entered receipt.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, FINANCE_ROLES);
  if (guardRes) return guardRes;

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const parsed = generateCasePaymentLinkSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten().fieldErrors }, { status: 422 });
  }

  const caseRecord = await prisma.case.findUnique({
    where: { id },
    include: {
      application: {
        include: {
          job: { include: { payment_stages: { orderBy: { order: "asc" } } } },
          candidate: {
            include: {
              user: { select: { email: true, full_name: true } },
              partner: { select: { contact_email: true, contact_name: true } },
            },
          },
        },
      },
    },
  });
  if (!caseRecord) return NextResponse.json({ error: "Case not found." }, { status: 404 });

  const candidate = caseRecord.application.candidate;
  const allowed = await canAccessCase(user!, {
    user_id: candidate.user_id,
    recruiter_id: candidate.recruiter_id,
    country_id: candidate.country_id,
    partner_id: candidate.partner_id,
  });
  if (!allowed) return forbidden({ error: "Forbidden." });

  // Stripe restricted to self-applicants (2026-07-31) — the UI already
  // hides "Send Payment Link" for a partner/recruiter-sourced candidate,
  // but the API is the real authorization boundary, same as every other
  // capability gate in this codebase.
  if (candidate.source !== "self_registered") {
    return NextResponse.json({ error: "Stripe payment links are only available for self-applicants. Record this payment manually with a receipt instead." }, { status: 403 });
  }

  const countryId = candidate.country_id;
  const [countryPolicy, globalPolicy] = await Promise.all([
    countryId ? prisma.feePolicy.findFirst({ where: { country_id: countryId } }) : Promise.resolve(null),
    prisma.feePolicy.findFirst({ where: { country_id: null } }),
  ]);
  const effectivePolicy = countryPolicy ?? globalPolicy;
  if (!effectivePolicy?.enabled) {
    return NextResponse.json({ error: "Milestone payments are not enabled for this destination. In-House must enable the fee policy first." }, { status: 403 });
  }

  const jobId = caseRecord.application.job_id;
  if (!jobId) {
    return NextResponse.json(
      { error: "This case has no linked opportunity, so there's no pre-provisioned Stripe pricing to link to. Use the manual Record form instead." },
      { status: 422 }
    );
  }

  const jobStages = caseRecord.application.job?.payment_stages ?? [];
  const jobPaymentStage = jobStages.find((s: (typeof jobStages)[number]) => s.id === parsed.data.job_payment_stage_id);
  if (!jobPaymentStage) {
    return NextResponse.json({ error: "Payment stage not found for this case's opportunity." }, { status: 404 });
  }
  if (!jobPaymentStage.stripe_price_id || jobPaymentStage.synced_amount_gbp == null) {
    return NextResponse.json(
      { error: "Stripe pricing hasn't been provisioned for this payment stage yet. Try 'Retry Stripe Pricing' on the opportunity's edit page first." },
      { status: 422 }
    );
  }

  let recipientEmail: string | null;
  let recipientName: string;
  if (parsed.data.recipient === "partner") {
    if (!candidate.partner) {
      return NextResponse.json({ error: "This candidate has no associated partner to send a payment link to." }, { status: 422 });
    }
    recipientEmail = candidate.partner.contact_email;
    recipientName = candidate.partner.contact_name;
  } else {
    recipientEmail = candidate.user?.email ?? candidate.email;
    recipientName = candidate.user?.full_name ?? candidate.full_name ?? "there";
  }
  if (!recipientEmail) {
    return NextResponse.json({ error: "No email on file for the selected recipient." }, { status: 422 });
  }

  let paymentLink;
  try {
    paymentLink = await stripe.paymentLinks.create({
      line_items: [{ price: jobPaymentStage.stripe_price_id, quantity: 1 }],
      metadata: { case_id: id, job_payment_stage_id: jobPaymentStage.id },
    });
  } catch (err) {
    log.error("api.failed_to_create_stripe_payment_link_for", { message: `Failed to create Stripe payment link for case ${id}.`, err });
    return NextResponse.json(
      { error: { code: "stripe_link_failed", message: err instanceof Error ? err.message : "Failed to create Stripe payment link." } },
      { status: 502 }
    );
  }

  const payment = await auditedPrisma(user!.userId).casePayment.create({
    data: {
      case_id: id,
      job_payment_stage_id: jobPaymentStage.id,
      amount: jobPaymentStage.synced_amount_gbp,
      currency: "GBP",
      recorded_by: user!.userId,
      status: "pending",
      stripe_payment_link_id: paymentLink.id,
      stripe_payment_link_url: paymentLink.url,
      sent_to_email: recipientEmail,
    },
  });

  const candidateName = candidate.user?.full_name ?? candidate.full_name ?? "the candidate";
  const programmeTitle = caseRecord.application.job?.title ?? "";
  const allStages = caseRecord.application.job?.payment_stages ?? [];
  const amounts = computePaymentStageAmounts(caseRecord.application.job?.service_fee_gbp ?? 0, allStages.map((s: (typeof allStages)[number]) => s.percent));
  const planStages = allStages
    .map((s: (typeof allStages)[number], i: number) => ({
      id: s.id,
      label: s.label,
      percent: s.percent,
      amount: amounts[i],
      triggerStageLabel: CASE_STAGE_LABELS[s.trigger_stage as CaseStageKey],
    }))
    .filter((s: { amount: number }) => s.amount > 0);

  // Awaited, not fire-and-forget — on serverless (Vercel) the function
  // instance can freeze right after the response is sent, silently
  // killing an un-awaited async send before it completes.
  await sendMilestonePaymentLinkEmail(recipientEmail, recipientName, candidateName, programmeTitle, paymentLink.url, jobPaymentStage.id, planStages).catch((err) => log.error("email.send_failed", { err }));

  return NextResponse.json({ data: { payment, url: paymentLink.url } }, { status: 201 });
}
